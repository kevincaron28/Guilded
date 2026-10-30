import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { validBracketedRules, validNovemberRules } from "./dungeon-november-rules.js";
import { cooperativeDungeonProgress } from "./cooperative-dungeons.js";
import { weekWindow } from "./dungeon-periods.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const cooperativeRulesHash = (rules: unknown) => createHash("sha256").update(JSON.stringify(canonical(rules))).digest("hex");
type Db = Pick<PrismaClient, "guild" | "dungeonSeason" | "cooperativeGoal" | "dungeonRun">;

export async function saveCooperativeGoal(database: Db, guildId: string, actorId: string, input: { seasonId: string; target: number; metric: string }, now = new Date()) {
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > 100 || !["dungeons", "runs"].includes(input.metric)) throw new Error("Choose a goal of 1–100 dungeons or runs.");
  const [guild, season] = await Promise.all([
    database.guild.findUniqueOrThrow({ where: { id: guildId }, select: { gameEdition: true } }),
    database.dungeonSeason.findFirst({ where: { id: input.seasonId, guildId, status: "ACTIVE" } })
  ]);
  if (!season || !(validBracketedRules(season.ratingRules) || validNovemberRules(season.ratingRules))) throw new Error("Choose an active season with supported frozen dungeon rules.");
  const week = weekWindow(now), startsAt = new Date(Math.max(week.start.getTime(), season.startsAt.getTime()));
  const endsAt = new Date(Math.min(week.end.getTime(), season.endsAt?.getTime() ?? Infinity));
  if (startsAt > now || endsAt <= now) throw new Error("That season is not open this week.");
  const data = { seasonId: season.id, edition: guild.gameEdition, seasonStartsAt: season.startsAt, seasonEndsAt: season.endsAt, target: input.target, metric: input.metric, startsAt, endsAt,
    rules: season.ratingRules, rulesHash: cooperativeRulesHash(season.ratingRules), paused: false, createdBy: actorId };
  return database.cooperativeGoal.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
}

export async function cooperativeGoalStatus(database: Db, guildId: string, now = new Date()) {
  const goal = await database.cooperativeGoal.findUnique({ where: { guildId } });
  if (!goal) return { status: "unconfigured" as const };
  if (goal.paused) return { status: "paused" as const, goal };
  const [guild, season] = await Promise.all([
    database.guild.findUniqueOrThrow({ where: { id: guildId }, select: { gameEdition: true } }),
    database.dungeonSeason.findFirst({ where: { id: goal.seasonId, guildId } })
  ]);
  // Rules/edition/calendar changes need a fresh officer decision. Do not silently
  // rebase a target onto another season or adopt a different eligibility policy.
  if (!season || guild.gameEdition !== goal.edition || cooperativeRulesHash(season.ratingRules) !== goal.rulesHash
    || cooperativeRulesHash(goal.rules) !== goal.rulesHash || goal.seasonStartsAt.getTime() !== season.startsAt.getTime()
    || goal.seasonEndsAt?.getTime() !== season.endsAt?.getTime() || goal.startsAt < season.startsAt || season.endsAt && goal.endsAt > season.endsAt) {
    return { status: "scope-changed" as const, goal };
  }
  const rows = await database.dungeonRun.findMany({ where: { guildId, seasonId: goal.seasonId, valid: true, state: "COMPLETED",
    startedAt: { gte: goal.startsAt }, endedAt: { lt: new Date(Math.min(now.getTime(), goal.endsAt.getTime())) }, NOT: { runRef: { startsWith: "SIM-" } } },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }], take: 2001,
    select: { id: true, guildId: true, seasonId: true, runRef: true, valid: true, state: true, instanceId: true, difficultyId: true,
      durationSec: true, completedBy: true, competitionData: true, startedAt: true, endedAt: true, createdAt: true,
      players: { where: { member: { guildId } }, select: { character: true, memberId: true, presentSec: true } } } });
  if (rows.length > 2000) return { status: "too-many-runs" as const, goal };
  const rules = goal.rules;
  if (!(validBracketedRules(rules) || validNovemberRules(rules))) return { status: "scope-changed" as const, goal };
  const progress = cooperativeDungeonProgress({ guildId, seasonId: goal.seasonId, start: goal.startsAt, end: goal.endsAt,
    rules: { ...rules, seasonWindow: { from: season.startsAt.toISOString(), to: season.endsAt?.toISOString() ?? null } } }, rows);
  const value = goal.metric === "runs" ? progress.runs : progress.dungeons;
  return { status: "active" as const, goal, progress, value, complete: value >= goal.target, ended: now >= goal.endsAt };
}
