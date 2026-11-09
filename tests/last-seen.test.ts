import { describe, expect, it } from "vitest";
import { byLastSeen, lastSeenOf, lastSeenText } from "../src/services/last-seen.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("last seen wording", () => {
  it("says today, yesterday, days, weeks and months", () => {
    expect(lastSeenText(ago(0.2), "en", NOW)).toBe("today");
    expect(lastSeenText(ago(1), "en", NOW)).toBe("yesterday");
    expect(lastSeenText(ago(2), "en", NOW)).toBe("2 days ago");
    expect(lastSeenText(ago(21), "en", NOW)).toBe("3 weeks ago");
    expect(lastSeenText(ago(95), "en", NOW)).toBe("3 months ago");
    expect(lastSeenText(null, "en", NOW)).toBe("unknown");
  });
  it("has French wording and never goes negative for a future clock skew", () => {
    expect(lastSeenText(ago(2), "fr", NOW)).toBe("il y a 2 jours");
    expect(lastSeenText(ago(0), "fr", NOW)).toBe("aujourd'hui");
    expect(lastSeenText(new Date(NOW.getTime() + 5_000), "en", NOW)).toBe("today");
  });
  it("prefers the roster date, falls back to the scan, and sorts newest first with unknown last", () => {
    expect(lastSeenOf(ago(1), ago(5))).toEqual(ago(1));
    expect(lastSeenOf(null, ago(5))).toEqual(ago(5));
    expect(lastSeenOf(undefined, undefined)).toBeNull();
    expect([ago(9), null, ago(1)].sort(byLastSeen)).toEqual([ago(1), ago(9), null]);
  });
});
