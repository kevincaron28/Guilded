import type { PrismaClient } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";

// One master season calendar for everything that rolls over together (owner decision, 16 November 2026: Season 2 starts on 9 December
// 2026 at 15:00 Pacific and duels, battlegrounds, world PvP, Guilded Clash, dungeons and raid attendance all change season at once).
// The calendar itself is the owner-only OfficialSeason table (official-seasons.ts). The duel and Clash ladders compute their seasons
// in synchronous pure functions, so they read this small in-memory copy of it. It is refreshed at start-up and on every rotation tick
// (and lazily, at most once a minute, where a database is at hand); a season that is already scheduled switches on its own at its start
// time without any refresh. Before the first refresh (or in a test) the calendar is empty: the first season simply continues.

export interface CalendarSeason { number: number; name: string; start: Date }

let seasons: CalendarSeason[] = [];
let loadedAt = 0;

/** Replaces the calendar copy (oldest first). Used by the refresh below and by tests. */
export function setSeasonCalendar(rows: readonly { number: number; name?: string; start?: Date; startsAt?: Date }[]): void {
  seasons = rows.map(row => ({ number: row.number, name: row.name ?? `Season ${row.number}`, start: (row.start ?? row.startsAt)! }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  loadedAt = Date.now();
}
export const getSeasonCalendar = (): readonly CalendarSeason[] => seasons;
export const resetSeasonCalendar = () => { seasons = []; loadedAt = 0; };

type CalendarDb = { officialSeason?: Pick<PrismaClient["officialSeason"], "findMany"> };

/** Reads the OfficialSeason rows into the in-memory copy. Never throws; a failed read keeps the old copy. `maxAgeMs` skips a recent load. */
export async function refreshSeasonCalendar(db: CalendarDb, maxAgeMs = 0): Promise<void> {
  if (!db.officialSeason?.findMany || (maxAgeMs > 0 && Date.now() - loadedAt < maxAgeMs)) return;
  try {
    const rows = await db.officialSeason.findMany({ where: { gameEdition: currentEdition() }, select: { number: true, name: true, startsAt: true }, orderBy: { startsAt: "asc" } });
    setSeasonCalendar(rows);
  } catch { /* keep the previous copy */ }
}

/** The season (number 2 and up) that started at or before `at`, or null while the first season runs. */
export function laterSeasonAt(at: Date, calendar: readonly CalendarSeason[] = seasons): CalendarSeason | null {
  let found: CalendarSeason | null = null;
  for (const row of calendar) if (row.number >= 2 && row.start <= at) found = row;
  return found;
}

/** The first season after `at` that has a start (the end of the one running at `at`), or null when none is scheduled. */
export function nextSeasonAfter(at: Date, calendar: readonly CalendarSeason[] = seasons): CalendarSeason | null {
  return calendar.find(row => row.number >= 2 && row.start > at) ?? null;
}

/** The official season running at `now` (number, name, start), read straight from the table; null when there is none or no table (a test double). Never throws. */
export async function currentOfficialSeason(db: { officialSeason?: Pick<PrismaClient["officialSeason"], "findFirst"> }, edition: string, now: Date): Promise<{ number: number; name: string; start: Date } | null> {
  if (!db.officialSeason?.findFirst) return null;
  try {
    const row = await db.officialSeason.findFirst({ where: { gameEdition: edition, startsAt: { lte: now } }, orderBy: { startsAt: "desc" }, select: { number: true, name: true, startsAt: true } });
    return row ? { number: row.number, name: row.name, start: row.startsAt } : null;
  } catch { return null; }
}

/** "Season 2" / "Saison 2". */
export const officialSeasonName = (number: number, lang: "en" | "fr" = "en") => `${lang === "fr" ? "Saison" : "Season"} ${number}`;
