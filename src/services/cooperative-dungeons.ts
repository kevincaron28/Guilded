import type { PrismaClient } from "../generated/prisma/client.js";
import { validBracketedRules, validNovemberRules } from "./dungeon-november-rules.js";
import { withIntegrityWindow } from "./dungeon-integrity.js";
import { participationDungeonKey, participationMode, type ParticipationRun } from "./dungeon-participation.js";
import { weekWindow } from "./dungeon-periods.js";

export interface CooperativeRun extends ParticipationRun {
  id: string;
  guildId: string;
  seasonId: string | null;
  runRef: string;
  valid: boolean;
  state: string;
}
export interface CooperativeScope {
  guildId: string;
  seasonId: string;
  start: Date;
  end: Date;
  rules: unknown;
}

/** Read canonical imported rows, never observerReports or point totals. This is a
 * cosmetic projection using the season's existing eligibility, not an award. */
export function cooperativeDungeonProgress(scope: CooperativeScope, runs: CooperativeRun[]) {
  const rules = scope.rules;
  const routes = new Set<string>(), members = new Set<string>(), accepted = new Set<string>();
  if (!(validBracketedRules(rules) || validNovemberRules(rules)) || !Number.isFinite(scope.start.getTime()) || !Number.isFinite(scope.end.getTime()) || scope.end <= scope.start) {
    return { supported: false, runs: 0, dungeons: 0, participants: 0 };
  }
  // Repeated rows in a query/page must not increase progress. Inconsistent copies
  // are excluded altogether, rather than picking a stale valid copy by order.
  const copies = new Map<string, CooperativeRun[]>();
  for (const run of runs) {
    if (run.guildId !== scope.guildId || run.seasonId !== scope.seasonId) continue;
    const key = run.runRef;
    copies.set(key, [...(copies.get(key) ?? []), run]);
  }
  for (const [key, rows] of copies) {
    const run = rows[0]!;
    if (rows.some(row => JSON.stringify(row) !== JSON.stringify(run))) continue;
    if (!run.valid || run.state !== "COMPLETED" || !key || key.startsWith("SIM-")
      || !run.startedAt || !run.endedAt || !Number.isFinite(run.startedAt.getTime()) || !Number.isFinite(run.endedAt.getTime())
      || run.startedAt < scope.start || run.endedAt >= scope.end
      || run.endedAt <= run.startedAt || !run.durationSec || run.durationSec <= 0
      || run.completedBy !== "final boss") continue;
    const route = participationDungeonKey(run, rules);
    const band = rules.participationLevelBands[route];
    if (!band) continue;
    const eligible = new Set(run.players.filter(player => player.memberId
      && participationMode(run, player.character, band, rules) !== "none").map(player => player.memberId!));
    // At least two distinct linked guild members makes this a cooperative run.
    // Two alts on one account cannot satisfy this threshold.
    if (eligible.size < 2) continue;
    accepted.add(run.id);
    routes.add(route);
    for (const id of eligible) members.add(id);
  }
  return { supported: true, runs: accepted.size, dungeons: routes.size, participants: members.size };
}

/** Bounded, read-only preview. The guild identity is the existing edition scope;
 * caller must obtain it through requireGuildContext, never a submitted guild ID. */
export async function cooperativeDungeonPreview(database: Pick<PrismaClient, "dungeonSeason" | "dungeonRun">, guildId: string, now = new Date()) {
  const week = weekWindow(now);
  const season = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (!season || !(validBracketedRules(season.ratingRules) || validNovemberRules(season.ratingRules))) {
    return { supported: false, runs: 0, dungeons: 0, participants: 0, truncated: false, start: week.start, end: week.end };
  }
  const start = new Date(Math.max(week.start.getTime(), season.startsAt.getTime()));
  const end = new Date(Math.min(week.end.getTime(), season.endsAt?.getTime() ?? Infinity, now.getTime()));
  const rows = await database.dungeonRun.findMany({
    where: { guildId, seasonId: season.id, valid: true, state: "COMPLETED", startedAt: { gte: start }, endedAt: { lt: end }, NOT: { runRef: { startsWith: "SIM-" } } },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }], take: 2001,
    select: { id: true, guildId: true, seasonId: true, runRef: true, valid: true, state: true, instanceId: true,
      difficultyId: true, durationSec: true, completedBy: true, competitionData: true, startedAt: true, endedAt: true, createdAt: true,
      players: { where: { member: { guildId } }, select: { character: true, memberId: true, presentSec: true } } }
  });
  // Do not present a partial projection as completed challenge progress.
  if (rows.length > 2000) return { supported: true, runs: 0, dungeons: 0, participants: 0, truncated: true, start, end };
  return { ...cooperativeDungeonProgress({ guildId, seasonId: season.id, start, end,
    rules: withIntegrityWindow(season.ratingRules, season.startsAt, season.endsAt) }, rows), truncated: false, start, end };
}
