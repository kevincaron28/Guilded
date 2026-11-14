import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Painted website pictures live in site/images/web/. The site build copies image folders one by one: a folder it
// does not copy is a 404 on the live site. Every picture a page names must exist and stay light.
const FILES = [
  ...["season-banner", "header-players", "header-guilds", "header-dungeons", "header-duels"].flatMap((n) => [`${n}-1600.webp`, `${n}-800.webp`]),
  ...["players", "officers", "guild"].map((n) => `tile-${n}-800.webp`),
  ...["gold", "silver", "bronze"].map((n) => `medal-${n}.webp`),
];
describe("website pictures", () => {
  it("are copied by the site build and exist under the size budget", () => {
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('cpSync("site/images/web"');
    for (const file of FILES) {
      expect(existsSync(`site/images/web/${file}`), file).toBe(true);
      expect(statSync(`site/images/web/${file}`).size, file).toBeLessThan(250_000);
    }
  });
  it("are used by the pages", () => {
    const hub = readFileSync("src/services/leaderboard-hub.ts", "utf8");
    for (const key of ["season-banner-1600", "season-banner-800", "medal-", "header-${kind}"]) expect(hub).toContain(key);
    const home = readFileSync("site/index.html", "utf8");
    for (const tile of ["tile-players", "tile-officers", "tile-guild"]) expect(home).toContain(tile);
  });
});
