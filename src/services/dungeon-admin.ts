import type { Prisma, PrismaClient } from "@prisma/client";
import { activeSeason } from "./dungeon-import.js";
import { leaderboard } from "./dungeon-stats.js";
import { DEFAULT_DUNGEON_CONFIG, dungeonConfig, formatDuration, type DungeonConfig } from "./dungeon-rules.js";

// Officer corrections for the dungeon challenge (roadmap D7). Points are
// never edited or deleted: every change is a new DungeonPointTransaction,
// so the history always adds up and shows who did what.

type Db = Pick<PrismaClient, "$transaction" | "dungeonRun" | "dungeonPointTransaction" | "dungeonSeason" | "guildSettings" | "dungeonAchievement" | "member">;

export const POINT_RULES = ["completion", "noDeaths", "oneDeath", "twoDeaths", "personalRecord", "guildRecord", "firstCompletion", "fullGuildGroup", "underTarget"] as const;
export type PointRule = typeof POINT_RULES[number];

// Marks a run as not counted and takes back every point it gave.
export async function invalidateRun(database: Db, guildId: string, runRef: string, reason: string, actor: string) {
  return database.$transaction(async (tx) => {
    const run = await tx.dungeonRun.findUnique({ where: { guildId_runRef: { guildId, runRef } } });
    if (!run) throw new Error("Run not found. Pick it from the list.");
    if (!run.valid) throw new Error(`That run is already not counted (${run.invalidReason ?? "invalid"}).`);
    await tx.dungeonRun.update({ where: { id: run.id }, data: { valid: false, invalidReason: `officer: ${reason}` } });
    const given = await tx.dungeonPointTransaction.groupBy({ by: ["memberId"], where: { runId: run.id }, _sum: { amount: true } });
    let reversed = 0;
    for (const row of given) {
      const amount = row._sum.amount ?? 0;
      if (amount === 0) continue;
      await tx.dungeonPointTransaction.create({
        data: { guildId, memberId: row.memberId, runId: run.id, seasonId: run.seasonId, amount: -amount, reason: `Run not counted: ${reason}`, source: "admin:invalidate", createdBy: actor }
      });
      reversed += amount;
    }
    const revoked = await tx.dungeonAchievement.deleteMany({ where: { runId: run.id } });
    return { run, players: given.length, reversed, achievementsRevoked: revoked.count };
  });
}

// Manual points (negative takes points away). Counts for the current season.
export async function adjustPoints(database: Db, guildId: string, memberId: string, amount: number, reason: string, actor: string) {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10_000) throw new Error("Amount must be a whole number between -10000 and 10000, not 0.");
  const season = await activeSeason(database, guildId);
  return database.dungeonPointTransaction.create({
    data: { guildId, memberId, seasonId: season.id, amount, reason, source: amount > 0 ? "admin:award" : "admin:remove", createdBy: actor }
  });
}

export async function pointHistory(database: Db, guildId: string, filter: { memberId?: string; runRef?: string }, limit = 15) {
  const where: Prisma.DungeonPointTransactionWhereInput = { guildId };
  if (filter.memberId) where.memberId = filter.memberId;
  if (filter.runRef) where.run = { runRef: filter.runRef };
  return database.dungeonPointTransaction.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit,
    include: { member: { select: { displayName: true } }, run: { select: { runRef: true, dungeonName: true } } }
  });
}

async function saveConfig(database: Db, guildId: string, config: DungeonConfig) {
  const value = config as unknown as Prisma.InputJsonValue;
  await database.guildSettings.upsert({ where: { guildId }, create: { guildId, dungeonConfig: value }, update: { dungeonConfig: value } });
}

export async function readConfig(database: Db, guildId: string): Promise<DungeonConfig> {
  return dungeonConfig((await database.guildSettings.findUnique({ where: { guildId } }))?.dungeonConfig);
}

export async function setRulePoints(database: Db, guildId: string, rule: PointRule, points: number) {
  if (!POINT_RULES.includes(rule)) throw new Error("Unknown rule.");
  if (!Number.isInteger(points) || points < 0 || points > 10_000) throw new Error("Points must be a whole number from 0 to 10000.");
  const config = await readConfig(database, guildId);
  const before = config[rule];
  config[rule] = points;
  await saveConfig(database, guildId, config);
  return { before, after: points };
}

// Target time for the "under target" bonus; 0 minutes removes it.
export async function setTarget(database: Db, guildId: string, instanceId: number, minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240) throw new Error("Minutes must be from 0 to 240.");
  const config = await readConfig(database, guildId);
  const key = String(instanceId);
  if (minutes === 0) delete config.targets[key];
  else config.targets[key] = Math.round(minutes * 60);
  await saveConfig(database, guildId, config);
  return config.targets[key] ?? null;
}

export async function setDungeonMasterCount(database: Db, guildId: string, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Dungeon Master needs 1 to 100 different dungeons.");
  const config = await readConfig(database, guildId);
  const before = config.dungeonMasterCount;
  config.dungeonMasterCount = count;
  await saveConfig(database, guildId, config);
  return { before, after: count };
}

// Weekly repeat shares, e.g. "100,50,0" (percent for the 1st, 2nd, 3rd+ run).
export async function setWeeklyRepeat(database: Db, guildId: string, text: string) {
  const shares = text.split(/[,\s/]+/).filter(Boolean).map((part) => Number(part.replace("%", "")) / 100);
  if (shares.length === 0 || shares.length > 10 || shares.some((share) => !Number.isFinite(share) || share < 0 || share > 1)) {
    throw new Error("Write percents from 0 to 100 separated by commas, e.g. 100,50,0.");
  }
  const config = await readConfig(database, guildId);
  config.weeklyRepeat = shares;
  await saveConfig(database, guildId, config);
  return shares;
}

export function describeConfig(config: DungeonConfig, dungeonNames: Map<number, string>): string {
  const rules = POINT_RULES.map((rule) => {
    const changed = config[rule] !== DEFAULT_DUNGEON_CONFIG[rule] ? ` (default ${DEFAULT_DUNGEON_CONFIG[rule]})` : "";
    return `\`${rule}\` ${config[rule]}${changed}`;
  });
  const targets = Object.entries(config.targets).map(([id, seconds]) => `${dungeonNames.get(Number(id)) ?? `#${id}`} ${formatDuration(seconds)}`);
  return [
    `**Points:** ${rules.join(" · ")}`,
    `**Same dungeon in one week:** ${config.weeklyRepeat.map((share) => `${Math.round(share * 100)}%`).join(" → ")} (resets Tuesday)`,
    `**Target times:** ${targets.length ? targets.join(" · ") : "none (`/dungeon admin target`)"}`,
    `**Dungeon Master achievement:** ${config.dungeonMasterCount} different dungeons`
  ].join("\n");
}

// Ends the current season (kept for history), crowns its Season Champion
// (most points; a tie crowns everyone tied), and starts a new one.
export async function startSeason(database: Db, guildId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) throw new Error("Season name must be 2 to 60 characters.");
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    const ending = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    const count = ending ? await tx.member.count({ where: { guildId } }) : 0;
    const top = ending ? await leaderboard(tx, guildId, "season", null, Math.max(count, 1)) : [];
    const champions = top.filter((row) => row.points === top[0]?.points);
    const ended = await tx.dungeonSeason.findMany({ where: { guildId, status: "ACTIVE" } });
    if (ending) {
      for (const champion of champions) {
        const key = `seasonChampion:${ending.id}`;
        await tx.dungeonAchievement.upsert({
          where: { guildId_memberId_key: { guildId, memberId: champion.memberId, key } },
          create: { guildId, memberId: champion.memberId, key, seasonId: ending.id },
          update: {}
        });
      }
    }
    const now = new Date();
    await tx.dungeonSeason.updateMany({ where: { guildId, status: "ACTIVE" }, data: { status: "ENDED", endsAt: now } });
    const season = await tx.dungeonSeason.create({ data: { guildId, name: trimmed, startsAt: now } });
    return { season, ended: ended.map((row) => row.name), champions: champions.map((row) => row.name) };
  });
}

// Recent runs for the officer autocomplete (value = run id from the addon).
export async function runChoices(database: Pick<PrismaClient, "dungeonRun">, guildId: string, query: string) {
  const needle = query.trim().toLowerCase();
  const runs = await database.dungeonRun.findMany({
    where: { guildId }, orderBy: { createdAt: "desc" }, take: 100,
    select: { runRef: true, dungeonName: true, durationSec: true, valid: true, state: true, endedAt: true, players: { select: { character: true } } }
  });
  return runs
    .filter((run) => !needle || run.dungeonName.toLowerCase().includes(needle) || run.runRef.toLowerCase().includes(needle)
      || run.players.some((player) => player.character.toLowerCase().includes(needle)))
    .slice(0, 25)
    .map((run) => {
      const time = run.durationSec !== null && run.state === "COMPLETED" ? formatDuration(run.durationSec) : run.state.toLowerCase();
      const date = run.endedAt ? run.endedAt.toISOString().slice(0, 10) : "";
      const text = `${run.valid ? "" : "✗ "}${run.dungeonName} ${time} · ${run.players.map((player) => player.character).join(", ")} · ${date}`;
      return { name: text.length > 100 ? `${text.slice(0, 99)}…` : text, value: run.runRef };
    });
}
