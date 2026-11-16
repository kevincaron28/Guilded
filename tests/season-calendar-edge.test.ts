import { afterEach, describe, expect, it } from "vitest";
import { cancelNextSeason, rotateOfficialSeasons, scheduleNextSeason } from "../src/services/official-seasons.js";
import { getSeasonCalendar, laterSeasonAt, resetSeasonCalendar, setSeasonCalendar } from "../src/services/season-calendar.js";
import { seasonOf } from "../src/services/duel-rating.js";
import { seasonKey, seasonEndsAt } from "../src/services/tcg-rating.js";
import { plannedSeason2Start } from "../src/services/season2-reminder.js";

afterEach(() => resetSeasonCalendar());

interface Row { number: number; name: string; startsAt: Date; gameEdition: string; rules?: unknown }
function fakeCalendar(initial: Row[]) {
  const rows = [...initial];
  return {
    rows,
    officialSeason: {
      findMany: async () => [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      deleteMany: async ({ where }: { where: { startsAt: { gt: Date } } }) => { const keep = rows.filter(r => !(r.startsAt > where.startsAt.gt)); const count = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count }; },
      create: async ({ data }: { data: Row }) => { rows.push(data); return data; }
    }
  };
}

const S1 = new Date("2026-11-04T23:00:00Z");
const S2 = new Date("2026-12-09T23:00:00Z");

describe("season calendar edge cases (16 Nov 2026 sweep)", () => {
  it("9 December 15:00 Pacific is 23:00 UTC (standard time), and the season switches exactly there", () => {
    expect(plannedSeason2Start().toISOString()).toBe("2026-12-09T23:00:00.000Z");
    const calendar = [{ number: 1, name: "Season 1", start: S1 }, { number: 2, name: "Season 2", start: S2 }];
    const before = new Date(S2.getTime() - 1);
    expect(laterSeasonAt(before, calendar)).toBeNull();
    expect(laterSeasonAt(S2, calendar)?.number).toBe(2);
    expect(seasonKey(before, calendar)).toBe("2026-11");
    expect(seasonKey(S2, calendar)).toBe("S02");
    expect(seasonOf(before, new Date("2026-11-13T00:00:00Z"), calendar).id).toBe("2026-11");
    expect(seasonOf(S2, new Date("2026-11-13T00:00:00Z"), calendar).id).toBe("S2");
  });
  it("an empty calendar (a restart before the first refresh, a guild with no seasons) keeps the first season running", () => {
    expect(getSeasonCalendar()).toEqual([]);
    expect(seasonKey(new Date("2027-03-01T00:00:00Z"))).toBe("2026-11");
    expect(seasonEndsAt("2026-11")).toBeNull();
    expect(seasonOf(new Date("2027-03-01T00:00:00Z"), new Date("2026-11-13T00:00:00Z"), []).id).toBe("2026-11");
  });
  it("rotation with no official season at all does nothing", async () => {
    const rotated = await rotateOfficialSeasons({ guildSettings: { findMany: async () => [] }, dungeonSeason: {} } as never, [], new Date(), () => true, async () => undefined, async () => undefined);
    expect(rotated).toEqual([]);
  });
  it("scheduling, re-scheduling and cancelling moves the in-memory duel and Clash clock at once", async () => {
    const db = fakeCalendar([{ number: 1, name: "Season 1", startsAt: S1, gameEdition: "forever" }]);
    const now = new Date("2026-11-16T12:00:00Z");
    await scheduleNextSeason(db as never, { startsAt: S2, actorId: "owner" }, now);
    expect(getSeasonCalendar().map(row => row.number)).toEqual([1, 2]);
    expect(seasonEndsAt("2026-11")?.toISOString()).toBe(S2.toISOString());
    const later = new Date("2026-12-12T23:00:00Z");
    await scheduleNextSeason(db as never, { startsAt: later, actorId: "owner" }, now);
    expect(getSeasonCalendar()[1]!.start.toISOString()).toBe(later.toISOString());
    expect(laterSeasonAt(S2)).toBeNull(); // the old date no longer switches anything
    await cancelNextSeason(db as never, now);
    expect(getSeasonCalendar().map(row => row.number)).toEqual([1]);
    expect(seasonKey(later)).toBe("2026-11");
  });
  it("a member who never played Season 1 simply has no earlier row to carry over", () => {
    setSeasonCalendar([{ number: 2, start: S2 }]);
    expect(seasonKey(S2)).toBe("S02");
    const keys = ["S10", "S02", "2026-11", "S03"].sort();
    expect(keys).toEqual(["2026-11", "S02", "S03", "S10"]); // ensureRating's `season: { lt }` ordering
  });
});
