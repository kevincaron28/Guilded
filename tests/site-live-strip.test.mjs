import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("weekly metrics stay hidden at zero", () => {
  it("does not reveal the home strip when this week has no rated runs", () => {
    const source = readFileSync("site/site.js", "utf8");
    const guard = source.indexOf("data.ratedRunsThisWeek <= 0) return");
    const reveal = source.indexOf("live.hidden = false");
    expect(guard).toBeGreaterThan(0);
    expect(reveal).toBeGreaterThan(guard);
    const home = readFileSync("site/index.html", "utf8");
    expect(home).toContain('id="live" class="live-strip"');
    expect(home).toMatch(/id="live"[^>]*hidden/);
    expect(home).not.toMatch(/data-live="runs">0</);
  });
});
