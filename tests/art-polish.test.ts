import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDungeonThumbs } from "../scripts/dungeon-thumbs.mjs";
import sharp from "sharp";
import { raidArtKey } from "../src/services/end-cards.js";
import { GUILD_BANNER_THEMES, guildBanner } from "../src/services/guild-banner.js";
import { dungeonArtKey, dungeonHeader, dungeonThumb } from "../src/services/dungeon-thumb.js";
import { emptyBox, notFoundBody, podium, sectionArt, type EmptyArt } from "../src/services/leaderboard-hub.js";
import { PANEL_ARTS, panelArtUrl } from "../src/services/panel-art.js";

const t = (en: string, fr: string) => (fr ? en : en);
const tf = (_en: string, fr: string) => fr;

/** Every local file an HTML snippet names in img src / srcset. */
function localFiles(html: string): string[] {
  const files: string[] = [];
  for (const match of html.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
    for (const part of match[1]!.split(",")) { const url = part.trim().split(/\s+/)[0]!; if (url.startsWith("/")) files.push(url); }
  }
  return files;
}

describe("dungeon pictures on the website", () => {
  it("the site build makes a 480 x 252 thumbnail and a 1200 cover for every painting", async () => {
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('buildDungeonThumbs("site/dungeon-art"');
    const out = join("dist", "test-thumbs");
    try {
      const keys: string[] = await buildDungeonThumbs("site/dungeon-art", out);
      expect(keys.length).toBe(readdirSync("site/dungeon-art").filter((name) => name.endsWith(".jpg")).length);
      for (const key of keys) { expect(existsSync(join(out, `${key}-480.webp`)), key).toBe(true); expect(existsSync(join(out, `${key}-1200.webp`)), key).toBe(true); }
      const meta = await sharp(join(out, "deadmines-480.webp")).metadata();
      expect([meta.width, meta.height]).toEqual([480, 252]);
    } finally { /* dist/ is ignored by git; Windows may still hold the files */ }
  }, 120_000);
  it("maps English and French names to a painting, and falls back to a placeholder of the same size", () => {
    expect(dungeonArtKey("The Deadmines")).toBe("deadmines");
    expect(dungeonArtKey("Les Mortemines", "Deadmines")).toBe("deadmines");
    expect(dungeonThumb("The Deadmines")).toContain('width="64" height="34" loading="lazy"');
    expect(dungeonThumb("Nowhere Special")).toContain('class="dthumb ph"');
    const head = dungeonHeader("Deadmines", ["Levels 15–25"], "The Deadmines");
    expect(head).toContain("/images/dungeons/deadmines-1200.webp");
    expect(head).toContain('width="1200" height="315"');
    expect(dungeonHeader("Nowhere", [], "Nowhere")).toContain("plain");
  });
  it("every picture the leaderboard markup names exists in the site or the thumbnails", async () => {
    const keys = new Set(readdirSync("site/dungeon-art").map((name) => name.replace(/\.jpg$/, "")));
    const html = [
      dungeonThumb("Scholomance"), dungeonHeader("Scholomance", [], "Scholomance"),
      sectionArt("pvp"), sectionArt("dungeons"), guildBanner("g1"), ...GUILD_BANNER_THEMES.map((theme) => guildBanner(theme)),
      podium([{ name: "A", value: "10" }, { name: "B", value: "9" }, { name: "C", value: "8" }]),
      notFoundBody(t, "en"),
      ...(["duel", "runs", "notfound", "search", "guild", "pvp", "season"] as EmptyArt[]).map((art) => emptyBox("x", [], art))
    ].join("");
    const files = localFiles(html);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const dungeon = /^\/images\/dungeons\/(.+)-(?:480|1200)\.webp$/.exec(file);
      if (dungeon) expect(keys.has(dungeon[1]!), file).toBe(true);
      else expect(existsSync(`site${file}`), file).toBe(true);
    }
  });
});

describe("not-found pages", () => {
  it("are never empty: picture, sentence and a way home, in English and French", () => {
    const en = notFoundBody(t, "en"), fr = notFoundBody(tf, "fr");
    expect(en).toContain("/images/web/404-800.webp");
    expect(en).toContain("Go home");
    expect(fr).toContain("Retour à l'accueil");
    expect(fr).toContain("lang=fr");
    expect(en.length).toBeGreaterThan(300);
  });
});

describe("card art and panels", () => {
  it("has a file for every backdrop and fallback the cards name", () => {
    for (const file of ["battleground/default", "raid/default", "raid/molten-core", "raid/onyxias-lair", "raid/blackwing-lair", "board/community", "board/season-start", "board/season-end", "board/duel-ladder", "board/duel", "board/season-podium", "board/dungeon-season"]) {
      expect(existsSync(`site/card-art/${file}.jpg`), file).toBe(true);
    }
  });
  it("picks the Onyxia and Blackwing backdrops by English or French name", () => {
    expect(raidArtKey({ title: "Onyxia's Lair", killedNames: [] })).toBe("onyxias-lair");
    expect(raidArtKey({ title: "Repaire d'Onyxia", killedNames: [] })).toBe("onyxias-lair");
    expect(raidArtKey({ title: "Raid", killedNames: ["Nefarian"] })).toBe("blackwing-lair");
    expect(raidArtKey({ title: "Repaire de l'Aile noire", killedNames: [] })).toBe("blackwing-lair");
    expect(raidArtKey({ title: "Molten Core", killedNames: [] })).toBe("molten-core");
    expect(raidArtKey({ title: "Something else", killedNames: [] })).toBe("default");
  });
  it("publishes the onboarding panels on the site", () => {
    for (const name of PANEL_ARTS) {
      expect(existsSync(`site/images/discord/panel-${name}.jpg`), name).toBe(true);
      expect(panelArtUrl(name)).toMatch(/^https:\/\/.+\/images\/discord\/panel-.+\.jpg$/);
    }
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('cpSync("site/card-art"');
  });
  it("ships the share images and the wide pictures", () => {
    for (const file of ["og-pvp", "og-forever", "og-start", "og-guild"]) expect(existsSync(`site/images/social/${file}.jpg`), file).toBe(true);
    for (const file of ["header-pvp-1600", "header-pvp-800", "guide-header-1600", "guide-header-800", "podium-stage-1600"]) expect(existsSync(`site/images/web/${file}.webp`), file).toBe(true);
  });
});

describe("mobile art", () => {
  it("has the five tab icons and the sign-in picture, and the app uses them", () => {
    for (const tab of ["guild", "stats", "me", "alerts", "news"]) expect(existsSync(`mobile/assets/tabs/tab-${tab}.png`), tab).toBe(true);
    expect(existsSync("mobile/assets/signin-hero.webp")).toBe(true);
    const app = readFileSync("mobile/App.tsx", "utf8");
    for (const tab of ["guild", "stats", "me", "alerts", "news"]) expect(app).toContain(`./assets/tabs/tab-${tab}.png`);
    expect(readFileSync("mobile/src/ui/SignInCard.tsx", "utf8")).toContain("signin-hero.webp");
  });
});
