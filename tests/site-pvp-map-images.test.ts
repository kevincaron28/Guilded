import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTINENT_IMAGES } from "../src/services/pvp-zone-rects.js";

// The PvP zone map points at pictures under /images/pvp-map/. The site build copies image folders one by one,
// so a folder it does not copy is a 404 on the live page (14 November 2026: both continent pictures were missing).
describe("PvP map pictures reach the published site", () => {
  it("the site build copies the folder and every picture exists", () => {
    const build = readFileSync("scripts/build-site.mjs", "utf8");
    expect(build).toContain('cpSync("site/images/pvp-map"');
    for (const path of Object.values(CONTINENT_IMAGES)) {
      if (!path) continue;
      expect(path.startsWith("/images/pvp-map/")).toBe(true);
      expect(existsSync(`site${path}`)).toBe(true);
    }
  });
});
