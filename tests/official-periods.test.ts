import { describe, expect, it } from "vitest";
import { addCalendarMonths, initialOfficialPeriod, readPeriodMetadata } from "../src/services/official-periods.js";

describe("official period identity and prospective activation", () => {
  const now = new Date("2026-10-30T11:45:12.345Z");
  it("keeps historical precision separate from exact Guilded eligibility", () => {
    expect(initialOfficialPeriod("retail", now)).toMatchObject({ region: "NA", kind: "mythic-plus", officialStart: "2026-08-18", precision: "regional-week", guildedActivation: now.toISOString(), partial: true });
    expect(initialOfficialPeriod("classic-mists", now)).toMatchObject({ officialStart: "2026-06-02", precision: "regional-maintenance-date" });
    expect(initialOfficialPeriod("classic-tbc", now)).toMatchObject({ officialStart: "2026-10-22T22:00:00Z", calibrationScope: "tbc-zulaman-final-reduced-heroics" });
    expect(initialOfficialPeriod("classic-era", now)).toMatchObject({ kind: "guilded-quarterly", officialStart: null, months: 3, partial: false });
  });
  it("uses three calendar months with Toronto DST and month-end clamping", () => {
    expect(addCalendarMonths(now).toISOString()).toBe("2027-01-30T12:45:12.345Z");
    expect(addCalendarMonths(new Date("2026-11-30T12:45:00Z")).toISOString()).toBe("2027-02-28T12:45:00.000Z");
    expect(addCalendarMonths(new Date("2027-01-31T12:45:00Z")).toISOString()).toBe("2027-04-30T11:45:00.000Z");
  });
  it("rejects invented quarterly recurrence for a different region or mode", () => {
    expect(readPeriodMetadata({ ...initialOfficialPeriod("classic-era", now), region: "GLOBAL" })).toBeNull();
    expect(readPeriodMetadata({ ...initialOfficialPeriod("classic-era", now), months: 2 })).toBeNull();
  });
});
