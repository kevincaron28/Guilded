import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { weekStart } from "./dungeon-rules.js";
import { weekKeyOf, weekRange } from "./world-pvp.js";
import type { Standing } from "./community-rules.js";

// In-game guild activity inside the community leaderboard (14 November 2026, docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md).
// A member's community points are their Discord points (the community ledger, unchanged) plus the in-game points computed here from
// the tables that already hold dungeons, duels, battlegrounds and open-world PvP. Nothing is written to the community ledger:
// these points count toward the earned score and the rank, never toward the spendable balance.
//
// The old guild activity ladder's values and weekly bounds are kept as they were ("old units"); a divisor per source turns them into
// community points so that game activity sits in the same range as Discord activity (owner choice 14 November 2026: divide by 3).
// Rebalance, owner decision 15 November 2026 (docs/plans/COMMUNITY_SCORING_PROPOSAL_2026-11-14.md): dungeons divide by 5 and are
// bounded at 500 raw per reset week (100 community points); duels cap 80, battlegrounds 150, open-world PvP 75 raw per week.

// Server-side scoring configuration. Nothing here is shown to members: the board only says what kinds of play count. Defaults below
// can be overridden for the whole bot with the optional environment variable COMMUNITY_INGAME_SCORING (a JSON object with any of
// these keys); a value that does not parse is ignored and the defaults apply.
const soft = (full: number, half: number) => z.object({ full: z.number().int().min(0).max(100).default(full), half: z.number().int().min(0).max(100).default(half) }).default({ full, half });
const scoringSchema = z.object({
  dungeons: z.object({ divisor: z.number().min(1).max(100).default(5), weekCap: z.number().min(0).default(500) }).default({ divisor: 5, weekCap: 500 }),
  duels: z.object({ divisor: z.number().min(1).max(100).default(3), win: z.number().min(0).default(5), loss: z.number().min(0).default(2), weekCap: z.number().min(0).default(80),
    soft: soft(4, 4), rematchDays: z.number().min(0).max(60).default(7) }).default({ divisor: 3, win: 5, loss: 2, weekCap: 80, soft: { full: 4, half: 4 }, rematchDays: 7 }),
  battlegrounds: z.object({ divisor: z.number().min(1).max(100).default(3), game: z.number().min(0).default(15), win: z.number().min(0).default(5), weekCap: z.number().min(0).default(150),
    soft: soft(3, 3) }).default({ divisor: 3, game: 15, win: 5, weekCap: 150, soft: { full: 3, half: 3 } }),
  worldPvp: z.object({ divisor: z.number().min(1).max(100).default(3), kill: z.number().min(0).default(5), defend: z.number().min(0).default(5), call: z.number().min(0).default(5), weekCap: z.number().min(0).default(75) })
    .default({ divisor: 3, kill: 5, defend: 5, call: 5, weekCap: 75 })
});
export type InGameScoring = z.infer<typeof scoringSchema>;
export const defaultScoring = (): InGameScoring => scoringSchema.parse({});
let configured: InGameScoring | undefined;
/** The active scoring: the defaults, or the environment override when it parses. */
export function scoring(): InGameScoring {
  if (configured) return configured;
  try { const raw = process.env["COMMUNITY_INGAME_SCORING"]; configured = raw ? scoringSchema.parse(JSON.parse(raw)) : defaultScoring(); }
  catch { configured = defaultScoring(); }
  return configured;
}
/**
 * The scoring that applied before the 15 November 2026 rebalance, kept exactly for seasons that began before 1 November 2026 once they
 * are closed (owner decision: closed seasons keep their old numbers). Dungeons divide by 3 with no weekly bound; every other value is
 * what origin/main had. The environment override never touches this set.
 */
export const legacyScoring = (): InGameScoring => ({
  dungeons: { divisor: 3, weekCap: Infinity },
  duels: { divisor: 3, win: 5, loss: 2, weekCap: 100, soft: { full: 4, half: 4 }, rematchDays: 7 },
  battlegrounds: { divisor: 3, game: 15, win: 5, weekCap: 300, soft: { full: 3, half: 3 } },
  worldPvp: { divisor: 3, kill: 5, defend: 5, call: 5, weekCap: 125 }
});
/** Seasons that began before this instant use the legacy scoring once ended; open and later seasons use the current one. */
export const REBALANCE_FROM = new Date("2026-11-01T00:00:00Z");
/**
 * Which scoring a season uses, decided from the season's own start and status. The start is used rather than the end because a
 * monthly season ends with its calendar month in guild time (October ends 1 Nov ~04:00 UTC, after the boundary). Closed seasons
 * normally read their frozen finalStandings and never get here; this covers the archive-time computation and any recompute.
 */
export const scoringForSeason = (season: { createdAt: Date; status: string } | null): InGameScoring =>
  season && season.status === "ENDED" && season.createdAt < REBALANCE_FROM ? legacyScoring() : scoring();
/** With no active community season the board looks at this many days. */
export const FALLBACK_DAYS = 28;

export interface InGameEvent { memberId: string; win: boolean; at: Date; opponentId?: string }
/** One dungeon ledger row: raw points and the moment they count (the run's end, else the row's own date). */
export interface DungeonEvent { memberId: string; amount: number; at: Date }
export interface InGameWorldWeek { memberId: string; weekKey: number; kills: number; defends: number; helped: number }
/** Community points per source for one member (already divided and rounded). */
export interface InGamePoints { dungeons: number; pvp: number; total: number }
export type MergedStanding = Standing & { discord: number; dungeons: number; pvp: number };

const weekKey = (at: Date) => weekStart(at).toISOString();
const dayKey = (at: Date) => at.toISOString().slice(0, 10);
const share = (oldUnits: number, divisor: number) => Math.round(oldUnits / divisor);

/**
 * Pure: old-unit points per member from one kind of event. Per member and day the first events count in full, the next ones half,
 * then a quarter; an opponent met again within `rematchDays` counts half; the total per reset week is bounded.
 */
export function cappedPoints(events: readonly InGameEvent[], win: number, other: number, weekCap: number, options: { soft?: { full: number; half: number }; rematchDays?: number } = {}): Map<string, number> {
  const weekly = new Map<string, number>(), perDay = new Map<string, number>(), lastMet = new Map<string, number>();
  for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let factor = 1;
    if (options.soft) {
      const key = `${event.memberId}|${dayKey(event.at)}`, n = perDay.get(key) ?? 0;
      perDay.set(key, n + 1);
      factor = n < options.soft.full ? 1 : n < options.soft.full + options.soft.half ? 0.5 : 0.25;
    }
    if (options.rematchDays && event.opponentId) {
      const key = `${event.memberId}|${event.opponentId}`, before = lastMet.get(key);
      if (before !== undefined && event.at.getTime() - before < options.rematchDays * 86_400_000) factor *= 0.5;
      lastMet.set(key, event.at.getTime());
    }
    const key = `${event.memberId}|${weekKey(event.at)}`;
    weekly.set(key, Math.min(weekCap, (weekly.get(key) ?? 0) + (event.win ? win : other) * factor));
  }
  const totals = new Map<string, number>();
  for (const [key, points] of weekly) {
    const memberId = key.split("|")[0]!;
    totals.set(memberId, (totals.get(memberId) ?? 0) + points);
  }
  return totals;
}

/** Pure: old-unit dungeon points per member: each reset week is summed then bounded by `weekCap`, and the weeks are added. */
export function dungeonWeekPoints(events: readonly DungeonEvent[], weekCap = scoring().dungeons.weekCap): Map<string, number> {
  const weekly = new Map<string, number>();
  for (const event of events) { const key = `${event.memberId}|${weekKey(event.at)}`; weekly.set(key, (weekly.get(key) ?? 0) + event.amount); }
  const totals = new Map<string, number>();
  // Each week is bounded on its own and never below zero, so a negative admin adjustment cannot reduce another week. With no bound
  // at all (the legacy scoring) the sums are added as they were, negatives included.
  for (const [key, sum] of weekly) { const memberId = key.split("|")[0]!; totals.set(memberId, (totals.get(memberId) ?? 0) + (Number.isFinite(weekCap) ? Math.min(weekCap, Math.max(0, sum)) : sum)); }
  return totals;
}

/** Pure: old-unit open-world PvP points per member, bounded per member per reset week (kills, defends and calls; deaths score nothing). */
export function worldPvpPoints(weeks: readonly InGameWorldWeek[], config = scoring().worldPvp): Map<string, number> {
  const totals = new Map<string, number>();
  for (const week of weeks) {
    const units = Math.min(config.weekCap, week.kills * config.kill + week.defends * config.defend + week.helped * config.call);
    totals.set(week.memberId, (totals.get(week.memberId) ?? 0) + units);
  }
  return totals;
}

/** Pure: community points per member id (dungeons, and PvP = battlegrounds + duels + open world), members with nothing left out. */
export function inGamePoints(input: { dungeons: ReadonlyMap<string, number> | readonly DungeonEvent[]; duels: readonly InGameEvent[]; battlegrounds: readonly InGameEvent[]; worldWeeks: readonly InGameWorldWeek[] }, config = scoring()): Map<string, InGamePoints> {
  const duels = cappedPoints(input.duels, config.duels.win, config.duels.loss, config.duels.weekCap, { soft: config.duels.soft, rematchDays: config.duels.rematchDays });
  const battlegrounds = cappedPoints(input.battlegrounds, config.battlegrounds.game + config.battlegrounds.win, config.battlegrounds.game, config.battlegrounds.weekCap, { soft: config.battlegrounds.soft });
  const world = worldPvpPoints(input.worldWeeks, config.worldPvp);
  // A plain map is a member total taken as is; dated rows are bounded per reset week first.
  const dungeonTotals = input.dungeons instanceof Map ? input.dungeons : dungeonWeekPoints(input.dungeons as readonly DungeonEvent[], config.dungeons.weekCap);
  const ids = new Set([...dungeonTotals.keys(), ...duels.keys(), ...battlegrounds.keys(), ...world.keys()]);
  const out = new Map<string, InGamePoints>();
  for (const id of ids) {
    const dungeons = share(Math.max(0, dungeonTotals.get(id) ?? 0), config.dungeons.divisor);
    const pvp = share(duels.get(id) ?? 0, config.duels.divisor) + share(battlegrounds.get(id) ?? 0, config.battlegrounds.divisor) + share(world.get(id) ?? 0, config.worldPvp.divisor);
    if (dungeons + pvp > 0) out.set(id, { dungeons, pvp, total: dungeons + pvp });
  }
  return out;
}

/** Pure: Discord standings plus in-game points by Discord user id, ranked by the merged total (the balance stays Discord only). */
export function mergeStandings(base: readonly Standing[], inGame: ReadonlyMap<string, InGamePoints>): MergedStanding[] {
  const rows = new Map<string, MergedStanding>();
  for (const row of base) rows.set(row.userId, { ...row, discord: row.points, dungeons: 0, pvp: 0 });
  for (const [userId, points] of inGame) {
    const row = rows.get(userId) ?? { userId, points: 0, balance: 0, discord: 0, dungeons: 0, pvp: 0 };
    row.dungeons = points.dungeons; row.pvp = points.pvp; row.points = row.discord + points.total;
    rows.set(userId, row);
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
}

/** The breakdown of a stored or live row (an older stored row without one is all Discord). */
export const breakdownOf = (row: Standing & Partial<Pick<MergedStanding, "discord" | "dungeons" | "pvp">>) =>
  ({ discord: row.discord ?? row.points - (row.dungeons ?? 0) - (row.pvp ?? 0), dungeons: row.dungeons ?? 0, pvp: row.pvp ?? 0 });

type Db = Pick<PrismaClient, "dungeonPointTransaction" | "duelResult" | "battlegroundReport" | "worldPvpWeek" | "member" | "guild">;

/** The window the merged board looks at: the season's own, else the last four weeks. */
export const boardWindow = (season: { createdAt: Date; endedAt: Date | null; status: string } | null, now = new Date()) =>
  season ? { since: season.createdAt, until: season.status === "ENDED" && season.endedAt ? season.endedAt : now } : { since: new Date(now.getTime() - FALLBACK_DAYS * 86_400_000), until: now };

const DUNGEON_ROW_LIMIT = 200_000;
/**
 * Loads the in-game community points per Discord user id for one window. Only active members, counted duels (the duel caps already
 * applied), consented battleground reports and the member's own dungeon ledger; open-world weeks that start inside the window.
 */
export async function loadInGamePoints(db: Db, guildId: string, since: Date, until: Date, config: InGameScoring = scoring()): Promise<Map<string, InGamePoints>> {
  const guild = await db.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } });
  const edition = guild?.gameEdition ?? "forever";
  const active = { guildId, status: "ACTIVE" as const };
  const range = { gte: since, lte: until };
  const [points, duels, bgs, worldRows] = await Promise.all([
    db.dungeonPointTransaction.findMany({ where: { guildId, member: active, OR: [{ run: { endedAt: range } }, { runId: null, createdAt: range }] }, take: DUNGEON_ROW_LIMIT,
      orderBy: { createdAt: "desc" }, select: { memberId: true, amount: true, createdAt: true, run: { select: { endedAt: true } } } }),
    db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, archived: false, endedAt: range }, take: 20_000, orderBy: { endedAt: "desc" },
      select: { winnerId: true, loserId: true, endedAt: true, winner: { select: { status: true } }, loser: { select: { status: true } } } }),
    db.battlegroundReport.findMany({ where: { guildId, gameEdition: edition, status: "PROVISIONAL", endedAt: range, member: active }, take: 20_000, orderBy: { endedAt: "desc" },
      select: { memberId: true, outcome: true, endedAt: true } }),
    db.worldPvpWeek.findMany({ where: { guildId, member: active, weekKey: { gte: weekKeyOf(since), lte: weekKeyOf(until) } }, take: 20_000, orderBy: { weekKey: "desc" },
      select: { memberId: true, weekKey: true, kills: true, defends: true, helped: true } })
  ]);
  if (points.length >= DUNGEON_ROW_LIMIT) console.warn(`Community in-game points: dungeon rows hit the ${DUNGEON_ROW_LIMIT} read limit for guild ${guildId}; older rows are left out`);
  const duelEvents: InGameEvent[] = duels.flatMap(duel => [
    ...(duel.winner.status === "ACTIVE" ? [{ memberId: duel.winnerId, win: true, at: duel.endedAt, opponentId: duel.loserId }] : []),
    ...(duel.loser.status === "ACTIVE" ? [{ memberId: duel.loserId, win: false, at: duel.endedAt, opponentId: duel.winnerId }] : [])]);
  const bgEvents: InGameEvent[] = bgs.map(report => ({ memberId: report.memberId, win: report.outcome === "win", at: report.endedAt }));
  // A week that overlaps the window counts (a season that starts mid-week includes that week's open-world play).
  const worldWeeks = worldRows.filter(row => weekRange(row.weekKey).to > since);
  const byMember = inGamePoints({
    dungeons: points.map(row => ({ memberId: row.memberId, amount: row.amount, at: row.run?.endedAt ?? row.createdAt })), duels: duelEvents, battlegrounds: bgEvents, worldWeeks }, config);
  if (!byMember.size) return new Map();
  const members = await db.member.findMany({ where: { guildId, id: { in: [...byMember.keys()] } }, select: { id: true, discordUserId: true } });
  const byUser = new Map<string, InGamePoints>();
  for (const member of members) {
    const mine = byMember.get(member.id);
    if (!mine) continue;
    const known = byUser.get(member.discordUserId);
    byUser.set(member.discordUserId, known ? { dungeons: known.dungeons + mine.dungeons, pvp: known.pvp + mine.pvp, total: known.total + mine.total } : mine);
  }
  return byUser;
}

const cache = new Map<string, { at: number; value: Map<string, InGamePoints> }>();
const CACHE_MS = 60_000, CACHE_MAX = 200;
/** Test hook: forgets cached in-game reads. */
export const clearInGameCache = () => cache.clear();

/** The in-game points of a season's window; a live window is cached for a minute so a burst of "My points" clicks reads once. */
export async function seasonInGamePoints(db: Db, guildId: string, season: { createdAt: Date; endedAt: Date | null; status: string }, now = new Date()): Promise<Map<string, InGamePoints>> {
  const { since, until } = boardWindow(season, now);
  const live = !(season.status === "ENDED" && season.endedAt);
  const config = scoringForSeason(season), legacy = config.dungeons.weekCap === Infinity;
  const key = `${guildId}|${since.getTime()}|${live ? "live" : until.getTime()}|${legacy ? "legacy" : "current"}`;
  const hit = cache.get(key);
  if (hit && live && now.getTime() - hit.at < CACHE_MS && hit.at <= now.getTime() + 1000) return hit.value;
  const value = await loadInGamePoints(db, guildId, since, until, config);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now.getTime(), value });
  return value;
}

/** The merged standings of a Discord community season: the ledger's standings plus the in-game points for its window. */
export async function mergedSeasonStandings(db: Db, guildId: string, season: { createdAt: Date; endedAt: Date | null; status: string }, base: readonly Standing[], now = new Date()): Promise<MergedStanding[]> {
  return mergeStandings(base, await seasonInGamePoints(db, guildId, season, now));
}
