import type { Prisma } from "../generated/prisma/client.js";

// WoW Forever full names (8.5, docs/FOREVER_NAMES.md). Before 8.5 the addon sent only a Forever
// character's first name, so a row may be named "Halidor" while its displayName says
// "Halidor Galemorne". This plans and applies the rename to the full name, for the owner's
// backfill script (scripts/forever-names.ts, preview unless --apply). Rules:
//   * only a Forever row whose name is one word, whose displayName is two words starting with it;
//   * never when another character of that guild shares the first name (ambiguous: listed);
//   * never deletes or merges; the old name is kept in legacyName, so every rename can be undone.
// Keys that follow the name (verify claims, race board entries) move with it, unless the new key
// already exists (then the old one is left and the row is listed).

export interface NameRow { id: string; guildId: string; name: string; displayName: string | null }
export interface PlannedRename { kind: "character" | "unclaimed"; id: string; guildId: string; from: string; to: string }
export interface NameReview { kind: "character" | "unclaimed"; id: string; guildId: string; name: string; reason: "shared first name" | "no full name known" }
export interface ForeverNamePlan { renames: PlannedRename[]; review: NameReview[] }

const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const lower = (value: string | null | undefined) => clean(value).normalize("NFC").toLowerCase();

/** The full name a first-name row already carries, or null. */
export function fullNameOf(row: Pick<NameRow, "name" | "displayName">): string | null {
  const name = clean(row.name), display = clean(row.displayName);
  if (!name || name.includes(" ")) return null;
  const words = display.split(" ");
  return words.length === 2 && words[0]!.toLowerCase() === name.toLowerCase() ? display : null;
}

/** Pure: what the backfill would rename, and what an officer has to look at. */
export function planForeverNames(characters: readonly NameRow[], unclaimed: readonly NameRow[]): ForeverNamePlan {
  const plan: ForeverNamePlan = { renames: [], review: [] };
  const shares = (rows: readonly NameRow[], self: NameRow, first: string) => rows.some((other) => other.guildId === self.guildId && other.id !== self.id
    && (lower(other.name) === first || lower(other.name).startsWith(`${first} `)));
  for (const row of characters) {
    const first = lower(row.name);
    if (!first || first.includes(" ")) continue;
    if (shares(characters, row, first)) { plan.review.push({ kind: "character", id: row.id, guildId: row.guildId, name: row.name, reason: "shared first name" }); continue; }
    const full = fullNameOf(row);
    if (!full) { plan.review.push({ kind: "character", id: row.id, guildId: row.guildId, name: row.name, reason: "no full name known" }); continue; }
    plan.renames.push({ kind: "character", id: row.id, guildId: row.guildId, from: clean(row.name), to: full });
  }
  for (const row of unclaimed) {
    const first = lower(row.name);
    if (!first || first.includes(" ")) continue;
    const full = fullNameOf(row);
    const linkedOther = characters.some((other) => other.guildId === row.guildId && lower(other.name).startsWith(`${first} `) && lower(other.name) !== lower(full));
    if (shares(unclaimed, row, first) || linkedOther) { plan.review.push({ kind: "unclaimed", id: row.id, guildId: row.guildId, name: row.name, reason: "shared first name" }); continue; }
    if (!full) continue; // an unlinked guildmate the addon has not heard in full yet: the next upload names it
    plan.renames.push({ kind: "unclaimed", id: row.id, guildId: row.guildId, from: clean(row.name), to: full });
  }
  return plan;
}

type Tx = Pick<Prisma.TransactionClient, "character" | "unclaimedCharacter" | "characterVerifyClaim" | "levelRaceEntry" | "raceHallEntry">;

export interface AppliedRenames { renamed: number; keysMoved: number; keysKept: number }

/** Applies a plan's renames inside the caller's transaction. Re-checks each row first. */
export async function applyForeverNames(tx: Tx, renames: readonly PlannedRename[]): Promise<AppliedRenames> {
  const result: AppliedRenames = { renamed: 0, keysMoved: 0, keysKept: 0 };
  const movedRaceKeys = new Set<string>();
  for (const rename of renames) {
    const oldKey = lower(rename.from), newKey = lower(rename.to);
    if (rename.kind === "character") {
      const row = await tx.character.findUnique({ where: { id: rename.id }, select: { name: true, guildId: true, gameEdition: true, realm: true } });
      if (!row || clean(row.name) !== rename.from || row.gameEdition !== "forever") continue;
      if (await tx.character.findFirst({ where: { guildId: row.guildId, gameEdition: "forever", realm: row.realm, name: rename.to }, select: { id: true } })) continue;
      for (const claim of await tx.characterVerifyClaim.findMany({ where: { guildId: rename.guildId, nameKey: oldKey } })) {
        const taken = await tx.characterVerifyClaim.findFirst({ where: { guildId: rename.guildId, memberId: claim.memberId, nameKey: newKey }, select: { id: true } });
        if (taken) { result.keysKept++; continue; }
        await tx.characterVerifyClaim.update({ where: { id: claim.id }, data: { nameKey: newKey } });
        result.keysMoved++;
      }
      await tx.character.update({ where: { id: rename.id }, data: { name: rename.to, legacyName: rename.from } });
    } else {
      const row = await tx.unclaimedCharacter.findUnique({ where: { id: rename.id }, select: { name: true } });
      if (!row || clean(row.name) !== rename.from) continue;
      if (await tx.unclaimedCharacter.findFirst({ where: { guildId: rename.guildId, nameKey: newKey }, select: { id: true } })) continue;
      await tx.unclaimedCharacter.update({ where: { id: rename.id }, data: { name: rename.to, nameKey: newKey, legacyName: rename.from } });
    }
    result.renamed++;
    const raceKey = `${rename.guildId}\n${oldKey}`;
    if (movedRaceKeys.has(raceKey)) continue;
    movedRaceKeys.add(raceKey);
    for (const store of [tx.levelRaceEntry, tx.raceHallEntry] as const) {
      const entry = await (store as typeof tx.levelRaceEntry).findFirst({ where: { guildId: rename.guildId, nameKey: oldKey }, select: { id: true } });
      if (!entry) continue;
      if (await (store as typeof tx.levelRaceEntry).findFirst({ where: { guildId: rename.guildId, nameKey: newKey }, select: { id: true } })) { result.keysKept++; continue; }
      await (store as typeof tx.levelRaceEntry).update({ where: { id: entry.id }, data: { nameKey: newKey, name: rename.to } });
      result.keysMoved++;
    }
  }
  return result;
}

/** Owner-readable lines per guild: counts, then every row an officer must look at. */
export function describePlan(plan: ForeverNamePlan, guildNames: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  const guilds = [...new Set([...plan.renames.map((r) => r.guildId), ...plan.review.map((r) => r.guildId)])].sort();
  for (const guildId of guilds) {
    const renames = plan.renames.filter((r) => r.guildId === guildId);
    const shared = plan.review.filter((r) => r.guildId === guildId && r.reason === "shared first name");
    const unknown = plan.review.filter((r) => r.guildId === guildId && r.reason === "no full name known");
    lines.push(`${guildNames.get(guildId) ?? guildId}: ${renames.length} to rename, ${shared.length} sharing a first name (left as is), ${unknown.length} with no full name yet (renamed by their own next upload)`);
    for (const rename of renames) lines.push(`  rename ${rename.kind} ${rename.from} -> ${rename.to}`);
    for (const row of shared) lines.push(`  REVIEW ${row.kind} ${row.name}: first name shared by several characters; an officer links or renames it`);
  }
  if (!lines.length) lines.push("No WoW Forever character still uses a first name only.");
  return lines;
}
