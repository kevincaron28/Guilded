import { weekStart } from "./dungeon-rules.js";

// Weekly and monthly dungeon boards (owner, 19 October 2026). Monthly = the season (one season
// per calendar month, dungeon-season-schedule.ts). Weekly = the active season's runs that started
// since the last WoW weekly reset (Tuesday 15:00 UTC, the same `weekStart` the participation
// points, EPGP decay and community honors use), scored with the season's own frozen rules.
export type BoardPeriod = "week" | "month";
export const WEEK_MS = 7 * 86_400_000;

export function weekWindow(now: Date): { start: Date; end: Date } {
  const start = weekStart(now);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

/** The active season narrowed to this week, or null (ended season, or no overlap). */
export function weekSeason<T extends { startsAt: Date; endsAt?: Date | null; status: string }>(season: T, now = new Date()): T | null {
  if (season.status !== "ACTIVE") return null;
  const week = weekWindow(now);
  if (season.endsAt && season.endsAt <= week.start || season.startsAt >= week.end) return null;
  return { ...season, startsAt: season.startsAt > week.start ? season.startsAt : week.start,
    endsAt: season.endsAt && season.endsAt < week.end ? season.endsAt : week.end };
}
