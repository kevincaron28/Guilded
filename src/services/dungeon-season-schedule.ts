import type { Prisma, PrismaClient } from "@prisma/client";
import { startSeason } from "./dungeon-admin.js";
import { provisionalSeasonRules } from "./dungeon-bracket-season.js";
import { validBracketedRules } from "./dungeon-november-rules.js";

// Monthly dungeon seasons (owner, 19 October 2026: "a new season starting November 4th for release
// and then a season a month"). A guild opts in with `/organize dungeon-seasons on`; the bot then
// rotates its season by itself (src/main.ts, every 5 minutes):
// - Season 1 runs from the release start (default 2026-11-04 00:00 America/Toronto) to the first
//   day of the next month at the same hour; every later season is one calendar month.
// - Nothing happens before a season's start: the current (beta) season stays active, unarchived.
// - At a start, a backup is taken, then the normal transactional startSeason rotation archives the
//   active season (standings, rating and champions frozen; runs and points kept).
// - Idempotent: a season that already started inside the current window (by this job, or by an
//   officer by hand) is left alone, so a restart or a second tick changes nothing. A month the bot
//   was down for entirely is skipped, never replayed.
// - The rules carry over: an all-level (version 6) season passes its routes, brackets, provisional
//   block and recalibrations to the next month unchanged; any other season gets the provisional plan.

export interface SeasonSchedule { enabled: boolean; firstStart: string; hour: number; timeZone: string; updatedBy?: string; updatedAt?: string }
export const DEFAULT_SCHEDULE: SeasonSchedule = { enabled: false, firstStart: "2026-11-04", hour: 0, timeZone: "America/Toronto" };
export const MAX_SEASONS = 1200;

export function validTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

export function readSchedule(value: unknown): SeasonSchedule | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<SeasonSchedule>;
  if (typeof s.enabled !== "boolean" || typeof s.firstStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.firstStart)
    || !Number.isInteger(s.hour) || s.hour! < 0 || s.hour! > 23 || typeof s.timeZone !== "string" || !validTimeZone(s.timeZone)) return null;
  return { ...DEFAULT_SCHEDULE, ...s } as SeasonSchedule;
}

// Offset (ms) of a time zone at one instant: local wall time minus UTC.
function zoneOffset(at: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]), Number(parts["hour"]), Number(parts["minute"]), Number(parts["second"])) - at;
}

/** The instant a local wall time happens in a time zone (DST-aware). Month may overflow (12 = next January). */
export function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const wall = Date.UTC(year, month, day, hour);
  let at = wall - zoneOffset(wall, timeZone);
  at = wall - zoneOffset(at, timeZone);
  return new Date(at);
}

export interface SeasonWindow { index: number; name: string; start: Date; end: Date }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Season n (1-based) of a schedule. */
export function seasonWindow(schedule: SeasonSchedule, index: number): SeasonWindow {
  const [y, m, d] = schedule.firstStart.split("-").map(Number) as [number, number, number];
  const month = m - 1 + index - 1;
  const start = index === 1 ? zonedInstant(y, m - 1, d, schedule.hour, schedule.timeZone) : zonedInstant(y, month, 1, schedule.hour, schedule.timeZone);
  const end = zonedInstant(y, month + 1, 1, schedule.hour, schedule.timeZone);
  const label = new Date(Date.UTC(y, month, 1));
  return { index, start, end, name: `Season ${index} · ${MONTHS[label.getUTCMonth()]} ${label.getUTCFullYear()}` };
}

/** The season running at `now`, or null before the first one starts. */
export function seasonWindowAt(schedule: SeasonSchedule, now: Date): SeasonWindow | null {
  for (let index = 1; index <= MAX_SEASONS; index++) {
    const window = seasonWindow(schedule, index);
    if (now < window.start) return null;
    if (now < window.end) return window;
  }
  return null;
}

/** The next `count` seasons from `now` (the current one first, when one is running). */
export function upcomingWindows(schedule: SeasonSchedule, now: Date, count = 4): SeasonWindow[] {
  const current = seasonWindowAt(schedule, now);
  return Array.from({ length: count }, (_, i) => seasonWindow(schedule, (current?.index ?? 1) + i));
}

/** The rules the next month starts with: the active all-level season's own, or the provisional plan. */
export function carriedRules(active: { ratingRules: unknown } | null): unknown {
  return active && validBracketedRules(active.ratingRules) ? active.ratingRules : provisionalSeasonRules().rules;
}

type Db = Pick<PrismaClient, "guildSettings" | "dungeonSeason">;
type StartFn = (guildId: string, name: string, expectedId: string | null, endsAt: Date, rules: unknown, startsAt: Date) => Promise<unknown>;
export interface RotationResult { guildId: string; season: string; ended: string | null }

/** One tick of the monthly rotation. `backup` runs once, before the first rotation of the tick. */
export async function rotateScheduledSeasons(database: Db, now: Date, backup: () => Promise<unknown>, start: StartFn): Promise<RotationResult[]> {
  const rows = await database.guildSettings.findMany({ select: { guildId: true, dungeonSeasonSchedule: true } });
  const rotated: RotationResult[] = [];
  let backedUp = false;
  for (const row of rows) {
    const schedule = readSchedule(row.dungeonSeasonSchedule);
    if (!schedule?.enabled) continue;
    const window = seasonWindowAt(schedule, now);
    if (!window) continue;
    const active = await database.dungeonSeason.findFirst({ where: { guildId: row.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    // Already started in this window (here, after a restart, or by an officer): nothing to do.
    if (active && active.startsAt.getTime() >= window.start.getTime()) continue;
    if (!backedUp) { await backup(); backedUp = true; }
    await start(row.guildId, window.name, active?.id ?? null, window.end, carriedRules(active), window.start);
    rotated.push({ guildId: row.guildId, season: window.name, ended: active?.name ?? null });
  }
  return rotated;
}

/** The production rotation step: the normal locked, archived startSeason. */
export const startScheduledSeason = (database: Parameters<typeof startSeason>[0]): StartFn =>
  (guildId, name, expectedId, endsAt, rules, startsAt) => startSeason(database, guildId, name, expectedId, endsAt, rules, startsAt);

export async function saveSchedule(database: Pick<PrismaClient, "guildSettings">, guildId: string, schedule: SeasonSchedule) {
  const value = schedule as unknown as Prisma.InputJsonValue;
  await database.guildSettings.upsert({ where: { guildId }, create: { guildId, dungeonSeasonSchedule: value }, update: { dungeonSeasonSchedule: value } });
}

export async function loadSchedule(database: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<SeasonSchedule> {
  const row = await database.guildSettings.findUnique({ where: { guildId }, select: { dungeonSeasonSchedule: true } });
  return readSchedule(row?.dungeonSeasonSchedule) ?? { ...DEFAULT_SCHEDULE };
}
