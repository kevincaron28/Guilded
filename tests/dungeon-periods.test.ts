import { describe, expect, it } from "vitest";
import { weekSeason, weekWindow } from "../src/services/dungeon-periods.js";

const active = { status: "ACTIVE", startsAt: new Date("2026-11-04T05:00:00Z"), endsAt: new Date("2026-12-01T05:00:00Z") };

describe("weekly boards reset on the WoW weekly reset (Tuesday 15:00 UTC)", () => {
  it("starts the week at the last Tuesday 15:00 UTC, inclusive", () => {
    expect(weekWindow(new Date("2026-11-10T14:59:59Z")).start.toISOString()).toBe("2026-11-03T15:00:00.000Z");
    expect(weekWindow(new Date("2026-11-10T15:00:00Z")).start.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(weekWindow(new Date("2026-11-16T23:00:00Z")).end.toISOString()).toBe("2026-11-17T15:00:00.000Z");
  });

  it("narrows the active season to this week, clipped to the season's own start and end", () => {
    // Release week: the season starts Wednesday 4 Nov, after the 3 Nov reset.
    const first = weekSeason(active, new Date("2026-11-05T00:00:00Z"))!;
    expect([first.startsAt.toISOString(), first.endsAt!.toISOString()]).toEqual(["2026-11-04T05:00:00.000Z", "2026-11-10T15:00:00.000Z"]);
    const mid = weekSeason(active, new Date("2026-11-12T00:00:00Z"))!;
    expect([mid.startsAt.toISOString(), mid.endsAt!.toISOString()]).toEqual(["2026-11-10T15:00:00.000Z", "2026-11-17T15:00:00.000Z"]);
    // Last week of the month ends with the season.
    expect(weekSeason(active, new Date("2026-11-30T00:00:00Z"))!.endsAt!.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("has no week for an ended season or one that has not started this week", () => {
    expect(weekSeason({ ...active, status: "ENDED" }, new Date("2026-11-12T00:00:00Z"))).toBeNull();
    expect(weekSeason(active, new Date("2026-10-20T00:00:00Z"))).toBeNull();
  });
});
