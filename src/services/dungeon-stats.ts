import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { dungeonConfig, weekStart } from "./dungeon-rules.js";
import { finalRows } from "./season-snapshot.js";
import { hasDungeonRating, dungeonRating, seasonDungeonCatalog, type LevelBand } from "./dungeon-rating.js";
import { validBracketedRules } from "./dungeon-november-rules.js";
import { weekSeason, weekWindow } from "./dungeon-periods.js";
import { participationDungeonKey, participationMode, participationRecordEligible, type ParticipationRun } from "./dungeon-participation.js";

// Read-only views of the dungeon challenge (roadmap D5): leaderboards,
// records, a player's page, recent runs and the season. Invalidated runs
// never show up (valid: false), and their points are reversed with
// negative transactions, so point sums are always the true totals.

type Db = Pick<PrismaClient, "dungeonPointTransaction" | "dungeonRun" | "dungeonSeason" | "member" | "dungeonAchievement" | "guildSettings">;
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
  instanceId: true, dungeonName: true, difficultyId: true, durationSec: true, endedAt: true, completedBy: true, competitionData: true,
  players: { select: { character: true, memberId: true, presentSec: true } }
} as const;

async function recordBands(database: Db, guildId: string): Promise<Record<string, LevelBand>> {
  const season = await activeSeasonOrNull(database, guildId);
  if (hasDungeonRating(season?.ratingRules) && (season!.ratingRules as { version: number }).version >= 3) {
    return (season!.ratingRules as unknown as { levelBands: Record<string, LevelBand> }).levelBands;
  }
  const settings = await database.guildSettings.findUnique({ where: { guildId } });
  return dungeonConfig(settings?.dungeonConfig).levelBands;
}

function recordName(row: ParticipationRun & { dungeonName: string }): string {
  const key = participationDungeonKey(row);
  return key.startsWith("189:") ? `Scarlet Monastery: ${key.split(":")[1]}` : row.dungeonName;
}

// Fastest eligible clear per wing + difficulty, or the top eligible times of one instance.
export async function records(database: Db, guildId: string, instanceId: number | null, limit = 5): Promise<RecordRow[]> {
  const bands = await recordBands(database, guildId);
  const rows = await database.dungeonRun.findMany({
    where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, ...(instanceId !== null ? { instanceId } : {}) },
    orderBy: [{ durationSec: "asc" }, { endedAt: "asc" }],
    select: recordSelect
  });
  const eligible = rows.filter(row => participationRecordEligible(row, bands[participationDungeonKey(row)]));
  const toRow = (row: typeof rows[number]): RecordRow => ({
    instanceId: row.instanceId, dungeonName: recordName(row), difficultyId: row.difficultyId,
    durationSec: row.durationSec as number, endedAt: row.endedAt, players: row.players.map((player) => player.character)
  });
  if (instanceId !== null) return eligible.slice(0, limit).map(toRow);
  const best = new Map<string, RecordRow>();
  for (const row of eligible) {
    const key = `${participationDungeonKey(row)}:${row.difficultyId}`;
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
  const bands = await recordBands(database, guildId);
  const sum = async (period: Period) => {
    const where = await pointsFilter(database, guildId, period, now);
    const total = await database.dungeonPointTransaction.aggregate({ where: { ...where, memberId }, _sum: { amount: true } });
    return total._sum.amount ?? 0;
  };
  const [weekPoints, seasonPoints, allTimePoints] = [await sum("week"), await sum("season"), await sum("all")];
  const completedRuns = await database.dungeonRun.findMany({
    where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, players: { some: { memberId } } },
    orderBy: { durationSec: "asc" },
    select: { ...recordSelect, players: { select: { character: true, memberId: true, deaths: true, presentSec: true } } }
  });
  const bests = new Map<string, RecordRow>();
  let deathlessRuns = 0;
  for (const row of completedRuns) {
    if (row.players.find((player) => player.memberId === memberId)?.deaths === 0) deathlessRuns++;
    const dungeonKey = participationDungeonKey(row);
    const band = bands[dungeonKey];
    if (!participationRecordEligible(row, band) || !row.players.some(player => player.memberId === memberId
      && participationMode(row, player.character, band) === "full")) continue;
    const key = `${dungeonKey}:${row.difficultyId}`;
    if (!bests.has(key)) {
      bests.set(key, {
        instanceId: row.instanceId, dungeonName: recordName(row), difficultyId: row.difficultyId,
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

function isoOrNull(date: Date | null | undefined): string | null {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

// Competitive scores retain each run character. Legacy participation/archive
// rows still use main names; the companion writes this into Standings.lua.
export async function addonDungeonBoard(database: Db & Pick<PrismaClient, "character">, guildId: string, now = new Date()) {
  const [active, past] = await Promise.all([
    activeSeasonOrNull(database, guildId),
    database.dungeonSeason.findMany({ where: { guildId, status: "ENDED" }, orderBy: { startsAt: "desc" }, take: 10 })
  ]);
  const selected = [...(active ? [active] : []), ...past];
  if (!selected.length) return null;
  const ratingRows = new Map(await Promise.all(selected.filter(season => hasDungeonRating(season.ratingRules))
    .map(async season => [season.id, await dungeonRating(database, guildId, season)] as const)));
  // Aggregate all requested seasons together: no leaderboard query per season.
  const totals = await database.dungeonPointTransaction.groupBy({
    by: ["seasonId", "memberId"], where: { guildId, seasonId: { in: selected.filter(season => !ratingRows.has(season.id) && finalRows(season.finalStandings) === null).map(season => season.id) } }, _sum: { amount: true }
  });
  const ids = [...new Set([...totals.map(row => row.memberId), ...selected.flatMap(season => (ratingRows.get(season.id) ?? finalRows(season.finalStandings))?.map(row => row.memberId) ?? [])])];
  const [members, characters] = await Promise.all([
    database.member.findMany({ where: { guildId, id: { in: ids } }, select: { id: true, displayName: true } }),
    database.character.findMany({ where: { member: { guildId }, memberId: { in: ids } },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { memberId: true, name: true } })
  ]);
  const names = new Map(members.map(member => [member.id, member.displayName]));
  const mainName = new Map<string, string>();
  for (const character of characters) if (!mainName.has(character.memberId)) mainName.set(character.memberId, character.name);
  const boards = selected.map(season => ({
    id: season.id, season: season.name, status: season.status,
    // ISO UTC; the addon labels each recent run with the season whose dates contain it.
    startsAt: isoOrNull(season.startsAt), endsAt: isoOrNull(season.endsAt),
    provisionalTargets: (season.ratingRules as { provisionalTargets?: boolean } | null)?.provisionalTargets === true,
    ratingVersion: hasDungeonRating(season.ratingRules) ? (season.ratingRules as { version: number }).version : 0,
    detailsAvailable: ratingRows.has(season.id) && ratingRows.get(season.id)!.every(row => row.details !== undefined),
    // All-level seasons: the brackets, and each profile/row's bracket.
    ...(validBracketedRules(season.ratingRules) ? { brackets: season.ratingRules.brackets.map(b => ({ ...b })) } : {}),
    profiles: (ratingRows.get(season.id) ?? []).filter(row => row.details !== undefined).map(row => ({
      name: row.character ?? mainName.get(row.memberId) ?? row.name, points: row.points, details: row.details!, ...(row.bracket ? { bracket: row.bracket } : {}),
      characters: row.character ? [] : characters.filter(character => character.memberId === row.memberId).map(character => character.name)
    })),
    catalog: seasonDungeonCatalog(season.ratingRules, ratingRows.get(season.id) ?? []),
    rows: ((ratingRows.get(season.id) ?? finalRows(season.finalStandings))?.map(row => ({ name: ("character" in row && typeof row.character === "string" ? row.character : undefined) ?? mainName.get(row.memberId) ?? row.name, points: row.points,
      ...("bracket" in row && typeof row.bracket === "string" ? { bracket: row.bracket } : {}) })) ?? totals.filter(row => row.seasonId === season.id && (row._sum.amount ?? 0) > 0)
      .map(row => ({ name: mainName.get(row.memberId) ?? names.get(row.memberId) ?? "?", points: row._sum.amount ?? 0 }))
    ).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, 50)
  }));
  // This week's board (since the weekly reset) for the active rated season: the addon's Week view.
  const current = selected[0]!.status === "ACTIVE" && hasDungeonRating(selected[0]!.ratingRules) ? weekSeason(selected[0]!, now) : null;
  const weekRows = current ? await dungeonRating(database, guildId, current) : null;
  const week = weekRows ? { startsAt: weekWindow(now).start.toISOString(), endsAt: weekWindow(now).end.toISOString(),
    rows: weekRows.filter(row => row.points > 0).map(row => ({ name: row.character ?? mainName.get(row.memberId) ?? row.name, points: row.points, ...(row.bracket ? { bracket: row.bracket } : {}) }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, 50) } : null;
  return { ...boards[0]!, ...(week ? { week } : {}), history: boards.slice(1) };
}

// "1. Kev — 240" lines with medals for the top three.
export function formatLeaderboard(rows: LeaderRow[]): string {
  const medals = ["🥇", "🥈", "🥉"];
  return rows.map((row, index) => `${medals[index] ?? `${index + 1}.`} **${row.name}** — ${row.points}`).join("\n");
}
