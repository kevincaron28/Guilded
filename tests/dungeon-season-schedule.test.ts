import { describe, expect, it, vi } from "vitest";
import { zonedInstant } from "../src/services/dungeon-season-schedule.js";
import {
  cancelNextSeason, officialWindowAt, officialWindows, rotateOfficialSeasons, scheduledNext, scheduleNextSeason, type OfficialRow
} from "../src/services/official-seasons.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { createBracketedDungeonRules } from "../src/services/dungeon-november-rules.js";
import { scheduleEmbed } from "../src/commands/dungeon-schedule.js";
import { calendarEmbed } from "../src/commands/owner-season.js";
import { publicSeasons, snapshotRules } from "../src/services/public-score.js";

const S1 = new Date("2026-11-04T23:00:00Z");
const seeded: OfficialRow[] = [{ number: 1, name: "Season 1", startsAt: S1, rules: snapshotRules(provisionalSeasonRules().rules, S1) }];

describe("owner season calendar", () => {
  it("starts Season 1 on 4 November 2026 at 3 PM Pacific, with no end until the owner sets one", () => {
    expect(zonedInstant(2026, 10, 4, 15, "America/Los_Angeles")).toEqual(S1);
    const windows = officialWindows(seeded);
    expect(officialWindowAt(windows, new Date("2026-11-04T22:59:59Z"))).toBeNull();
    expect(officialWindowAt(windows, S1)).toMatchObject({ number: 1, end: null });
    expect(officialWindowAt(windows, new Date("2027-06-01T00:00:00Z"))?.name).toBe("Season 1");
  });

  it("ends a season exactly when the next one starts", () => {
    const s2 = new Date("2027-01-26T23:00:00Z");
    const windows = officialWindows([{ number: 2, name: "Season 2", startsAt: s2 }, ...seeded]);
    expect(windows.map((w) => [w.name, w.end])).toEqual([["Season 1", s2], ["Season 2", null]]);
    expect(scheduledNext(windows, new Date("2026-12-01T00:00:00Z"))?.name).toBe("Season 2");
    expect(officialWindowAt(windows, s2)?.name).toBe("Season 2");
  });

  function fakeCalendar(rows: OfficialRow[]) {
    return { rows, officialSeason: {
      findMany: vi.fn(async () => rows),
      deleteMany: vi.fn(async ({ where }: { where: { startsAt: { gt: Date } } }) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.startsAt > where.startsAt.gt) rows.splice(i, 1); return { count: 0 }; }),
      create: vi.fn(async ({ data }: { data: OfficialRow }) => { rows.push(data); return data; })
    } };
  }

  it("schedules the next season, replaces one that has not started, and cancels it", async () => {
    const now = new Date("2026-12-10T00:00:00Z");
    const db = fakeCalendar([...seeded]);
    await expect(scheduleNextSeason(db as never, { startsAt: new Date("2026-12-01T00:00:00Z"), actorId: "owner" }, now)).rejects.toThrow("future");
    expect(await scheduleNextSeason(db as never, { startsAt: new Date("2027-01-26T23:00:00Z"), actorId: "owner" }, now)).toMatchObject({ number: 2, name: "Season 2" });
    expect(await scheduleNextSeason(db as never, { name: "Season 2 · Patch 1.7", startsAt: new Date("2027-02-02T23:00:00Z"), actorId: "owner" }, now)).toMatchObject({ number: 2 });
    expect(db.rows.map((r) => r.name)).toEqual(["Season 1", "Season 2 · Patch 1.7"]);
    expect((await cancelNextSeason(db as never, now))?.name).toBe("Season 2 · Patch 1.7");
    expect(db.rows.map((r) => r.name)).toEqual(["Season 1"]);
    expect(await cancelNextSeason(db as never, now)).toBeNull();
  });
});

function fakeDb(guilds: { guildId: string; discordId: string }[], seasons: { guildId: string; id: string; name: string; startsAt: Date; ratingRules: unknown }[]) {
  return {
    guildSettings: { findMany: vi.fn(async () => guilds.map((g) => ({ guildId: g.guildId, guild: { discordId: g.discordId } }))) },
    dungeonSeason: { findFirst: vi.fn(async ({ where }: { where: { guildId: string } }) => seasons.find(s => s.guildId === where.guildId) ?? null) }
  };
}

describe("season rotation (every guild follows the owner's calendar)", () => {
  const beta = { guildId: "g1", id: "beta", name: "Beta", startsAt: new Date("2026-10-19T00:00:00Z"), ratingRules: provisionalSeasonRules().rules };
  const windows = officialWindows(seeded);
  const allowAll = () => true;

  it("does not touch the beta season before Season 1 starts", async () => {
    const backup = vi.fn(async () => null), start = vi.fn(async () => null);
    expect(await rotateOfficialSeasons(fakeDb([{ guildId: "g1", discordId: "d1" }], [beta]) as never, windows, new Date("2026-11-04T22:55:00Z"), allowAll, backup, start)).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("at the start: backs up once, then moves every allowed guild in, with no end date", async () => {
    const db = fakeDb([{ guildId: "g1", discordId: "d1" }, { guildId: "g2", discordId: "d2" }, { guildId: "g3", discordId: "blocked" }], [beta, { ...beta, guildId: "g2", id: "b2" }]);
    const order: string[] = [];
    const backup = vi.fn(async () => { order.push("backup"); }), start = vi.fn(async (guildId: string) => { order.push(`start:${guildId}`); });
    const result = await rotateOfficialSeasons(db as never, windows, new Date("2026-11-04T23:01:00Z"), (id) => id !== "blocked", backup, start);
    expect(order).toEqual(["backup", "start:g1", "start:g2"]);
    expect(result).toEqual([{ guildId: "g1", season: "Season 1", ended: "Beta" }, { guildId: "g2", season: "Season 1", ended: "Beta" }]);
    expect(start).toHaveBeenCalledWith("g1", "Season 1", "beta", undefined, beta.ratingRules, S1);
  });

  it("is idempotent after a restart and rotates again when the owner's next season starts", async () => {
    const started = { ...beta, id: "s1", name: "Season 1", startsAt: S1 };
    const db = fakeDb([{ guildId: "g1", discordId: "d1" }], [started]);
    const backup = vi.fn(async () => null), start = vi.fn(async () => null);
    expect(await rotateOfficialSeasons(db as never, windows, new Date("2026-12-20T00:00:00Z"), allowAll, backup, start)).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
    const s2 = officialWindows([...seeded, { number: 2, name: "Season 2", startsAt: new Date("2027-01-26T23:00:00Z"), rules: seeded[0]!.rules }]);
    expect((await rotateOfficialSeasons(db as never, s2, new Date("2027-01-26T23:03:00Z"), allowAll, backup, start))[0]?.season).toBe("Season 2");
  });

  it("never rotates when the backup fails", async () => {
    const start = vi.fn(async () => null);
    await expect(rotateOfficialSeasons(fakeDb([{ guildId: "g1", discordId: "d1" }], [beta]) as never, windows, new Date("2026-11-05T00:00:00Z"), allowAll, async () => { throw new Error("disk full"); }, start)).rejects.toThrow("disk full");
    expect(start).not.toHaveBeenCalled();
  });

  it("starts every guild with the frozen official rules, ignoring old local calibrations", async () => {
    const { rules } = provisionalSeasonRules();
    const key = rules.catalog[0]!.dungeonKey;
    const recal = createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets,
      provisional: rules.provisional, recalibrations: [{ dungeonKey: key, targetSec: 1500, from: "2026-10-20T00:00:00.000Z", runs: 3 }] });
    const frozen = createBracketedDungeonRules({ routes: rules.routes.map(r => ({ ...r, targetSec: 2100 })), brackets: rules.brackets });
    const official = officialWindows([{ ...seeded[0]!, rules: snapshotRules(frozen, S1) }]);
    const db = fakeDb([{ guildId: "g1", discordId: "d1" }, { guildId: "g2", discordId: "d2" }],
      [{ ...beta, ratingRules: recal }, { ...beta, guildId: "g2" }]);
    const start = vi.fn(async () => null);
    await rotateOfficialSeasons(db as never, official, S1, allowAll, async () => null, start);
    expect(start).toHaveBeenCalledTimes(2);
    for (const call of start.mock.calls as unknown as unknown[][]) expect(call[4]).toEqual(frozen);
    expect(recal.targets[key]).toBe(1500); // historical guild rules are untouched
  });

  it("adds newly verified shared routes to existing guild seasons without rewriting targets", async () => {
    const { rules } = provisionalSeasonRules();
    const older = createBracketedDungeonRules({ routes: rules.routes.slice(1), brackets: rules.brackets, provisional: rules.provisional });
    const db = { ...fakeDb([{ guildId: "g1", discordId: "d1" }], [{ ...beta, startsAt: S1, ratingRules: older }]) };
    const update = vi.fn();
    Object.assign(db.dungeonSeason, { update });
    const backup = vi.fn(), start = vi.fn();
    await rotateOfficialSeasons(db as never, windows, S1, allowAll, backup, start);
    expect(backup).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    const updated = update.mock.calls[0]![0].data.ratingRules;
    expect(updated.routes).toHaveLength(rules.routes.length);
    for (const [key, target] of Object.entries(older.targets)) expect(updated.targets[key]).toBe(target);
    expect(older.routes).toHaveLength(rules.routes.length - 1);
  });

  it("refuses rotation if the shared rules have not frozen, without backups or writes", async () => {
    const start = vi.fn(), backup = vi.fn();
    await expect(rotateOfficialSeasons(fakeDb([], []) as never, officialWindows([{ ...seeded[0]!, rules: null }]), S1,
      allowAll, backup, start)).rejects.toThrow(/must be frozen/);
    expect(start).not.toHaveBeenCalled();
    expect(backup).not.toHaveBeenCalled();
  });

  it("shows officers the owner's calendar read-only: beta before Season 1, then the official season", () => {
    const before = scheduleEmbed(windows, beta, false, new Date("2026-10-19T12:00:00Z")).toJSON();
    expect(before.description).toContain("set by the Guilded owner");
    expect(before.description).toContain("count for the beta");
    const during = scheduleEmbed(windows, null, true, new Date("2026-12-01T00:00:00Z")).toJSON();
    expect(during.description).toContain("**Season 1**");
    expect(during.description).toContain("sans date de fin");
  });

  it("shows the owner the current and next season", () => {
    const s2 = officialWindows([...seeded, { number: 2, name: "Season 2", startsAt: new Date("2027-01-26T23:00:00Z"), rules: seeded[0]!.rules }]);
    const embed = calendarEmbed(s2, new Date("2026-12-01T00:00:00Z")).toJSON();
    expect(embed.description).toContain("Current: **Season 1**");
    expect(embed.description).toContain("Next: **Season 2**");
  });

  it("gives the public leaderboards the same seasons", () => {
    const s2 = officialWindows([...seeded, { number: 2, name: "Season 2", startsAt: new Date("2027-01-26T23:00:00Z"), rules: seeded[0]!.rules }]);
    expect(publicSeasons(new Date("2026-10-20T00:00:00Z"), s2).map((p) => p.id)).toEqual(["beta"]);
    const later = publicSeasons(new Date("2027-02-01T00:00:00Z"), s2);
    expect(later.map((p) => [p.id, p.labelFr])).toEqual([["s2", "Saison 2"], ["s1", "Saison 1"], ["beta", "Bêta (avant la saison 1)"]]);
    expect(later[1]!.to).toEqual(new Date("2027-01-26T23:00:00Z"));
    expect(later[2]!.to).toEqual(S1);
  });
});
