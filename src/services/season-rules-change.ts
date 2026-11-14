import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { reviseRules, validBracketedRules, type BracketedRules, type ScoringPatch } from "./dungeon-november-rules.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { currentEdition } from "./edition-context.js";
import { officialWindowAt, officialWindows } from "./official-seasons.js";
import { readRuleSnapshot, type PublicRuleSnapshot } from "./public-score.js";

// Owner-only change of the RUNNING season's scoring rules (owner decision, 14 November 2026: "unfreeze season 1 rules so season 2 is
// perfect"). Only a scoring block can change (ScoringPatch); targets, routes, brackets and best-N stay as frozen. Stored runs are never
// touched: scores, ranks and boards are computed from the runs and the season's rules whenever they are read, so replacing the rules is
// the whole recomputation. Every change is kept on the season's snapshot (who, when, from which rules to which, and the exact previous
// rules), which is what makes it reversible. A season that has ended is never changed.

export interface RulesRevision {
  at: string; by: string; action: "change" | "restore"; note: string;
  /** Plain descriptions, e.g. "version 6" -> "version 6 + boss-skip v1". */
  from: string; to: string;
  /** What was switched on or off, and the exact opposite (used by restore). */
  patch: ScoringPatch; inverse: ScoringPatch;
  /** The official snapshot's rules before the change, kept whole. */
  previous: BracketedRules;
  /** How many guild seasons were updated. */
  guilds: number;
}
export type RevisedSnapshot = PublicRuleSnapshot & { revisions?: RulesRevision[] };
export class RulesChangeError extends Error {}

export function describeRules(rules: BracketedRules): string {
  return `version ${rules.version}${rules.scoring ? " + level-fair targets" : ""}${rules.bossScoring ? " + boss-skip v1" : ""}`;
}
const inverseOf = (rules: BracketedRules, patch: ScoringPatch): ScoringPatch => ({ ...("bossScoring" in patch ? { bossScoring: rules.bossScoring ?? null } : {}) });

export interface ChangePlan {
  season: { id: string; number: number; name: string; start: Date; end: Date | null };
  snapshot: RevisedSnapshot;
  before: BracketedRules; after: BracketedRules;
  guildSeasons: { id: string; guildId: string; name: string }[];
  /** Why nothing would change (the rules already match), or null. */
  unchanged: boolean;
}
type Db = Pick<PrismaClient, "officialSeason" | "dungeonSeason">;

/** The change as it would be applied right now: the running official season, its new rules, the guild seasons that follow it. */
export async function planRulesChange(database: Db, patch: ScoringPatch, now: Date): Promise<ChangePlan> {
  const rows = await database.officialSeason.findMany({ where: { gameEdition: currentEdition() }, select: { id: true, number: true, name: true, startsAt: true, rules: true }, orderBy: { startsAt: "asc" } });
  const windows = officialWindows(rows);
  const window = officialWindowAt(windows, now);
  const row = rows.find((r) => window && r.number === window.number);
  if (!window || !row) throw new RulesChangeError("No season is running, so there is nothing to change.");
  if (window.end && window.end <= now) throw new RulesChangeError("The season has ended. Only the running season can be changed.");
  const snapshot = readRuleSnapshot(row.rules) as RevisedSnapshot | null;
  if (!snapshot) throw new RulesChangeError("The running season has no readable rules snapshot; nothing was changed.");
  let after: BracketedRules;
  try { after = reviseRules(snapshot.rules, patch); } catch (error) { throw new RulesChangeError(`The new rules are not valid: ${error instanceof Error ? error.message : String(error)}`); }
  const guildSeasons = await database.dungeonSeason.findMany({ where: { status: "ACTIVE", startsAt: { gte: window.start }, guild: { gameEdition: currentEdition() } }, select: { id: true, guildId: true, name: true, ratingRules: true } });
  const follow = guildSeasons.filter((s) => validBracketedRules(s.ratingRules));
  return { season: { id: row.id, number: row.number, name: row.name, start: window.start, end: window.end }, snapshot, before: snapshot.rules, after,
    guildSeasons: follow.map(({ id, guildId, name }) => ({ id, guildId, name })), unchanged: JSON.stringify(snapshot.rules) === JSON.stringify(after)
      // Switching on a rule that is already on keeps its original start date.
      || (!!patch.bossScoring && !!snapshot.rules.bossScoring && snapshot.rules.bossScoring.version === patch.bossScoring.version) };
}

/**
 * Applies `patch` to the running season: the official snapshot and every guild's active season of it. One transaction under the
 * exclusive calendar lock. The revision (who, when, from/to and the previous rules) is written in the same commit.
 */
export async function applyRulesChange(database: PrismaClient, patch: ScoringPatch, input: { by: string; note: string; now: Date; action?: "change" | "restore" }): Promise<{ plan: ChangePlan; revision: RulesRevision } | null> {
  return database.$transaction(async (tx) => {
    await lockDungeonCalendar(tx, true);
    const plan = await planRulesChange(tx, patch, input.now);
    if (plan.unchanged) return null;
    const revision: RulesRevision = { at: input.now.toISOString(), by: input.by.slice(0, 80), action: input.action ?? "change", note: input.note.slice(0, 300),
      from: describeRules(plan.before), to: describeRules(plan.after), patch, inverse: inverseOf(plan.before, patch), previous: plan.before, guilds: plan.guildSeasons.length };
    const snapshot: RevisedSnapshot = { ...plan.snapshot, rules: plan.after, revisions: [...(plan.snapshot.revisions ?? []), revision] };
    await tx.officialSeason.update({ where: { id: plan.season.id }, data: { rules: snapshot as unknown as Prisma.InputJsonValue } });
    for (const guildSeason of plan.guildSeasons) {
      const row = await tx.dungeonSeason.findUnique({ where: { id: guildSeason.id }, select: { ratingRules: true } });
      if (!row || !validBracketedRules(row.ratingRules)) continue;
      await tx.dungeonSeason.update({ where: { id: guildSeason.id }, data: { ratingRules: reviseRules(row.ratingRules, patch) as unknown as Prisma.InputJsonValue } });
    }
    return { plan, revision };
  }, { maxWait: 30_000, timeout: 60_000 });
}

/** Undoes the latest change that was not itself a restore, by applying its inverse. */
export async function restoreLastChange(database: PrismaClient, input: { by: string; now: Date; note?: string }): Promise<{ plan: ChangePlan; revision: RulesRevision; undone: RulesRevision } | null> {
  const rows = await database.officialSeason.findMany({ where: { gameEdition: currentEdition() }, select: { number: true, name: true, startsAt: true, rules: true }, orderBy: { startsAt: "asc" } });
  const window = officialWindowAt(officialWindows(rows), input.now);
  const snapshot = readRuleSnapshot(rows.find((r) => window && r.number === window.number)?.rules) as RevisedSnapshot | null;
  const revisions = snapshot?.revisions ?? [];
  // Pair each restore with the change it undid; the latest change without one is next.
  let pending = 0;
  let target: RulesRevision | undefined;
  for (let i = revisions.length - 1; i >= 0; i--) {
    if (revisions[i]!.action === "restore") pending++;
    else if (pending > 0) pending--;
    else { target = revisions[i]; break; }
  }
  if (!target) throw new RulesChangeError("There is no change to undo in the running season.");
  const result = await applyRulesChange(database, target.inverse, { by: input.by, note: input.note ?? `Restores the rules from ${target.at}`, now: input.now, action: "restore" });
  return result ? { ...result, undone: target } : null;
}

/** The revisions of the running season's snapshot, oldest first (for the history view). */
export function revisionsOf(value: unknown): RulesRevision[] {
  return (readRuleSnapshot(value) as RevisedSnapshot | null)?.revisions ?? [];
}
