import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { createBracketedDungeonRules, validBracketedRules, type BracketedRules } from "./dungeon-november-rules.js";
import { SEASON2_ENDGAME_ROUTES, SEASON2_WAITING, season2EndgameBrackets, season2EndgameRoutes } from "./dungeon-endgame-routes.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { currentEdition } from "./edition-context.js";
import { officialWindowAt, officialWindows } from "./official-seasons.js";
import { addedRules, readRuleSnapshot, type PublicRuleSnapshot } from "./public-score.js";

// "Add all dungeons to Season 1" (owner decision, 17 November 2026). Season 1 froze its rules on 4 November, before the routes Season 2
// brought (The Drowned City, levels 45-59 and level 60: dungeon-endgame-routes.ts), so runs on those maps showed "Dungeon route unknown".
// This adds exactly those routes (and the brackets they need) to the running season, the way freezeSeasonRules adds a launch route:
// existing routes, targets, levels, best-N, the over-level penalty and the evidence policy (current-v1) are never touched, and stored runs
// are never altered (scores are computed from the runs and the rules whenever they are read). A current-v2 season cannot gain routes.

/** What the frozen rules would gain, or null when they already have every route (or are current-v2). Pure. */
export function allDungeonsAddition(frozen: BracketedRules): { rules: BracketedRules; routes: string[]; brackets: string[] } | null {
  if (frozen.evidencePolicy === "current-v2") return null;
  const known = new Set(frozen.routes.map((r) => r.dungeonKey));
  const extra = season2EndgameRoutes().filter((r) => !known.has(r.dungeonKey));
  if (!extra.length) return null;
  const routes = [...frozen.routes, ...extra];
  const brackets = [...frozen.brackets, ...season2EndgameBrackets(routes).filter((b) => !frozen.brackets.some((x) => x.key === b.key))];
  const planIds = new Set(SEASON2_ENDGAME_ROUTES.map((r) => r.planId));
  const waiting = [...(frozen.provisional?.waiting ?? []).filter((w) => !planIds.has(w.id) && !SEASON2_WAITING.some((x) => x.id === w.id)), ...SEASON2_WAITING];
  // `current` only supplies the routes, brackets and waiting list; addedRules keeps every frozen value (targets, penalty, policy, leniency, recalibrations).
  const current = createBracketedDungeonRules({
    ...(frozen.gameEdition ? { gameEdition: frozen.gameEdition } : {}), routes, brackets, overlevelPenalty: frozen.overlevelPenalty,
    ...(frozen.evidencePolicy ? { evidencePolicy: frozen.evidencePolicy } : {}), ...(frozen.leniency ? { leniency: frozen.leniency } : {}),
    provisional: { plan: frozen.provisional?.plan ?? "season-1-all-dungeons", waiting }
  });
  return addedRules(frozen, current);
}

export interface AllDungeonsPlan {
  season: { id: string; number: number; name: string; start: Date; end: Date | null };
  snapshot: PublicRuleSnapshot;
  before: BracketedRules; after: BracketedRules | null; routes: string[]; brackets: string[];
  guildSeasons: { id: string; guildId: string; name: string }[];
}
export class AllDungeonsError extends Error {}
type Db = Pick<PrismaClient, "officialSeason" | "dungeonSeason">;

/** The change as it would be applied right now to the running official season and the guild seasons that follow it. */
export async function planAllDungeons(database: Db, now: Date): Promise<AllDungeonsPlan> {
  const rows = await database.officialSeason.findMany({ where: { gameEdition: currentEdition() }, select: { id: true, number: true, name: true, startsAt: true, rules: true }, orderBy: { startsAt: "asc" } });
  const window = officialWindowAt(officialWindows(rows), now);
  const row = rows.find((r) => window && r.number === window.number);
  if (!window || !row) throw new AllDungeonsError("No season is running, so there is nothing to change.");
  if (window.end && window.end <= now) throw new AllDungeonsError("The season has ended. Only the running season can be changed.");
  const snapshot = readRuleSnapshot(row.rules);
  if (!snapshot) throw new AllDungeonsError("The running season has no readable rules snapshot; nothing was changed.");
  const added = allDungeonsAddition(snapshot.rules);
  const guildSeasons = await database.dungeonSeason.findMany({ where: { status: "ACTIVE", startsAt: { gte: window.start }, guild: { gameEdition: currentEdition() } }, select: { id: true, guildId: true, name: true, ratingRules: true } });
  return { season: { id: row.id, number: row.number, name: row.name, start: window.start, end: window.end }, snapshot, before: snapshot.rules,
    after: added?.rules ?? null, routes: added?.routes ?? [], brackets: added?.brackets ?? [],
    guildSeasons: guildSeasons.filter((s) => validBracketedRules(s.ratingRules)).map(({ id, guildId, name }) => ({ id, guildId, name })) };
}

/** Writes the addition: the official snapshot and every active guild season of it, one transaction under the exclusive calendar lock. Idempotent. */
export async function applyAllDungeons(database: PrismaClient, now: Date): Promise<{ plan: AllDungeonsPlan; guilds: number } | null> {
  return database.$transaction(async (tx) => {
    await lockDungeonCalendar(tx, true);
    const plan = await planAllDungeons(tx, now);
    if (!plan.after) return null;
    const snapshot: PublicRuleSnapshot = { ...plan.snapshot, rules: plan.after, additions: [...plan.snapshot.additions, { at: now.toISOString(), routes: plan.routes, brackets: plan.brackets }] };
    await tx.officialSeason.update({ where: { id: plan.season.id }, data: { rules: snapshot as unknown as Prisma.InputJsonValue } });
    let guilds = 0;
    for (const guildSeason of plan.guildSeasons) {
      const row = await tx.dungeonSeason.findUnique({ where: { id: guildSeason.id }, select: { ratingRules: true } });
      if (!row || !validBracketedRules(row.ratingRules)) continue;
      const added = allDungeonsAddition(row.ratingRules);
      if (!added) continue;
      await tx.dungeonSeason.update({ where: { id: guildSeason.id }, data: { ratingRules: added.rules as unknown as Prisma.InputJsonValue } });
      guilds++;
    }
    return { plan, guilds };
  }, { maxWait: 30_000, timeout: 60_000 });
}
