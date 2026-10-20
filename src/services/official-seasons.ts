import type { PrismaClient } from "@prisma/client";
import { startSeason } from "./dungeon-admin.js";
import { carriedRules } from "./dungeon-season-schedule.js";

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

export interface OfficialWindow { number: number; name: string; start: Date; end: Date | null }
export interface OfficialRow { number: number; name: string; startsAt: Date }

/** Calendar rows (any order) as windows, oldest first: each ends where the next one starts. */
export function officialWindows(rows: OfficialRow[]): OfficialWindow[] {
  const sorted = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return sorted.map((row, i) => ({ number: row.number, name: row.name, start: row.startsAt, end: sorted[i + 1]?.startsAt ?? null }));
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
  return officialWindows(await database.officialSeason.findMany({ select: { number: true, name: true, startsAt: true }, orderBy: { startsAt: "asc" } }));
}

export class SeasonCalendarError extends Error {}

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
  await database.officialSeason.deleteMany({ where: { startsAt: { gt: now } } });
  await database.officialSeason.create({ data: { number, name, startsAt: input.startsAt, createdBy: input.actorId } });
  return { number, name, start: input.startsAt, end: null };
}

/** Removes the season waiting to start; the current season then keeps running with no end. */
export async function cancelNextSeason(database: Db, now = new Date()): Promise<OfficialWindow | null> {
  const pending = scheduledNext(await loadOfficialWindows(database), now);
  if (!pending) return null;
  await database.officialSeason.deleteMany({ where: { startsAt: { gt: now } } });
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
  const rows = await database.guildSettings.findMany({ select: { guildId: true, guild: { select: { discordId: true } } } });
  const rotated: OfficialRotation[] = [];
  let backedUp = false;
  for (const row of rows) {
    if (!allows(row.guild.discordId)) continue;
    const active = await database.dungeonSeason.findFirst({ where: { guildId: row.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    // Already in this season (this job ran, or a restart): nothing to do.
    if (active && active.startsAt.getTime() >= window.start.getTime()) continue;
    if (!backedUp) { await backup(); backedUp = true; }
    await start(row.guildId, window.name, active?.id ?? null, window.end && window.end > now ? window.end : undefined, carriedRules(active), window.start);
    rotated.push({ guildId: row.guildId, season: window.name, ended: active?.name ?? null });
  }
  return rotated;
}

/** The production rotation step: the normal locked, archived startSeason. */
export const startOfficialSeason = (database: Parameters<typeof startSeason>[0]): StartFn =>
  (guildId, name, expectedId, endsAt, rules, startsAt) => startSeason(database, guildId, name, expectedId, endsAt, rules, startsAt);
