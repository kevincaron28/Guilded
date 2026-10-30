import { describe, expect, it } from "vitest";
import { inQuietHours, recurringDue, recurringScheduleSchema } from "../src/services/recurring-delivery.js";

const schedule = { timezone: "America/Toronto", weekday: 1, minute: 540, quietStart: 1320, quietEnd: 480 };
describe("local weekly automation timing", () => {
  it("uses local wall time across DST rather than a fixed UTC interval", () => {
    expect(recurringDue(schedule, new Date("2026-10-26T13:00:00Z"))).toBe(true);
    expect(recurringDue(schedule, new Date("2026-11-02T13:00:00Z"))).toBe(false);
    expect(recurringDue(schedule, new Date("2026-11-02T14:00:00Z"))).toBe(true);
    expect(recurringDue(schedule, new Date("2026-11-03T14:00:00Z"))).toBe(false);
  });
  it("respects overnight quiet hours and rejects invalid timezone/schedule data", () => {
    expect(inQuietHours(23 * 60, 1320, 480)).toBe(true);
    expect(inQuietHours(7 * 60, 1320, 480)).toBe(true);
    expect(inQuietHours(8 * 60, 1320, 480)).toBe(false);
    expect(recurringDue(schedule, new Date("2026-11-03T04:00:00Z"))).toBe(false);
    expect(recurringDue(schedule, new Date(NaN))).toBe(false);
    for (const change of [{ timezone: "invalid" }, { weekday: 7 }, { minute: -1 }, { quietStart: 480 }, { enabled: true }]) {
      expect(recurringScheduleSchema.safeParse({ ...schedule, ...change }).success).toBe(false);
    }
  });
});
