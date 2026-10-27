import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { startSeason } from "./dungeon-admin.js";
import { createBracketedDungeonRules, validBracketedRules, type BracketedRules } from "./dungeon-november-rules.js";
import { addedRules, publicRules, readRuleSnapshot, snapshotRules, type PublicRuleSnapshot } from "./public-score.js";
import { currentEdition } from "./edition-context.js";
import { currentIntegrityPolicy } from "./dungeon-integrity.js";

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

type Db = Pick<PrismaClient, "officialSeason">;

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
}

export class SeasonCalendarError extends Error {}

/** Install reviewed routes for the next season without rewriting historical scores. */
export async function configureNextSeasonRules(database: Db, input: unknown, now = new Date()): Promise<number> {
  const data = input as { gameEdition?: unknown } | null;
  if (!data || (data.gameEdition ?? "forever") !== currentEdition()) throw new SeasonCalendarError("Rules must name the selected WoW edition.");
  let rules: BracketedRules;
  try { rules = createBracketedDungeonRules(input); }
  catch (error) { throw new SeasonCalendarError(`Invalid dungeon rules: ${error instanceof Error ? error.message : String(error)}`); }
  if (!rules.routes.length || !rules.brackets.length) throw new SeasonCalendarError("Supply reviewed routes and at least one rated bracket.");
  const next = await database.officialSeason.findFirst({ where: { gameEdition: currentEdition(), startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: { id: true } });
  if (!next) throw new SeasonCalendarError("Schedule this edition's next season first.");
  const changed = await database.officialSeason.updateMany({ where: { id: next.id, gameEdition: currentEdition(), startsAt: { gt: new Date(Math.max(now.getTime(), Date.now())) } }, data: { rules: snapshotRules(rules, now) as unknown as Prisma.InputJsonValue } });
  if (changed.count !== 1) throw new SeasonCalendarError("The season has started. Schedule the next season to change its rules.");
  return rules.routes.length;
}

/**
 * Schedules the next season (it ends the current one at `startsAt`). Replaces a next season that
 * has not started yet; never edits a season that already started.
 */
export async function scheduleNextSeason(database: Db, input: { name?: string | null; startsAt: Date; actorId: string }, now = new Date()): Promise<OfficialWindow> {
  if (!Number.isFinite(input.startsAt.getTime())) throw new SeasonCalendarError("Give the start as YYYY-MM-DD HH:MM.");
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
}

/** Removes the season waiting to start; the current season then keeps running with no end. */
export async function cancelNextSeason(database: Db, now = new Date()): Promise<OfficialWindow | null> {
  const pending = scheduledNext(await loadOfficialWindows(database), now);
  if (!pending) return null;
  await database.officialSeason.deleteMany({ where: { gameEdition: currentEdition(), startsAt: { gt: now } } });
  return pending;
}

type RotationDb = Pick<PrismaClient, "guildSettings" | "dungeonSeason">;
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
        await database.dungeonSeason.update({ where: { id: active.id }, data: { endsAt: window.end } });
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
  (guildId, name, expectedId, endsAt, rules, startsAt) => startSeason(database, guildId, name, expectedId, endsAt, rules, startsAt);
