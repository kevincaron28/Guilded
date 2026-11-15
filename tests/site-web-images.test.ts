import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { shareImageType } from "../src/services/web-layout.js";
import { emptyBox, emptyPage } from "../src/services/leaderboard-hub.js";

// Painted website pictures live in site/images/web/. The site build copies image folders one by one: a folder it
// does not copy is a 404 on the live site. Every picture a page names must exist and stay light.
const FILES = [
  ...["season-banner", "header-players", "header-guilds", "header-dungeons", "header-duels", "companion-hero"].flatMap((n) => [`${n}-1600.webp`, `${n}-800.webp`]),
  ...["players", "officers", "guild"].map((n) => `tile-${n}-800.webp`),
  ...["home", "leaderboards", "dungeons", "duels", "players", "guilds", "community", "guide", "companion", "download"].map((n) => `../social/og-${n}.jpg`),
  ...["404-1200.webp", "404-800.webp"],
  ...["duel", "runs", "notfound", "search"].map((n) => `empty-${n}.webp`),
  ...["start", "install", "companion", "link", "dungeons", "officers", "epgp", "discord", "selfhost", "troubleshooting"].map((n) => `guide-${n}.webp`),
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
    const build = readFileSync("scripts/build-site.mjs", "utf8");
    for (const og of ["og-home.jpg", "og-download.jpg", "og-community.jpg", "og-guide.jpg", "og-companion.jpg"]) expect(build).toContain(og);
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain("/images/web/404-1200.webp");
    for (const f of ["guide.md", "guide.fr.md"]) expect(readFileSync(`site/pages/${f}`, "utf8")).toContain("/images/web/guide-start.webp");
    expect(readFileSync("site/pages/companion.md", "utf8")).toContain("companion-hero");
    const hub = readFileSync("src/services/leaderboard-hub.ts", "utf8");
    for (const key of ["season-banner-1600", "season-banner-800", "medal-", "header-${kind}"]) expect(hub).toContain(key);
    const home = readFileSync("site/index.html", "utf8");
    for (const tile of ["tile-players", "tile-officers", "tile-guild"]) expect(home).toContain(tile);
  });
});

// A background shorthand with several layers may only carry the colour on its last layer: a colour in front makes the whole
// declaration invalid and the painting silently never shows (found 15 November 2026 on the leaderboards banner).
describe("painted backgrounds are valid CSS", () => {
  it("never put a colour before a gradient or url layer", () => {
    for (const file of ["src/services/leaderboard-hub.ts", "site/style.css", "site/design-tokens.css", "site/atelier.css"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/background:\s*#[0-9a-fA-F]{3,8}\s+(?:linear-gradient|url)\([^;}]*,\s*url\(/);
    }
  });
});

describe("painted pictures land in the built site", () => {
  beforeAll(() => { execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "ignore" }); }, 120_000);
  it("copies every picture, and section subpages use their section's share image", () => {
    for (const file of FILES) {
      const built = file.startsWith("../") ? `dist/site/images/social/${file.slice(3 + "social/".length)}` : `dist/site/images/web/${file}`;
      expect(existsSync(built), built).toBe(true);
    }
    const og = (page: string) => /og:image" content="[^"]*\/([^"/]+)"/.exec(readFileSync(`dist/site/${page}/index.html`, "utf8"))?.[1];
    expect(og("guide/start")).toBe("og-guide.jpg");
    expect(og("guide/install")).toBe("og-guide.jpg");
    expect(og("download")).toBe("og-download.jpg");
    expect(og("editions/forever")).toBe("og-download.jpg");
    expect(og("start")).toBe("guilded-card.png");
  });
  it("names the share image's type from its extension", () => {
    expect(shareImageType("/images/social/og-duels.jpg")).toBe("image/jpeg");
    expect(shareImageType("/images/social/guilded-card.png")).toBe("image/png");
    expect(shareImageType(undefined)).toBe("image/png");
  });
});

describe("empty-state pictures", () => {
  it("are decorative, sized and lazy, and the not-found pages carry their own styles", () => {
    const box = emptyBox("No duel yet", ["Duel someone."], "duel");
    expect(box).toContain('src="/images/web/empty-duel.webp"');
    expect(box).toContain('alt=""');
    expect(box).toContain('width="96" height="96" loading="lazy"');
    expect(emptyBox("Plain", [])).not.toContain("<img");
    expect(emptyPage("Nothing", [], "notfound")).toContain("<style>.hub-empty");
  });
});
