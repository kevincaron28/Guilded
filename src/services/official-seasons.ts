import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { startSeason } from "./dungeon-admin.js";
import { createBracketedDungeonRules, validBracketedRules, type BracketedRules } from "./dungeon-november-rules.js";
import { addedRules, publicRules, readRuleSnapshot, snapshotRules, type PublicRuleSnapshot } from "./public-score.js";
import { currentEdition } from "./edition-context.js";
import { currentIntegrityPolicy } from "./dungeon-integrity.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { addCalendarMonths, readPeriodMetadata } from "./official-periods.js";

// The bot-wide dungeon season calendar (7.3, owner 20 October 2026: "only I control when a season
// starts and ends ... the first real season starting November 4th, then we change season when a
// big patch hits or after 2-3 months"). Only the bot's owner edits it (/guilded-season); officers
// cannot start or end dungeon seasons any more.
// - Season n runs from its start to season n+1's start. The latest season has no end until the
//   owner schedules the next one, so a season can last as long as a patch does.
// - Every guild follows it: when a season starts, each guild's active dungeon season is archived
//   (standings, rating and champions frozen; runs and points kept) and the new one starts, after
//   one backup. Idempotent: a guild already in the current season is left alone.
// - The public leaderboards (public-score.ts) use the same windows; before Season 1 is "Beta".
//   Each season freezes its public rules when it starts (freezeSeasonRules).

export interface OfficialWindow { number: number; name: string; start: Date; end: Date | null; rules?: PublicRuleSnapshot | null }
export interface OfficialRow { number: number; name: string; startsAt: Date; rules?: unknown }

/** Calendar rows (any order) as windows, oldest first: each ends where the next one starts. */
export function officialWindows(rows: OfficialRow[]): OfficialWindow[] {
  const sorted = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return sorted.map((row, i) => ({ number: row.number, name: row.name, start: row.startsAt, end: sorted[i + 1]?.startsAt ?? null, rules: readRuleSnapshot(row.rules) }));
}

/** The season running at `now`, or null before the first one starts. */
export function officialWindowAt(windows: OfficialWindow[], now: Date): OfficialWindow | null {
  for (let i = windows.length - 1; i >= 0; i--) if (windows[i]!.start <= now) return windows[i]!;
  return null;
}

/** The next season that has not started yet (the owner scheduled it), or null. */
export function scheduledNext(windows: OfficialWindow[], now: Date): OfficialWindow | null {
  return windows.find((w) => w.start > now) ?? null;
}

type Db = Pick<PrismaClient, "officialSeason"> & Partial<Pick<PrismaClient,"$transaction" | "dungeonSeason">>;

/** Serialize calendar changes with ingestion/finality and publish guild cutoffs
 * in the same commit. Never rewrite a closed/finalized season. */
async function mutateCalendar<T>(database: Db, now: Date, action: (tx: Db, lockedNow: Date) => Promise<T>, syncCutoffs = true): Promise<T> {
  if (!database.$transaction) return action(database,now);
  return database.$transaction(async tx=>{
    await lockDungeonCalendar(tx,true);
    const result = await action(tx,new Date(Math.max(now.getTime(),Date.now())));
    // Freezing/adding rules does not move a calendar boundary.
    if (!syncCutoffs) return result;
    const windows = await loadOfficialWindows(tx);
    const active = await tx.dungeonSeason.findMany({where:{status:"ACTIVE",guild:{gameEdition:currentEdition()}}});
    for (const season of active) {
      if (!currentIntegrityPolicy(season.ratingRules)) continue;
      const window = officialWindowAt(windows,season.startsAt);
      if (!window || window.start > now) continue;
      if (season.endsAt?.getTime() !== window.end?.getTime()) await tx.dungeonSeason.update({where:{id:season.id},data:{endsAt:window.end}});
    }
    return result;
  }, { maxWait: 30_000, timeout: 30_000 });
}

export async function loadOfficialWindows(database: Db): Promise<OfficialWindow[]> {
  return officialWindows(await database.officialSeason.findMany({ where: { gameEdition: currentEdition() }, select: { number: true, name: true, startsAt: true, rules: true }, orderBy: { startsAt: "asc" } }));
}

/**
 * Freezes the public leaderboard rules of the season running at `now`, once (later code changes
 * cannot rewrite its scores). Afterwards it only adds routes and brackets that did not exist when
 * it froze, e.g. level-60 routes once launch map IDs are known; existing targets, levels, best-N
 * and the penalty keep their frozen values until the next season. Seasons that ended are never touched.
 */
export async function freezeSeasonRules(database: Db, now: Date, current: BracketedRules = publicRules()): Promise<{ season: string; frozen: boolean; routes: string[]; brackets: string[] } | null> {
  // Most ticks have nothing to write. Avoid competing with imports/finality
  // for the exclusive calendar lock; every actual write is rechecked below.
  const pending = await database.officialSeason.findFirst({ where: { gameEdition: currentEdition(), startsAt: { lte: now } }, orderBy: { startsAt: "desc" }, select: { rules: true } });
  if (!pending) return null;
  if (pending.rules !== null) {
    const snapshot = readRuleSnapshot(pending.rules);
    if (!snapshot || !addedRules(snapshot.rules, current)) return null;
  }
  return mutateCalendar(database,now,async (database,now)=>{
  const row = await database.officialSeason.findFirst({ where: { gameEdition: currentEdition(), startsAt: { lte: now } }, orderBy: { startsAt: "desc" }, select: { id: true, name: true, rules: true } });
  if (!row) return null;
  const save = (snapshot: PublicRuleSnapshot) => database.officialSeason.update({ where: { id: row.id }, data: { rules: snapshot as unknown as Prisma.InputJsonValue } });
  if (row.rules === null) {
    await save(snapshotRules(current, now));
    return { season: row.name, frozen: true, routes: [], brackets: [] };
  }
  // A stored value this code cannot read is left alone, never replaced.
  const snapshot = readRuleSnapshot(row.rules);
  const added = snapshot && addedRules(snapshot.rules, current);
  if (!snapshot || !added) return null;
  await save({ ...snapshot, rules: added.rules, additions: [...snapshot.additions, { at: now.toISOString(), routes: added.routes, brackets: added.brackets }] });
  return { season: row.name, frozen: false, routes: added.routes, brackets: added.brackets };
  }, false);
}

export class SeasonCalendarError extends Error {}

/** Continue only the explicitly authorized Era quarterly calendar. Official
 * Retail/TBC/Mists boundaries remain unset until separately reviewed. */
export async function ensureQuarterlyCalendar(database: Db, now = new Date()): Promise<number> {
  if (currentEdition() !== "classic-era") return 0;
  const latest = await database.officialSeason.findFirst({ where: { gameEdition: "classic-era" }, orderBy: { startsAt: "desc" } });
  const metadata = readPeriodMetadata(readRuleSnapshot(latest?.rules)?.calendar);
  if (!latest || latest.startsAt > now || metadata?.kind !== "guilded-quarterly" || metadata.months !== 3) return 0;
  return mutateCalendar(database, now, async (tx, lockedNow) => {
    let last = await tx.officialSeason.findFirst({ where: { gameEdition: "classic-era" }, orderBy: { startsAt: "desc" } });
    if (!last || last.startsAt > lockedNow) return 0;
    const snapshot = readRuleSnapshot(last.rules);
    const calendar = readPeriodMetadata(snapshot?.calendar);
    if (!snapshot || calendar?.kind !== "guilded-quarterly" || calendar.months !== 3) return 0;
    let created = 0;
    while (last.startsAt <= lockedNow) {
      if (created >= 24) throw new SeasonCalendarError("Quarterly calendar has more than six years to recover; review it manually.");
      const startsAt = addCalendarMonths(last.startsAt);
      const nextNumber: number = last.number + 1;
      last = await tx.officialSeason.create({ data: { gameEdition: "classic-era", number: nextNumber, name: `Guilded Era Season ${nextNumber} (NA)`, startsAt,
        createdBy: "guilded-quarterly", rules: { ...snapshotRules(snapshot.rules, lockedNow), calendar: { ...calendar, guildedActivation: startsAt.toISOString() } } as unknown as Prisma.InputJsonValue } });
      created++;
    }
    return created;
  });
}

/** Install reviewed routes for the next season without rewriting historical scores. */
export async function configureNextSeasonRules(database: Db, input: unknown, now = new Date()): Promise<number> {
  const data = input as { gameEdition?: unknown } | null;
  if (!data || (data.gameEdition ?? "forever") !== currentEdition()) throw new SeasonCalendarError("Rules must name the selected WoW edition.");
  let rules: BracketedRules;
  try { rules = createBracketedDungeonRules(input); }
  catch (error) { throw new SeasonCalendarError(`Invalid dungeon rules: ${error instanceof Error ? error.message : String(error)}`); }
  if (!rules.routes.length || !rules.brackets.length) throw new SeasonCalendarError("Supply reviewed routes and at least one rated bracket.");
  return mutateCalendar(database,now,async (database,now)=>{
  const next = await database.officialSeason.findFirst({ where: { gameEdition: currentEdition(), startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: { id: true } });
  if (!next) throw new SeasonCalendarError("Schedule this edition's next season first.");
  const changed = await database.officialSeason.updateMany({ where: { id: next.id, gameEdition: currentEdition(), startsAt: { gt: new Date(Math.max(now.getTime(), Date.now())) } }, data: { rules: snapshotRules(rules, now) as unknown as Prisma.InputJsonValue } });
  if (changed.count !== 1) throw new SeasonCalendarError("The season has started. Schedule the next season to change its rules.");
  return rules.routes.length;
  });
}

/**
 * Schedules the next season (it ends the current one at `startsAt`). Replaces a next season that
 * has not started yet; never edits a season that already started.
 */
export async function scheduleNextSeason(database: Db, input: { name?: string | null; startsAt: Date; actorId: string }, now = new Date()): Promise<OfficialWindow> {
  if (!Number.isFinite(input.startsAt.getTime())) throw new SeasonCalendarError("Give the start as YYYY-MM-DD HH:MM.");
  if (input.startsAt <= now) throw new SeasonCalendarError("The new season must start in the future.");
  return mutateCalendar(database,now,async (database,now)=>{
  if (input.startsAt <= now) throw new SeasonCalendarError("The new season must start in the future.");
  const windows = await loadOfficialWindows(database);
  const current = officialWindowAt(windows, now);
  const pending = scheduledNext(windows, now);
  const number = pending?.number ?? (current?.number ?? 0) + 1;
  const name = (input.name?.trim() || `Season ${number}`).slice(0, 60);
  // Only one season can wait to start: re-scheduling replaces it.
  await database.officialSeason.deleteMany({ where: { gameEdition: currentEdition(), startsAt: { gt: now } } });
  await database.officialSeason.create({ data: { gameEdition: currentEdition(), number, name, startsAt: input.startsAt, createdBy: input.actorId,
    ...(pending?.rules ? { rules: pending.rules as unknown as Prisma.InputJsonValue } : {}) } });
  return { number, name, start: input.startsAt, end: null };
  });
}

/** Removes the season waiting to start; the current season then keeps running with no end. */
export async function cancelNextSeason(database: Db, now = new Date()): Promise<OfficialWindow | null> {
  return mutateCalendar(database,now,async (database,now)=>{
  const pending = scheduledNext(await loadOfficialWindows(database), now);
  if (!pending) return null;
  await database.officialSeason.deleteMany({ where: { gameEdition: currentEdition(), startsAt: { gt: now } } });
  return pending;
  });
}

type RotationDb = Pick<PrismaClient, "guildSettings" | "dungeonSeason"> & Partial<Pick<PrismaClient,"$transaction">>;
type StartFn = (guildId: string, name: string, expectedId: string | null, endsAt: Date | undefined, rules: unknown, startsAt: Date) => Promise<unknown>;
export interface OfficialRotation { guildId: string; season: string; ended: string | null }

/** One tick: moves every allowed guild into the official season that is running now. */
export async function rotateOfficialSeasons(database: RotationDb, windows: OfficialWindow[], now: Date, allows: (discordId: string) => boolean,
  backup: () => Promise<unknown>, start: StartFn): Promise<OfficialRotation[]> {
  const window = officialWindowAt(windows, now);
  if (!window) return [];
  // Never seed guild seasons from local overrides or a changing code default.
  // A failed/malformed official snapshot must stop rotation until it is repaired.
  if (!window.rules) throw new Error("Official dungeon rules must be frozen before guild seasons can start.");
  const rows = await database.guildSettings.findMany({ where: { guild: { gameEdition: currentEdition() } }, select: { guildId: true, guild: { select: { discordId: true } } } });
  const rotated: OfficialRotation[] = [];
  let backedUp = false;
  for (const row of rows) {
    if (!allows(row.guild.discordId)) continue;
    const active = await database.dungeonSeason.findFirst({ where: { guildId: row.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    // Already in this season: retain its history and only add missing shared routes.
    if (active && active.startsAt.getTime() >= window.start.getTime()) {
      // A scheduled next season can be moved or cancelled. Keep v2 ingestion's
      // event-time cutoff aligned with the authoritative calendar on every tick.
      if (currentIntegrityPolicy(active.ratingRules) && active.endsAt?.getTime() !== window.end?.getTime()) {
        if (!backedUp) { await backup(); backedUp = true; }
        if (database.$transaction) await database.$transaction(async tx=>{
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.guildId},0))`;
          await lockDungeonCalendar(tx);
          const fresh = await tx.dungeonSeason.findFirst({where:{id:active.id,status:"ACTIVE"}});
          if (!fresh || !currentIntegrityPolicy(fresh.ratingRules)) return;
          const latest = officialWindowAt(await loadOfficialWindows(tx),fresh.startsAt);
          if (latest) await tx.dungeonSeason.update({where:{id:fresh.id},data:{endsAt:latest.end}});
        });
        else await database.dungeonSeason.update({ where: { id: active.id }, data: { endsAt: window.end } });
      }
      // Keep newly verified routes available to existing and late-joining guilds
      // alike, without changing any already-frozen target or historical score.
      const added = validBracketedRules(active.ratingRules) && addedRules(active.ratingRules, window.rules.rules);
      if (added) {
        if (!backedUp) { await backup(); backedUp = true; }
        await database.dungeonSeason.update({ where: { id: active.id }, data: { ratingRules: added.rules as unknown as Prisma.InputJsonValue } });
      }
      continue;
    }
    if (!backedUp) { await backup(); backedUp = true; }
    await start(row.guildId, window.name, active?.id ?? null, window.end && window.end > now ? window.end : undefined, window.rules.rules, window.start);
    rotated.push({ guildId: row.guildId, season: window.name, ended: active?.name ?? null });
  }
  return rotated;
}

/** The production rotation step: the normal locked, archived startSeason. */
export const startOfficialSeason = (database: Parameters<typeof startSeason>[0]): StartFn =>
  (guildId, name, expectedId, endsAt, rules, startsAt) => startSeason(database, guildId, name, expectedId, endsAt, rules, startsAt, true);
