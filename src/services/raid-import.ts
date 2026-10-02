import type { Prisma } from "@prisma/client";
import type { AddonLoot, AddonRaid } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";

// A Discord raid within this long of the in-game /guilded start counts as the
// same raid (people start late, or schedule "8pm" and pull at 8:40).
const MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface RaidImportSummary {
  ref: string;
  matchedRaidId: string | null;
  title: string;
  matchedRaidTitle: string | null;
  recorded: number;
  noShows: string[];
  walkIns: string[];
}

interface LinkedCharacter {
  id: string;
  name: string;
  realm: string;
  memberId: string;
}

type Tx = Pick<Prisma.TransactionClient, "raid" | "raidAttendance" | "member" | "character">;
type LootTx = Pick<Prisma.TransactionClient, "lootAward"> & Partial<Pick<Prisma.TransactionClient, "raid">>;

// Moves a character's "last seen" forward (never backward) when the addon
// reports them: a gear check, or being in a raid group.
export async function touchLastSeen(tx: Pick<Prisma.TransactionClient, "character">, characterId: string, when: Date): Promise<void> {
  await tx.character.updateMany({
    where: { id: characterId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: when } }] },
    data: { lastSeenAt: when }
  });
}

// Turns in-game raid presence into Discord raid attendance:
// - matches each addon raid to the closest Discord raid by start time;
// - records PRESENT/LATE/ABSENT marks, and PRESENT for anyone seen in the
//   group but not marked;
// - marks ABSENT anyone who signed up on Discord but was never seen, when
//   the addon actually recorded presence for that raid;
// - lists walk-ins (seen, but no Discord signup).
// Attendance already recorded on Discord is never overwritten, so re-importing
// the same export is harmless.
export async function applyRaidAttendance(
  tx: Tx,
  guildId: string,
  raids: AddonRaid[],
  characters: LinkedCharacter[],
  appliedBy: string
): Promise<RaidImportSummary[]> {
  const summaries: RaidImportSummary[] = [];
  for (const addonRaid of raids) {
    const start = addonRaid.startedAt.getTime();
    const candidates = await tx.raid.findMany({
      where: {
        guildId,
        status: { not: "CANCELLED" },
        ...(addonRaid.coreId ? { coreId: addonRaid.coreId } : {}),
        scheduledAt: { gte: new Date(start - MATCH_WINDOW_MS), lte: new Date(start + MATCH_WINDOW_MS) }
      },
      include: { signups: true, attendance: true }
    });
    const raid = candidates.sort((a, b) =>
      Math.abs(a.scheduledAt.getTime() - start) - Math.abs(b.scheduledAt.getTime() - start))[0];
    const summary: RaidImportSummary = {
      ref: addonRaid.ref, matchedRaidId: raid?.id ?? null, title: addonRaid.title,
      matchedRaidTitle: raid?.title ?? null, recorded: 0, noShows: [], walkIns: []
    };
    summaries.push(summary);
    if (!raid) continue;

    const alreadyRecorded = new Set(raid.attendance.map((row) => row.memberId));
    const signedUp = new Set(raid.signups.filter((signup) => signup.status === "SIGNED_UP").map((signup) => signup.memberId));
    const seenMembers = new Set<string>();

    for (const player of addonRaid.players) {
      const character = findCharacter(characters, player.character, player.realm);
      const status = player.status ?? (player.seen ? "PRESENT" : undefined);
      if (character && player.seen) await touchLastSeen(tx, character.id, addonRaid.endedAt ?? addonRaid.startedAt);
      if (!character || !status) continue;
      if (status !== "ABSENT") seenMembers.add(character.memberId);
      if (status !== "ABSENT" && !signedUp.has(character.memberId)) summary.walkIns.push(player.character);
      if (alreadyRecorded.has(character.memberId)) continue;
      alreadyRecorded.add(character.memberId);
      await tx.raidAttendance.create({
        data: { raidId: raid.id, memberId: character.memberId, status, recordedBy: appliedBy, notes: `From addon raid "${addonRaid.title}"` }
      });
      summary.recorded++;
    }

    // Presence is only trustworthy as "not there" if the addon saw anyone.
    if (!addonRaid.players.some((player) => player.seen)) continue;
    for (const memberId of signedUp) {
      if (seenMembers.has(memberId)) continue;
      const member = await tx.member.findUnique({ where: { id: memberId }, select: { displayName: true } });
      summary.noShows.push(member?.displayName ?? memberId);
      if (alreadyRecorded.has(memberId)) continue;
      alreadyRecorded.add(memberId);
      await tx.raidAttendance.create({
        data: { raidId: raid.id, memberId, status: "ABSENT", recordedBy: appliedBy, notes: "Signed up, never seen in the raid group (addon)" }
      });
      summary.recorded++;
    }
  }
  return summaries;
}

// Adds items given out in game (/guilded loot, GP bidding) to Discord loot
// history. Each addon loot row has a stable ref, so re-importing never
// duplicates. The GP was already imported as a ledger entry; this only
// records the history row. `raidIds` maps addon raid refs to the Discord
// raids they matched, so loot shows up in that raid's report.
export async function applyAddonLoot(
  tx: LootTx,
  guildId: string,
  loot: AddonLoot[],
  characters: LinkedCharacter[],
  raidIds: Map<string, string>,
  appliedBy: string,
  coreLootOnly = false,
  dismissed: ReadonlySet<string> = new Set()
): Promise<{ recorded: number; skipped: number; unmatched: string[]; recordedIds?: string[]; recordedRefs: string[]; held: AddonLoot[] }> {
  if (loot.length === 0) return { recorded: 0, skipped: 0, unmatched: [], recordedRefs: [], held: [] };
  const refs = loot.map((row) => row.ref);
  const existing = new Set((await tx.lootAward.findMany({
    where: { sourceRef: { in: refs } },
    select: { sourceRef: true }
  })).map((row) => row.sourceRef));
  let recorded = 0;
  const recordedIds: string[] = [];
  const recordedRefs: string[] = [];
  // Rows waiting for their core raid (still running in game, or never started): kept for the
  // next upload instead of failing the whole import.
  const held: AddonLoot[] = [];
  let skipped = 0;
  const unmatched: string[] = [];
  for (const row of loot) {
    if (existing.has(row.ref) || dismissed.has(row.ref)) { skipped++; continue; }
    const character = findCharacter(characters, row.character, row.realm);
    if (!character) { unmatched.push(row.character); continue; }
    const raidId = row.raidRef ? raidIds.get(row.raidRef) ?? null : null;
    if (coreLootOnly) {
      const raid = raidId ? await tx.raid?.findFirst({ where: { id: raidId, guildId, core: { separatePool: true } }, select: { id: true } }) : null;
      if (!raid) { held.push(row); continue; }
    }
    const award = await tx.lootAward.create({
      data: {
        guildId,
        memberId: character.memberId,
        itemName: row.item.slice(0, 200),
        amount: row.gp,
        raidId,
        bossName: row.boss ?? null,
        awardedBy: appliedBy,
        sourceRef: row.ref,
        ...(row.awardedAt ? { awardedAt: row.awardedAt } : {})
      }
    });
    recordedIds.push(award.id);
    recordedRefs.push(row.ref);
    existing.add(row.ref);
    recorded++;
  }
  return { recorded, skipped, unmatched: [...new Set(unmatched)], ...(recordedIds.length ? { recordedIds } : {}), recordedRefs, held };
}
