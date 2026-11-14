import type { PrismaClient } from "../generated/prisma/client.js";
import { weekStart } from "./dungeon-rules.js";
import { weekKeyOf, weekRange } from "./world-pvp.js";
import type { Standing } from "./community-rules.js";

// In-game guild activity inside the community leaderboard (14 November 2026, docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md).
// A member's community points are their Discord points (the community ledger, unchanged) plus the in-game points computed here from
// the tables that already hold dungeons, duels, battlegrounds and open-world PvP. Nothing is written to the community ledger:
// these points count toward the earned score and the rank, never toward the spendable balance.
//
// The old guild activity ladder's values and weekly caps are kept as they were ("old units"); one divisor turns them into
// community points so that game activity does not bury Discord activity (a dungeon completion is 50 old units, 10 points).

/** One community point per this many old-unit in-game points. */
export const INGAME_DIVISOR = 5;
/** The old ladder's values (kept) plus open-world PvP, which is new and expressed in the same units. */
export const WEIGHTS = { duelWin: 5, duelLoss: 2, bgGame: 15, bgWin: 5, duelWeekCap: 100, bgWeekCap: 300, wpvpKill: 5, wpvpDefend: 5, wpvpCall: 5, wpvpWeekCap: 125 } as const;
/** With no active community season the board looks at this many days. */
export const FALLBACK_DAYS = 28;

export interface InGameEvent { memberId: string; win: boolean; at: Date }
export interface InGameWorldWeek { memberId: string; weekKey: number; kills: number; defends: number; helped: number }
/** Community points per source for one member (already divided and rounded). */
export interface InGamePoints { dungeons: number; pvp: number; total: number }
export type MergedStanding = Standing & { discord: number; dungeons: number; pvp: number };

const weekKey = (at: Date) => weekStart(at).toISOString();
const share = (oldUnits: number) => Math.round(oldUnits / INGAME_DIVISOR);

/** Pure: old-unit points per member from one kind of event, capped per member per reset week. */
export function cappedPoints(events: readonly InGameEvent[], win: number, other: number, weekCap: number): Map<string, number> {
  const weekly = new Map<string, number>();
  for (const event of events) {
    const key = `${event.memberId}\u0000${weekKey(event.at)}`;
    weekly.set(key, Math.min(weekCap, (weekly.get(key) ?? 0) + (event.win ? win : other)));
  }
  const totals = new Map<string, number>();
  for (const [key, points] of weekly) {
    const memberId = key.split("\u0000")[0]!;
    totals.set(memberId, (totals.get(memberId) ?? 0) + points);
  }
  return totals;
}

/** Pure: old-unit open-world PvP points per member, capped per member per reset week. */
export function worldPvpPoints(weeks: readonly InGameWorldWeek[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const week of weeks) {
    const units = Math.min(WEIGHTS.wpvpWeekCap, week.kills * WEIGHTS.wpvpKill + week.defends * WEIGHTS.wpvpDefend + week.helped * WEIGHTS.wpvpCall);
    totals.set(week.memberId, (totals.get(week.memberId) ?? 0) + units);
  }
  return totals;
}

/** Pure: community points per member id (dungeons, and PvP = battlegrounds + duels + open world), members with nothing left out. */
export function inGamePoints(input: { dungeons: ReadonlyMap<string, number>; duels: readonly InGameEvent[]; battlegrounds: readonly InGameEvent[]; worldWeeks: readonly InGameWorldWeek[] }): Map<string, InGamePoints> {
  const duels = cappedPoints(input.duels, WEIGHTS.duelWin, WEIGHTS.duelLoss, WEIGHTS.duelWeekCap);
  const battlegrounds = cappedPoints(input.battlegrounds, WEIGHTS.bgGame + WEIGHTS.bgWin, WEIGHTS.bgGame, WEIGHTS.bgWeekCap);
  const world = worldPvpPoints(input.worldWeeks);
  const ids = new Set([...input.dungeons.keys(), ...duels.keys(), ...battlegrounds.keys(), ...world.keys()]);
  const out = new Map<string, InGamePoints>();
  for (const id of ids) {
    const dungeons = share(Math.max(0, input.dungeons.get(id) ?? 0));
    const pvp = share(duels.get(id) ?? 0) + share(battlegrounds.get(id) ?? 0) + share(world.get(id) ?? 0);
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

/**
 * Loads the in-game community points per Discord user id for one window. Only active members, counted duels (the duel caps already
 * applied), consented battleground reports and the member's own dungeon ledger; open-world weeks that start inside the window.
 */
export async function loadInGamePoints(db: Db, guildId: string, since: Date, until: Date): Promise<Map<string, InGamePoints>> {
  const guild = await db.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } });
  const edition = guild?.gameEdition ?? "forever";
  const active = { guildId, status: "ACTIVE" as const };
  const range = { gte: since, lte: until };
  const [points, duels, bgs, worldRows] = await Promise.all([
    db.dungeonPointTransaction.groupBy({ by: ["memberId"], _sum: { amount: true },
      where: { guildId, member: active, OR: [{ run: { endedAt: range } }, { runId: null, createdAt: range }] } }),
    db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, archived: false, endedAt: range }, take: 20_000,
      select: { winnerId: true, loserId: true, endedAt: true, winner: { select: { status: true } }, loser: { select: { status: true } } } }),
    db.battlegroundReport.findMany({ where: { guildId, gameEdition: edition, status: "PROVISIONAL", endedAt: range, member: active }, take: 20_000,
      select: { memberId: true, outcome: true, endedAt: true } }),
    db.worldPvpWeek.findMany({ where: { guildId, member: active, weekKey: { gte: weekKeyOf(since), lte: weekKeyOf(until) } }, take: 20_000,
      select: { memberId: true, weekKey: true, kills: true, defends: true, helped: true } })
  ]);
  const duelEvents: InGameEvent[] = duels.flatMap(duel => [
    ...(duel.winner.status === "ACTIVE" ? [{ memberId: duel.winnerId, win: true, at: duel.endedAt }] : []),
    ...(duel.loser.status === "ACTIVE" ? [{ memberId: duel.loserId, win: false, at: duel.endedAt }] : [])]);
  const bgEvents: InGameEvent[] = bgs.map(report => ({ memberId: report.memberId, win: report.outcome === "win", at: report.endedAt }));
  const worldWeeks = worldRows.filter(row => weekRange(row.weekKey).from >= since);
  const byMember = inGamePoints({
    dungeons: new Map(points.map(row => [row.memberId, row._sum?.amount ?? 0] as const)), duels: duelEvents, battlegrounds: bgEvents, worldWeeks });
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

/** The merged standings of a Discord community season: the ledger's standings plus the in-game points for its window. */
export async function mergedSeasonStandings(db: Db, guildId: string, season: { createdAt: Date; endedAt: Date | null; status: string }, base: readonly Standing[], now = new Date()): Promise<MergedStanding[]> {
  const { since, until } = boardWindow(season, now);
  return mergeStandings(base, await loadInGamePoints(db, guildId, since, until));
}
