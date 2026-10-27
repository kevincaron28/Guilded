import { publicRules } from "./public-score.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { activeSeason } from "./dungeon-import.js";
import { leaderboard } from "./dungeon-stats.js";
import { DEFAULT_DUNGEON_CONFIG, dungeonConfig, formatDuration, type DungeonConfig } from "./dungeon-rules.js";
import { dungeonRating, hasDungeonRating } from "./dungeon-rating.js";
import { currentIntegrityPolicy, UPLOAD_GRACE_MS } from "./dungeon-integrity.js";
import { currentEdition } from "./edition-context.js";

// Officer corrections for the dungeon challenge (roadmap D7). Points are
// never edited or deleted: every change is a new DungeonPointTransaction,
// so the history always adds up and shows who did what.

type Db = Pick<PrismaClient, "$transaction" | "officialSeason" | "dungeonRun" | "dungeonPointTransaction" | "dungeonSeason" | "guildSettings" | "dungeonAchievement" | "member">;

export const POINT_RULES = ["completion", "noDeaths", "oneDeath", "twoDeaths", "personalRecord", "guildRecord", "firstCompletion", "fullGuildGroup", "underTarget"] as const;

// Marks a run as not counted and takes back every point it gave.
export async function invalidateRun(database: Db, guildId: string, runRef: string, reason: string, actor: string) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
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

export function describeConfig(config: DungeonConfig, dungeonNames: Map<number, string>): string {
  const rules = POINT_RULES.map((rule) => {
    const changed = config[rule] !== DEFAULT_DUNGEON_CONFIG[rule] ? ` (default ${DEFAULT_DUNGEON_CONFIG[rule]})` : "";
    return `\`${rule}\` ${config[rule]}${changed}`;
  });
  const targets = Object.entries(config.targets).map(([id, seconds]) => `${dungeonNames.get(Number(id)) ?? `#${id}`} ${formatDuration(seconds)}`);
  return [
    `**Points:** ${rules.join(" · ")}`,
    `**Same dungeon in one week:** ${config.weeklyRepeat.map((share) => `${Math.round(share * 100)}%`).join(" → ")} (resets Tuesday)`,
    `**Target times:** ${targets.length ? targets.join(" · ") : "none (season rating targets are listed in `/dungeon rules`)"}`,
    `**Dungeon Master achievement:** ${config.dungeonMasterCount} different dungeons`
  ].join("\n");
}

// Ends the current season (kept for history), crowns its Season Champion
// (highest rating, or legacy participation; ties share the crown).
// An optional expected ID makes one-time migration retries safe; null expects no active season.
// startsAt (default now) may be later than now: runs before it do not count for the new season.
export async function startSeason(database: Db, guildId: string, name: string, expectedSeasonId?: string | null, endsAt?: Date, presetRules?: unknown, startsAt?: Date, official = false) {
  if (presetRules && !hasDungeonRating(presetRules)) throw new Error("Invalid season preset.");
  if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= Date.now())) throw new Error("Season end must be a future date with a time zone.");
  if (startsAt && (!Number.isFinite(startsAt.getTime()) || endsAt && startsAt >= endsAt)) throw new Error("Season start must be a date before its end.");
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) throw new Error("Season name must be 2 to 60 characters.");
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    await lockDungeonCalendar(tx);
    if (official && startsAt) {
      const row = await tx.officialSeason.findFirst({where:{gameEdition:currentEdition(),startsAt},select:{id:true}});
      if (!row) throw new Error("The official calendar changed; retry rotation.");
      const next = await tx.officialSeason.findFirst({where:{gameEdition:currentEdition(),startsAt:{gt:startsAt}},orderBy:{startsAt:"asc"},select:{startsAt:true}});
      endsAt = next?.startsAt;
    }
    const ending = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    if (expectedSeasonId !== undefined && (ending?.id ?? null) !== expectedSeasonId) throw new Error("The active season changed; no season was rotated.");
    if (ending && currentIntegrityPolicy(ending.ratingRules)) {
      const now = new Date(), boundary = startsAt ?? now;
      const closing = await tx.dungeonSeason.findMany({ where: { guildId, status: "ACTIVE" } });
      if (closing.some(past => !currentIntegrityPolicy(past.ratingRules))) throw new Error("Mixed active season policies require review before rotation.");
      for (const past of closing) await tx.dungeonSeason.update({ where: { id: past.id }, data: {
        status: "CLOSING", endsAt: past.endsAt && past.endsAt < boundary ? past.endsAt : boundary
      } });
      // No snapshot or champion yet: eligible delayed uploads have 72 hours.
      const season = await tx.dungeonSeason.create({ data: { guildId, name: trimmed, startsAt: boundary, ...(endsAt ? { endsAt } : {}),
        ratingRules: (presetRules as Prisma.InputJsonValue | undefined) ?? publicRules() as unknown as Prisma.InputJsonValue } });
      return { season, ended: closing.map(row=>row.name), champions: [] as string[] };
    }
    const count = ending ? await tx.member.count({ where: { guildId } }) : 0;
    const top = ending ? await leaderboard(tx, guildId, "season", null, Math.max(count, 1)) : [];
    const rated = ending && hasDungeonRating(ending.ratingRules) ? await dungeonRating(tx, guildId, ending, null, true) : null;
    const competition = rated ?? top;
    const champions = competition.filter((row) => row.points > 0 && row.points === competition[0]?.points);
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
    // Freeze names, points and scoring rules while the season lock is held.
    // Each accidentally duplicated active season receives its own standings.
    const rules = await tx.guildSettings.findUnique({ where: { guildId }, select: { dungeonConfig: true } });
    for (const past of ended) {
      const standings = past.id === ending?.id ? top : await leaderboard(tx, guildId, "season", null, Math.max(count, 1), now, past.id);
      const rating = hasDungeonRating(past.ratingRules) ? (past.id === ending?.id ? rated : await dungeonRating(tx, guildId, past)) : null;
      await tx.dungeonSeason.update({ where: { id: past.id }, data: {
        finalStandings: standings as unknown as Prisma.InputJsonValue,
        ...(rating ? { finalRating: rating as unknown as Prisma.InputJsonValue } : {}),
        rulesSnapshot: dungeonConfig(rules?.dungeonConfig) as unknown as Prisma.InputJsonValue
      } });
    }
    await tx.dungeonSeason.updateMany({ where: { guildId, status: "ACTIVE" }, data: { status: "ENDED", endsAt: now } });
    for (const past of ended) if (past.endsAt && past.endsAt < now) {
      await tx.dungeonSeason.update({ where: { id: past.id }, data: { endsAt: past.endsAt } });
    }
    const season = await tx.dungeonSeason.create({ data: { guildId, name: trimmed, startsAt: startsAt ?? now, ...(endsAt ? { endsAt } : {}),
      ratingRules: (presetRules as Prisma.InputJsonValue | undefined) ?? publicRules() as unknown as Prisma.InputJsonValue } });
    return { season, ended: ended.map((row) => row.name), champions: champions.map((row) => row.name) };
  });
}

/** Shares the import/rotation guild lock; exact deadline and retries cannot award twice. */
export async function finalizeClosingSeasons(database: Db, now = new Date(), allows: (discordId: string) => boolean = () => true): Promise<string[]> {
  const due = await database.dungeonSeason.findMany({ where: { status: "CLOSING", endsAt: { lte: new Date(now.getTime() - UPLOAD_GRACE_MS) },
    guild: { gameEdition: currentEdition() } }, select: { id: true, guildId: true, guild: { select: { discordId: true } } } });
  const finalized: string[] = [];
  for (const candidate of due) {
    if (!allows(candidate.guild.discordId)) continue;
    const done = await database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.guildId}, 0))`;
      await lockDungeonCalendar(tx);
      const season = await tx.dungeonSeason.findFirst({ where: { id: candidate.id, guildId: candidate.guildId, status: "CLOSING" } });
      if (!season || !currentIntegrityPolicy(season.ratingRules) || !season.endsAt || now.getTime() < season.endsAt.getTime() + UPLOAD_GRACE_MS) return false;
      const count = await tx.member.count({ where: { guildId: season.guildId } });
      const standings = await leaderboard(tx, season.guildId, "season", null, Math.max(count, 1), now, season.id);
      const rating = await dungeonRating(tx, season.guildId, season, null, true);
      const rules = await tx.guildSettings.findUnique({ where: { guildId: season.guildId }, select: { dungeonConfig: true } });
      const best = new Map<string, number>();
      for (const row of rating) best.set(row.bracket ?? "all", Math.max(best.get(row.bracket ?? "all") ?? 0, row.points));
      for (const champion of rating.filter(row=>row.points > 0 && row.points === best.get(row.bracket ?? "all"))) {
        const key = `seasonChampion:${season.id}`;
        await tx.dungeonAchievement.upsert({ where: { guildId_memberId_key: { guildId: season.guildId, memberId: champion.memberId, key } },
          create: { guildId: season.guildId, memberId: champion.memberId, key, seasonId: season.id }, update: {} });
      }
      await tx.dungeonSeason.update({ where: { id: season.id }, data: { status: "ENDED", finalStandings: standings as unknown as Prisma.InputJsonValue,
        finalRating: rating as unknown as Prisma.InputJsonValue, rulesSnapshot: dungeonConfig(rules?.dungeonConfig) as unknown as Prisma.InputJsonValue } });
      return true;
    });
    if (done) finalized.push(candidate.guildId);
  }
  return finalized;
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
