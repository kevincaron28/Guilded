import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCHEDULE, carriedRules, readSchedule, rotateScheduledSeasons, seasonWindow, seasonWindowAt, upcomingWindows, zonedInstant, type SeasonSchedule
} from "../src/services/dungeon-season-schedule.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { createBracketedDungeonRules } from "../src/services/dungeon-november-rules.js";
import { scheduleEmbed } from "../src/commands/dungeon-schedule.js";

const on: SeasonSchedule = { ...DEFAULT_SCHEDULE, enabled: true };

describe("monthly season windows", () => {
  it("starts season 1 on 4 November 2026 at midnight Toronto (EST) and then on the 1st of each month", () => {
    const s1 = seasonWindow(on, 1);
    expect(s1.start.toISOString()).toBe("2026-11-04T05:00:00.000Z");
    expect(s1.end.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(s1.name).toBe("Season 1 · November 2026");
    const s2 = seasonWindow(on, 2);
    expect([s2.start.toISOString(), s2.end.toISOString(), s2.name]).toEqual(["2026-12-01T05:00:00.000Z", "2027-01-01T05:00:00.000Z", "Season 2 · December 2026"]);
    // Daylight saving: April starts at midnight EDT (04:00 UTC).
    expect(seasonWindow(on, 6).start.toISOString()).toBe("2027-04-01T04:00:00.000Z");
    expect(seasonWindow(on, 6).name).toBe("Season 6 · April 2027");
  });

  it("windows touch: each season ends exactly when the next starts", () => {
    for (let i = 1; i < 30; i++) expect(seasonWindow(on, i).end.getTime()).toBe(seasonWindow(on, i + 1).start.getTime());
  });

  it("has no season before the release start", () => {
    expect(seasonWindowAt(on, new Date("2026-11-04T04:59:59Z"))).toBeNull();
    expect(seasonWindowAt(on, new Date("2026-11-04T05:00:00Z"))?.index).toBe(1);
    expect(seasonWindowAt(on, new Date("2026-12-01T04:59:59Z"))?.index).toBe(1);
    expect(seasonWindowAt(on, new Date("2026-12-01T05:00:00Z"))?.index).toBe(2);
    expect(upcomingWindows(on, new Date("2026-10-19T12:00:00Z"), 2).map(w => w.index)).toEqual([1, 2]);
  });

  it("honours a configured hour and time zone", () => {
    const utc = { ...on, hour: 15, timeZone: "UTC" };
    expect(seasonWindow(utc, 1).start.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(zonedInstant(2026, 10, 4, 0, "Europe/Paris").toISOString()).toBe("2026-11-03T23:00:00.000Z");
  });

  it("rejects malformed stored schedules", () => {
    expect(readSchedule(null)).toBeNull();
    expect(readSchedule({ ...on, timeZone: "Mars/Olympus" })).toBeNull();
    expect(readSchedule({ ...on, hour: 24 })).toBeNull();
    expect(readSchedule({ ...on, firstStart: "Nov 4" })).toBeNull();
    expect(readSchedule(on)).toEqual(on);
  });
});

function fakeDb(guilds: { guildId: string; dungeonSeasonSchedule: unknown }[], seasons: { guildId: string; id: string; name: string; startsAt: Date; ratingRules: unknown }[]) {
  return {
    guildSettings: { findMany: vi.fn(async () => guilds) },
    dungeonSeason: { findFirst: vi.fn(async ({ where }: { where: { guildId: string } }) => seasons.find(s => s.guildId === where.guildId) ?? null) }
  };
}

describe("monthly rotation job", () => {
  const beta = { guildId: "g1", id: "beta", name: "Beta", startsAt: new Date("2026-10-19T00:00:00Z"), ratingRules: provisionalSeasonRules().rules };

  it("does not touch the beta season before 4 November", async () => {
    const db = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: on }], [beta]);
    const backup = vi.fn(async () => null), start = vi.fn(async () => null);
    expect(await rotateScheduledSeasons(db as never, new Date("2026-11-04T04:55:00Z"), backup, start)).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("at the start: backs up once, then rotates with the expected season, window and carried rules", async () => {
    const db = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: on }, { guildId: "g2", dungeonSeasonSchedule: on }],
      [beta, { ...beta, guildId: "g2", id: "b2" }]);
    const order: string[] = [];
    const backup = vi.fn(async () => { order.push("backup"); }), start = vi.fn(async (guildId: string) => { order.push(`start:${guildId}`); });
    const result = await rotateScheduledSeasons(db as never, new Date("2026-11-04T05:01:00Z"), backup, start);
    expect(order).toEqual(["backup", "start:g1", "start:g2"]);
    expect(result).toEqual([{ guildId: "g1", season: "Season 1 · November 2026", ended: "Beta" }, { guildId: "g2", season: "Season 1 · November 2026", ended: "Beta" }]);
    expect(start).toHaveBeenCalledWith("g1", "Season 1 · November 2026", "beta", new Date("2026-12-01T05:00:00Z"), beta.ratingRules, new Date("2026-11-04T05:00:00Z"));
  });

  it("is idempotent after a restart: a season already started in this window is left alone", async () => {
    const started = { ...beta, id: "s1", name: "Season 1 · November 2026", startsAt: new Date("2026-11-04T05:00:00Z") };
    const db = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: on }], [started]);
    const backup = vi.fn(async () => null), start = vi.fn(async () => null);
    expect(await rotateScheduledSeasons(db as never, new Date("2026-11-20T00:00:00Z"), backup, start)).toEqual([]);
    expect(await rotateScheduledSeasons(db as never, new Date("2026-11-20T00:05:00Z"), backup, start)).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
    // An officer's own season started inside the window also counts.
    const manual = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: on }], [{ ...started, startsAt: new Date("2026-11-10T00:00:00Z") }]);
    expect(await rotateScheduledSeasons(manual as never, new Date("2026-11-20T00:00:00Z"), backup, start)).toEqual([]);
    // The next month rotates it.
    expect((await rotateScheduledSeasons(db as never, new Date("2026-12-01T05:00:00Z"), backup, start))[0]?.season).toBe("Season 2 · December 2026");
  });

  it("skips guilds that did not opt in or turned it off, and never rotates when the backup fails", async () => {
    const db = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: null }, { guildId: "g2", dungeonSeasonSchedule: { ...on, enabled: false } }], [beta]);
    const start = vi.fn(async () => null);
    expect(await rotateScheduledSeasons(db as never, new Date("2026-11-05T00:00:00Z"), async () => null, start)).toEqual([]);
    const opted = fakeDb([{ guildId: "g1", dungeonSeasonSchedule: on }], [beta]);
    await expect(rotateScheduledSeasons(opted as never, new Date("2026-11-05T00:00:00Z"), async () => { throw new Error("disk full"); }, start)).rejects.toThrow("disk full");
    expect(start).not.toHaveBeenCalled();
  });

  it("carries provisional targets and recalibrations to the next month; other rules get the provisional plan", () => {
    const { rules } = provisionalSeasonRules();
    const key = rules.catalog[0]!.dungeonKey;
    const recal = createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets, overlevelPenalty: rules.overlevelPenalty,
      provisional: rules.provisional, recalibrations: [{ dungeonKey: key, targetSec: 1500, from: "2026-11-20T00:00:00.000Z", runs: 3 }] });
    expect(carriedRules({ ratingRules: recal })).toBe(recal);
    expect(carriedRules({ ratingRules: { version: 3 } })).toEqual(rules);
    expect(carriedRules(null)).toEqual(rules);
  });

  it("previews without changing anything and says the beta season stays until the start", () => {
    const embed = scheduleEmbed(on, beta, false, new Date("2026-10-19T12:00:00Z")).toJSON();
    expect(embed.description).toContain("Nothing changes before <t:1793768400:f>");
    expect(embed.fields?.[0]?.value).toContain("Season 1 · November 2026");
    expect(scheduleEmbed({ ...on, enabled: false }, null, true).toJSON().description).toContain("désactivée");
  });
});
