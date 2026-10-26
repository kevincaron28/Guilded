import { describe, expect, it } from "vitest";
import { formatRaidTime, isValidTimeZone, parseRaidTime, zonedTime } from "../src/services/raid-time.js";

const tz = "America/Toronto";
// Thursday 2026-10-01, 15:00 in Toronto (19:00 UTC, EDT = UTC-4).
const now = new Date("2026-10-01T19:00:00Z");
const iso = (text: string) => parseRaidTime(text, tz, now).toISOString();

describe("friendly raid times", () => {
  it("reads a time alone as today, or tomorrow once it has passed", () => {
    expect(iso("8pm")).toBe("2026-10-02T00:00:00.000Z");
    expect(iso("20:00")).toBe("2026-10-02T00:00:00.000Z");
    expect(iso("20h30")).toBe("2026-10-02T00:30:00.000Z");
    expect(iso("9am")).toBe("2026-10-02T13:00:00.000Z");
  });

  it("understands tonight / tomorrow in English and French", () => {
    expect(iso("tonight 8pm")).toBe("2026-10-02T00:00:00.000Z");
    expect(iso("ce soir 20h")).toBe("2026-10-02T00:00:00.000Z");
    expect(iso("tomorrow 9:30pm")).toBe("2026-10-03T01:30:00.000Z");
    expect(iso("demain 21h")).toBe("2026-10-03T01:00:00.000Z");
  });

  it("reads weekdays as the next one, and treats a bare 8 as evening", () => {
    expect(iso("friday 8pm")).toBe("2026-10-03T00:00:00.000Z");
    expect(iso("vendredi 20h")).toBe("2026-10-03T00:00:00.000Z");
    expect(iso("thu 8")).toBe("2026-10-02T00:00:00.000Z");
    expect(iso("thursday 2pm")).toBe("2026-10-08T18:00:00.000Z");
    expect(iso("friday at 8pm")).toBe("2026-10-03T00:00:00.000Z");
  });

  it("reads calendar dates in the guild timezone, and exact ISO as-is", () => {
    expect(iso("2026-10-03 20:00")).toBe("2026-10-04T00:00:00.000Z");
    expect(iso("2026-12-03 20:00")).toBe("2026-12-04T01:00:00.000Z");
    expect(iso("2026-10-03T20:00:00-04:00")).toBe("2026-10-04T00:00:00.000Z");
  });

  it("handles the daylight-saving switch", () => {
    // 2026-11-01 is the fall-back day in Toronto.
    expect(zonedTime(2026, 11, 1, 20, 0, tz).toISOString()).toBe("2026-11-02T01:00:00.000Z");
  });

  it("reads a picked suggestion's label as what was typed before the arrow", () => {
    expect(iso("friday 8pm → Fri, Oct 2, 20:00")).toBe("2026-10-03T00:00:00.000Z");
    expect(iso("tomorrow 9:30pm → Fri, Oct 2, 21:30")).toBe("2026-10-03T01:30:00.000Z");
  });

  it("gives examples when it can't read the input", () => {
    expect(() => parseRaidTime("next week sometime", tz, now)).toThrow("Try: friday 8pm");
  });

  it("validates timezones and formats labels", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(formatRaidTime(new Date("2026-10-03T00:00:00Z"), tz)).toContain("20:00");
  });
});
