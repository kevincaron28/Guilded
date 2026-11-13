import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { AddonSnapshot } from "../integrations/addon.js";
import { characterKey, foreverNameMatches } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";
import { findCharacter } from "./character-match.js";

// What the game shows every member about the whole guild (8.5, docs/GUILD_DATA_INVENTORY.md):
// the roster (level, class, rank, last online), the guild event log and the MOTD/info text.
// Any paired member's upload brings it, so members who never install Guilded still reach the
// race board, last seen, roster gaps, statistics and the promotion panel.
//
// Rules:
//   * Latest wins, never double counted: a roster row is replaced only by a newer reading
//     (observedAt); an event is stored once (same kind, names and rank within 3 hours).
//   * Levels only go up; last seen only moves forward; nothing is dated in the future.
//   * Rank is applied only from an OFFICER's upload: rank drives Discord rank roles, and a
//     member's saved file could be edited. The roster table keeps every reading for display.
//   * Never links a character to a member and never deletes anything; "left the guild" is
//     concluded only from the newest COMPLETE roster (offline members shown).

export const SAME_EVENT_MS = 3 * 3600 * 1000;
const FUTURE_SLACK_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 30 * 86_400_000;

const nameSchema = z.string().trim().min(1).max(80).refine((value) => !/[|\p{Cc}]/u.test(value));
const memberSchema = z.object({
  name: nameSchema,
  level: z.number().int().min(1).max(100).optional(),
  class: z.string().regex(/^[A-Z]{1,20}$/).optional(),
  rankName: z.string().trim().min(1).max(60).optional(),
  rankIndex: z.number().int().min(0).max(19).optional(),
  online: z.boolean().default(false),
  lastOnline: z.number().int().positive().optional()
});
const eventSchema = z.object({
  type: z.enum(["invite", "join", "promote", "demote", "remove", "quit"]),
  actor: nameSchema,
  target: nameSchema.optional(),
  rank: z.string().trim().min(1).max(60).optional(),
  at: z.number().int().positive()
});

export interface GuildDataResult { roster: number; skippedOlder: boolean; left: number; characters: number; unclaimed: number; events: number; duplicateEvents: number; text: boolean; ranksDated: number }

type Tx = Pick<Prisma.TransactionClient, "guildRosterEntry" | "guildEventEntry" | "guildText" | "character" | "unclaimedCharacter" | "characterRankSeen">;

const toDate = (epoch: number | undefined) => epoch === undefined ? undefined : new Date(epoch * 1000);
// Last seen / last online only move when the move means something: the addon sends "now minus age" for offline members,
// so almost every offline member would otherwise move by a different few seconds on every upload (one write each).
const ONLINE_MIN_MOVE_MS = 10 * 60_000;
const OFFLINE_MIN_MOVE_MS = 60 * 60_000;
const movedForward = (stored: Date | null | undefined, candidate: Date | undefined, minMs: number) =>
  candidate && (!stored || candidate.getTime() - stored.getTime() >= minMs) ? candidate : undefined;
interface UnclaimedRow { id: string; nameKey: string; level: number | null; lastSeenAt: Date; guildRankName: string | null; guildRankAt: Date | null }
const sameTime = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const titleClass = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/** Applies one upload's guild data inside the caller's transaction. */
export async function applyGuildData(tx: Tx, guildId: string, uploader: { memberId: string | null; officer: boolean },
  snapshot: Pick<AddonSnapshot, "guildRoster" | "guildEvents" | "guildInfo" | "gameEdition" | "interface">, now = new Date()): Promise<GuildDataResult> {
  const result: GuildDataResult = { roster: 0, skippedOlder: false, left: 0, characters: 0, unclaimed: 0, events: 0, duplicateEvents: 0, text: false, ranksDated: 0 };
  const edition = gameEditionOf(snapshot);
  const fresh = (at: Date) => at.getTime() <= now.getTime() + FUTURE_SLACK_MS && now.getTime() - at.getTime() <= MAX_AGE_MS;
  const reportedById = uploader.memberId;

  // Roster: every member, with or without the addon.
  const roster = snapshot.guildRoster;
  const observedAt = roster ? new Date(roster.at * 1000) : null;
  if (roster && observedAt && fresh(observedAt)) {
    const started = Date.now();
    // An unchanged roster must cost a handful of statements, not one per member (a 500-member guild held one
    // transaction for ~19 s on 12 Nov 2026): a row is written on its own only when something real changes; rows
    // that only move forward in time are batched by identical value.
    const stats = { rowUpdates: 0, batches: 0 };
    const rosterTouch = new Map<string, { ids: string[]; lastOnlineAt?: Date; reportedById: string | null }>();
    const characterSeen = new Map<number, string[]>();
    const unclaimedSeen = new Map<number, string[]>();
    const characterRankTouch: string[] = [];
    const unclaimedRankTouch: string[] = [];
    const members = roster.members.flatMap((raw) => { const parsed = memberSchema.safeParse(raw); return parsed.success ? [parsed.data] : []; });
    const stored = await tx.guildRosterEntry.findMany({ where: { guildId, gameEdition: edition } });
    const newest = stored.reduce<Date | null>((max, row) => !max || row.observedAt > max ? row.observedAt : max, null);
    if (newest && observedAt <= newest) result.skippedOlder = true;
    const byKey = new Map(stored.map((row) => [row.nameKey, row]));
    const characters = await tx.character.findMany({ where: { member: { guildId }, gameEdition: edition },
      select: { id: true, name: true, realm: true, gameEdition: true, displayName: true, level: true, className: true, lastSeenAt: true, guildRankName: true, guildRankIndex: true, guildRankAt: true } });
    const unclaimed = await tx.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition }, select: { id: true, nameKey: true, level: true, lastSeenAt: true, guildRankName: true, guildRankAt: true } });
    const unclaimedByKey = new Map(unclaimed.map((row) => [row.nameKey, row]));
    const seenKeys = new Set<string>();
    // Rank comes only from an officer's upload, decided per row: applied when the stored rank date is empty or older than
    // this roster's reading (whatever other uploads stored in between), never moving a rank date backwards.
    const officerRanks = uploader.officer;
    const rankFresh = (at: Date | null | undefined) => !at || at < observedAt;
    for (const member of members) {
      const key = String(characterKey(member.name, "", edition));
      seenKeys.add(key);
      const lastOnline = toDate(member.online ? Math.trunc(observedAt.getTime() / 1000) : member.lastOnline);
      const lastOnlineOk = lastOnline && lastOnline.getTime() <= now.getTime() + FUTURE_SLACK_MS ? lastOnline : undefined;
      const previous = byKey.get(key);
      const minMove = member.online ? ONLINE_MIN_MOVE_MS : OFFLINE_MIN_MOVE_MS;
      if (!previous || previous.observedAt < observedAt) {
        const data = { name: member.name, level: member.level ?? previous?.level ?? null, className: member.class ?? previous?.className ?? null,
          rankName: member.rankName ?? null, rankIndex: member.rankIndex ?? null,
          lastOnlineAt: movedForward(previous?.lastOnlineAt, lastOnlineOk, minMove) ?? previous?.lastOnlineAt ?? null, inGuild: true, observedAt, reportedById };
        if (previous && previous.inGuild && previous.name === data.name && previous.level === data.level && previous.className === data.className
          && previous.rankName === data.rankName && previous.rankIndex === data.rankIndex) {
          // Only the reading time (and maybe last online) moved: batched, grouped by the identical new value.
          const moved = !sameTime(previous.lastOnlineAt, data.lastOnlineAt);
          const group = `${moved ? data.lastOnlineAt?.getTime() : "same"}|${reportedById}`;
          const batch = rosterTouch.get(group) ?? { ids: [], ...(moved && data.lastOnlineAt ? { lastOnlineAt: data.lastOnlineAt } : {}), reportedById };
          batch.ids.push(previous.id);
          rosterTouch.set(group, batch);
        } else {
          await tx.guildRosterEntry.upsert({ where: { guildId_gameEdition_nameKey: { guildId, gameEdition: edition, nameKey: key } },
            create: { guildId, gameEdition: edition, nameKey: key, ...data }, update: data });
          stats.rowUpdates++;
        }
        result.roster++;
      }
      // The same facts on the bot's own characters: level up only, last seen forward only.
      const character = findCharacter(characters, member.name, "", edition);
      if (character) {
        const update: Prisma.CharacterUpdateInput = {};
        if (member.level && member.level > (character.level ?? 0)) update.level = member.level;
        if (member.class && (!character.className || character.className === "UNKNOWN")) update.className = titleClass(member.class);
        const seen = movedForward(character.lastSeenAt, lastOnlineOk, minMove);
        let touchRank = false;
        if (officerRanks && member.rankName !== undefined && member.rankIndex !== undefined && rankFresh(character.guildRankAt)) {
          if (character.guildRankName !== member.rankName || character.guildRankIndex !== member.rankIndex) {
            update.guildRankName = member.rankName; update.guildRankIndex = member.rankIndex; update.guildRankAt = observedAt;
          } else touchRank = true;   // same rank confirmed again (rank roles read its age)
        }
        if (Object.keys(update).length) {
          if (seen) update.lastSeenAt = seen;
          if (touchRank) update.guildRankAt = observedAt;
          await tx.character.update({ where: { id: character.id }, data: update });
          stats.rowUpdates++;
          Object.assign(character, update);
          result.characters++;
        } else {
          if (seen) { characterSeen.set(seen.getTime(), [...(characterSeen.get(seen.getTime()) ?? []), character.id]); character.lastSeenAt = seen; result.characters++; }
          if (touchRank) { characterRankTouch.push(character.id); character.guildRankAt = observedAt; }
        }
        continue;
      }
      // Exact name first; else the single row still stored under the pre-8.5 first name (it takes
      // the roster's full name, so the race board and the unlinked list never show both).
      const loose = unclaimedByKey.has(key) ? undefined
        : foreverNameMatches([...unclaimedByKey.values()], member.name, (row: UnclaimedRow) => row.nameKey)[0] as UnclaimedRow | undefined;
      // Only when no other listed member shares that first name (else the old row could be theirs).
      const first = key.split(" ")[0]!;
      const sharesFirst = [...unclaimedByKey.keys()].some((other) => other !== key && other.startsWith(`${first} `));
      const existing = unclaimedByKey.get(key) ?? (loose && !loose.nameKey.includes(" ") && !sharesFirst ? loose : undefined);
      const seen = movedForward(existing?.lastSeenAt, lastOnlineOk, minMove);
      if (existing) {
        const update: Prisma.UnclaimedCharacterUpdateInput = {};
        if (existing.nameKey !== key && member.name.includes(" ")) {
          update.name = member.name; update.nameKey = key; update.legacyName = existing.nameKey;
          unclaimedByKey.delete(existing.nameKey); unclaimedByKey.set(key, existing); existing.nameKey = key;
        }
        if (member.level && member.level > (existing.level ?? 0)) update.level = member.level;
        let touchRank = false;
        if (officerRanks && member.rankName !== undefined && rankFresh(existing.guildRankAt)) {
          if (existing.guildRankName !== member.rankName) { update.guildRankName = member.rankName; update.guildRankAt = observedAt; }
          else touchRank = true;
        }
        if (Object.keys(update).length) {
          if (seen) update.lastSeenAt = seen;
          if (touchRank) update.guildRankAt = observedAt;
        }
        // A row this very upload just created has no id yet (a duplicate name in one roster): nothing to write on it.
        if (Object.keys(update).length && existing.id) { await tx.unclaimedCharacter.update({ where: { id: existing.id }, data: update }); stats.rowUpdates++; result.unclaimed++; }
        else {
          if (seen && existing.id) { unclaimedSeen.set(seen.getTime(), [...(unclaimedSeen.get(seen.getTime()) ?? []), existing.id]); existing.lastSeenAt = seen; result.unclaimed++; }
          if (touchRank && existing.id) { unclaimedRankTouch.push(existing.id); existing.guildRankAt = observedAt; }
        }
      } else if (member.class && !result.skippedOlder) {
        // A guild member nobody linked yet: listed as unlinked (never linked to anyone here).
        // createMany + skipDuplicates is INSERT .. ON CONFLICT DO NOTHING: a parallel upload that created the row first
        // (P2002) neither errors nor aborts this transaction, and the row it made is kept.
        await tx.unclaimedCharacter.createMany({ skipDuplicates: true, data: [{ guildId, gameEdition: edition, nameKey: key, name: member.name, realm: "",
          className: titleClass(member.class), ...(member.level ? { level: member.level } : {}), lastSeenAt: lastOnlineOk ?? observedAt,
          ...(officerRanks && !result.skippedOlder && member.rankName !== undefined ? { guildRankName: member.rankName, guildRankAt: observedAt } : {}) }] });
        unclaimedByKey.set(key, { id: "", nameKey: key, level: member.level ?? null, lastSeenAt: lastOnlineOk ?? observedAt, guildRankName: null, guildRankAt: null });
        result.unclaimed++;
      }
    }
    // The batched statements: one per group, not one per member.
    for (const batch of rosterTouch.values()) {
      await tx.guildRosterEntry.updateMany({ where: { id: { in: batch.ids } }, data: { observedAt, reportedById: batch.reportedById, ...(batch.lastOnlineAt ? { lastOnlineAt: batch.lastOnlineAt } : {}) } });
      stats.batches++;
    }
    for (const [ms, ids] of characterSeen) { await tx.character.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: new Date(ms) } }); stats.batches++; }
    for (const [ms, ids] of unclaimedSeen) { await tx.unclaimedCharacter.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: new Date(ms) } }); stats.batches++; }
    if (characterRankTouch.length) {
      await tx.character.updateMany({ where: { id: { in: characterRankTouch }, OR: [{ guildRankAt: null }, { guildRankAt: { lt: observedAt } }] }, data: { guildRankAt: observedAt } });
      stats.batches++;
    }
    if (unclaimedRankTouch.length) {
      await tx.unclaimedCharacter.updateMany({ where: { id: { in: unclaimedRankTouch }, OR: [{ guildRankAt: null }, { guildRankAt: { lt: observedAt } }] }, data: { guildRankAt: observedAt } });
      stats.batches++;
    }
    // Only the newest complete roster may say someone left.
    if (roster.complete && !result.skippedOlder && seenKeys.size) {
      const gone = stored.filter((row) => row.inGuild && !seenKeys.has(row.nameKey)).map((row) => row.id);
      if (gone.length) result.left = (await tx.guildRosterEntry.updateMany({ where: { id: { in: gone } }, data: { inGuild: false, observedAt } })).count;
    }
    // One journal line per roster (counts only, no names) so the next slowdown is visible.
    console.info(`Guild roster applied: ${members.length} members, ${result.roster} roster rows changed, ${result.characters} characters, ${result.unclaimed} unlinked, `
      + `${stats.rowUpdates} single-row writes, ${stats.batches} batched writes, ${result.skippedOlder ? "older than stored, " : ""}${Date.now() - started} ms.`);
  }

  // Event log: stored once whoever reads it.
  const events = snapshot.guildEvents.flatMap((raw) => { const parsed = eventSchema.safeParse(raw); return parsed.success ? [parsed.data] : []; })
    .map((event) => ({ ...event, when: new Date(event.at * 1000) })).filter((event) => event.when.getTime() <= now.getTime() + FUTURE_SLACK_MS);
  if (events.length) {
    const earliest = new Date(Math.min(...events.map((e) => e.when.getTime())) - SAME_EVENT_MS);
    const known = await tx.guildEventEntry.findMany({ where: { guildId, gameEdition: edition, at: { gte: earliest } } });
    const same = (a: { kind: string; actor: string; target: string | null; rank: string | null; at: Date }, b: typeof a) =>
      a.kind === b.kind && a.actor.toLowerCase() === b.actor.toLowerCase() && (a.target ?? "").toLowerCase() === (b.target ?? "").toLowerCase()
      && (a.rank ?? "") === (b.rank ?? "") && Math.abs(a.at.getTime() - b.at.getTime()) <= SAME_EVENT_MS;
    for (const event of events) {
      const row = { kind: event.type, actor: event.actor, target: event.target ?? null, rank: event.rank ?? null, at: event.when };
      if (known.some((stored) => same(stored, row))) { result.duplicateEvents++; continue; }
      await tx.guildEventEntry.create({ data: { guildId, gameEdition: edition, ...row, reportedById } });
      known.push({ ...row, id: "", guildId, gameEdition: edition, reportedById, createdAt: now });
      result.events++;
    }
  }
  result.ranksDated = await dateRanksFromLog(tx, guildId, edition);

  // MOTD and info text: the newest reading wins.
  const text = snapshot.guildInfo;
  if (text && (text.motd !== undefined || text.info !== undefined)) {
    const at = new Date(text.at * 1000);
    const current = await tx.guildText.findUnique({ where: { guildId } });
    if (fresh(at) && (!current || current.observedAt < at)) {
      const data = { motd: text.motd ?? null, info: text.info ?? null, observedAt: at, reportedById };
      await tx.guildText.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
      result.text = true;
    }
  }
  return result;
}

/**
 * The promotion panel's "in this rank since" (CharacterRankSeen) from the game's own log: the
 * latest promotion or demotion to a character's current rank, else their join for a character
 * never promoted. Only moves the date earlier than what was observed, never changes a rank.
 */
export async function dateRanksFromLog(tx: Pick<Tx, "guildEventEntry" | "character" | "characterRankSeen">, guildId: string, edition: string): Promise<number> {
  const characters = await tx.character.findMany({ where: { member: { guildId }, gameEdition: edition, guildRankName: { not: null } },
    select: { id: true, name: true, guildRankName: true, rankSeen: { select: { rankName: true, since: true } } } });
  if (!characters.length) return 0;
  const events = await tx.guildEventEntry.findMany({ where: { guildId, gameEdition: edition, kind: { in: ["promote", "demote", "join"] } }, orderBy: { at: "desc" } });
  let dated = 0;
  for (const character of characters) {
    const name = character.name.toLowerCase();
    const moves = events.filter((e) => (e.kind === "promote" || e.kind === "demote") && (e.target ?? "").toLowerCase() === name);
    const match = moves.find((e) => e.rank === character.guildRankName)
      ?? (moves.length ? undefined : events.find((e) => e.kind === "join" && e.actor.toLowerCase() === name));
    if (!match) continue;
    const seen = character.rankSeen;
    if (seen && seen.rankName === character.guildRankName && seen.since <= match.at) continue;
    await tx.characterRankSeen.upsert({ where: { characterId: character.id },
      create: { characterId: character.id, rankName: character.guildRankName!, since: match.at },
      update: { rankName: character.guildRankName!, since: match.at } });
    dated++;
  }
  return dated;
}

export interface RosterFreshness {
  /** When the newest stored roster reading was taken in game. */
  at: Date;
  /** Display name of the member whose upload brought it (null: unknown or since left). */
  by: string | null;
  /** Characters that reading lists in the guild. */
  members: number;
}

/**
 * How fresh the stored guild roster is and whose upload last refreshed it (/setup status, 9.1,
 * docs/JEEVES_COMPARISON.md idea 3). Null when no upload ever brought a roster.
 */
export async function rosterFreshness(database: { guildRosterEntry: Pick<Prisma.TransactionClient["guildRosterEntry"], "findFirst" | "count">; member: Pick<Prisma.TransactionClient["member"], "findUnique"> },
  guildId: string, edition = "forever"): Promise<RosterFreshness | null> {
  const newest = await database.guildRosterEntry.findFirst({ where: { guildId, gameEdition: edition }, orderBy: [{ observedAt: "desc" }, { inGuild: "desc" }], select: { observedAt: true, reportedById: true } });
  if (!newest) return null;
  const [members, reporter] = await Promise.all([
    database.guildRosterEntry.count({ where: { guildId, gameEdition: edition, inGuild: true } }),
    newest.reportedById ? database.member.findUnique({ where: { id: newest.reportedById }, select: { displayName: true } }) : null
  ]);
  return { at: newest.observedAt, by: reporter?.displayName ?? null, members };
}
