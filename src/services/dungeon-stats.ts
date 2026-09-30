import type { Prisma, PrismaClient } from "@prisma/client";
import { weekStart } from "./dungeon-rules.js";

// Read-only views of the dungeon challenge (roadmap D5): leaderboards,
// records, a player's page, recent runs and the season. Invalidated runs
// never show up (valid: false), and their points are reversed with
// negative transactions, so point sums are always the true totals.

type Db = Pick<PrismaClient, "dungeonPointTransaction" | "dungeonRun" | "dungeonSeason" | "member" | "dungeonAchievement">;
export type Period = "week" | "season" | "all";

export interface LeaderRow { memberId: string; name: string; points: number }
export interface RecordRow { instanceId: number; dungeonName: string; difficultyId: number; durationSec: number; endedAt: Date | null; players: string[] }
export interface RunRow {
  id: string; runRef: string; dungeonName: string; difficultyId: number; state: string; valid: boolean; invalidReason: string | null;
  durationSec: number | null; endedAt: Date | null; players: { character: string; deaths: number | null }[]
}

const DIFFICULTY: Record<number, string> = { 1: "Normal", 2: "Heroic", 8: "Mythic+", 23: "Mythic", 24: "Timewalking" };
export function difficultyName(id: number): string {
  return DIFFICULTY[id] ?? (id ? `difficulty ${id}` : "");
}

export async function activeSeasonOrNull(database: Pick<PrismaClient, "dungeonSeason">, guildId: string) {
  return database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
}

// Which points count for a period. Weekly uses when the RUN ended (a run
// imported on Wednesday still counts for the week it was played); manual
// awards without a run use when they were given.
export async function pointsFilter(database: Pick<PrismaClient, "dungeonSeason">, guildId: string, period: Period, now = new Date(), seasonId?: string) {
  const where: Prisma.DungeonPointTransactionWhereInput = { guildId };
  if (period === "week") {
    const from = weekStart(now);
    where.OR = [{ run: { endedAt: { gte: from } } }, { runId: null, createdAt: { gte: from } }];
  } else if (period === "season") {
    const season = seasonId ? await database.dungeonSeason.findFirst({ where: { guildId, id: seasonId } }) : await activeSeasonOrNull(database, guildId);
    if (seasonId && !season) throw new Error("That season does not belong to this guild.");
    where.seasonId = season?.id ?? "none";
  }
  return where;
}

export async function leaderboard(database: Db, guildId: string, period: Period, instanceId: number | null, limit = 10, now = new Date(), seasonId?: string): Promise<LeaderRow[]> {
  const where = await pointsFilter(database, guildId, period, now, seasonId);
  if (instanceId !== null) where.run = { ...(where.run as object | undefined), instanceId };
  const grouped = await database.dungeonPointTransaction.groupBy({
    by: ["memberId"], where, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: limit + 5
  });
  const members = await database.member.findMany({ where: { id: { in: grouped.map((row) => row.memberId) } }, select: { id: true, displayName: true } });
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  return grouped
    .map((row) => ({ memberId: row.memberId, name: names.get(row.memberId) ?? "?", points: row._sum.amount ?? 0 }))
    .filter((row) => row.points > 0)
    .slice(0, limit);
}

const recordSelect = {
  instanceId: true, dungeonName: true, difficultyId: true, durationSec: true, endedAt: true,
  players: { select: { character: true } }
} as const;

// Fastest valid clear per dungeon + difficulty, or the top times of one dungeon.
export async function records(database: Db, guildId: string, instanceId: number | null, limit = 5): Promise<RecordRow[]> {
  const rows = await database.dungeonRun.findMany({
    where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, ...(instanceId !== null ? { instanceId } : {}) },
    orderBy: [{ durationSec: "asc" }, { endedAt: "asc" }],
    select: recordSelect,
    take: instanceId !== null ? limit : 1000
  });
  const toRow = (row: typeof rows[number]): RecordRow => ({
    instanceId: row.instanceId, dungeonName: row.dungeonName, difficultyId: row.difficultyId,
    durationSec: row.durationSec as number, endedAt: row.endedAt, players: row.players.map((player) => player.character)
  });
  if (instanceId !== null) return rows.map(toRow);
  const best = new Map<string, RecordRow>();
  for (const row of rows) {
    const key = `${row.instanceId}:${row.difficultyId}`;
    if (!best.has(key)) best.set(key, toRow(row));
  }
  return [...best.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName) || a.difficultyId - b.difficultyId);
}

const runSelect = {
  id: true, runRef: true, dungeonName: true, difficultyId: true, state: true, valid: true, invalidReason: true,
  durationSec: true, endedAt: true, players: { select: { character: true, deaths: true } }
} as const;

export async function recentRuns(database: Db, guildId: string, memberId: string | null, limit = 10): Promise<RunRow[]> {
  return database.dungeonRun.findMany({
    where: { guildId, ...(memberId ? { players: { some: { memberId } } } : {}) },
    orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
    select: runSelect,
    take: limit
  });
}

export interface PlayerSummary {
  weekPoints: number; seasonPoints: number; allTimePoints: number;
  completed: number; deathlessRuns: number;
  bests: RecordRow[];
  recent: RunRow[];
  achievements: { key: string; seasonName: string | null; earnedAt: Date }[];
}

export async function playerSummary(database: Db, guildId: string, memberId: string, now = new Date()): Promise<PlayerSummary> {
  const sum = async (period: Period) => {
    const where = await pointsFilter(database, guildId, period, now);
    const total = await database.dungeonPointTransaction.aggregate({ where: { ...where, memberId }, _sum: { amount: true } });
    return total._sum.amount ?? 0;
  };
  const [weekPoints, seasonPoints, allTimePoints] = [await sum("week"), await sum("season"), await sum("all")];
  const completedRuns = await database.dungeonRun.findMany({
    where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, players: { some: { memberId } } },
    orderBy: { durationSec: "asc" },
    select: { ...recordSelect, players: { select: { character: true, memberId: true, deaths: true } } }
  });
  const bests = new Map<string, RecordRow>();
  let deathlessRuns = 0;
  for (const row of completedRuns) {
    if (row.players.find((player) => player.memberId === memberId)?.deaths === 0) deathlessRuns++;
    const key = `${row.instanceId}:${row.difficultyId}`;
    if (!bests.has(key)) {
      bests.set(key, {
        instanceId: row.instanceId, dungeonName: row.dungeonName, difficultyId: row.difficultyId,
        durationSec: row.durationSec as number, endedAt: row.endedAt, players: row.players.map((player) => player.character)
      });
    }
  }
  return {
    weekPoints, seasonPoints, allTimePoints,
    completed: completedRuns.length,
    deathlessRuns,
    bests: [...bests.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName)),
    recent: await recentRuns(database, guildId, memberId, 5),
    achievements: (await database.dungeonAchievement.findMany({
      where: { guildId, memberId }, orderBy: { earnedAt: "asc" }, include: { season: { select: { name: true } } }
    })).map((row) => ({ key: row.key, seasonName: row.season?.name ?? null, earnedAt: row.earnedAt }))
  };
}

// Dungeons the guild has run, for autocomplete (value = instance id).
export async function dungeonChoices(database: Pick<PrismaClient, "dungeonRun">, guildId: string, query: string) {
  const rows = await database.dungeonRun.findMany({
    where: { guildId }, distinct: ["instanceId"], select: { instanceId: true, dungeonName: true }, orderBy: { instanceId: "asc" }, take: 200
  });
  const needle = query.trim().toLowerCase();
  return rows
    .filter((row) => !needle || row.dungeonName.toLowerCase().includes(needle))
    .sort((a, b) => a.dungeonName.localeCompare(b.dungeonName))
    .slice(0, 25)
    .map((row) => ({ name: row.dungeonName.slice(0, 100), value: String(row.instanceId) }));
}

// Season top 10 by in-game name (main character) for the addon's Dungeons
// tab; the companion writes it into Standings.lua.
export async function addonDungeonBoard(database: Db & Pick<PrismaClient, "character">, guildId: string) {
  const season = await activeSeasonOrNull(database, guildId);
  if (!season) return null;
  const rows = await leaderboard(database, guildId, "season", null, 10);
  const characters = await database.character.findMany({
    where: { memberId: { in: rows.map((row) => row.memberId) } }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { memberId: true, name: true }
  });
  const mainName = new Map<string, string>();
  for (const character of characters) if (!mainName.has(character.memberId)) mainName.set(character.memberId, character.name);
  return { season: season.name, rows: rows.map((row) => ({ name: mainName.get(row.memberId) ?? row.name, points: row.points })) };
}

// "1. Kev — 240" lines with medals for the top three.
export function formatLeaderboard(rows: LeaderRow[]): string {
  const medals = ["🥇", "🥈", "🥉"];
  return rows.map((row, index) => `${medals[index] ?? `${index + 1}.`} **${row.name}** — ${row.points}`).join("\n");
}
