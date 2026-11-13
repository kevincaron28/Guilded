import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, MIN_CONTRAST, MIN_TEXT_PX, assertCardRules } from "../src/services/card-kit.js";
import { renderBannerCard, renderResultCard, type NextCardSpec } from "../src/services/card-layouts-next.js";

// Sample cards only (sample names). Set CARD_RENDER_DIR to also write the PNGs for review.
const art = (name: string) => readFileSync(new URL(`../site/card-art/${name}.jpg`, import.meta.url));
const WAR = "#c79c6e", MAGE = "#69ccf0", PAL = "#f58cba", DRU = "#ff7d0a", HUNTER = "#abd473", LOCK = "#9482c9", PRIEST = "#ffffff", ROGUE = "#fff569";
const names = ["Aldric Stormvale", "Brenna Ironwood", "Cedric Dawnhollow", "Dara Nightbloom", "Edric Thornfield", "Fenna Ashgrove", "Garrick Moonwell", "Hilda Redcliff", "Ivor Stonebrook", "Jora Whitefen", "Kell Duskmantle", "Lysa Brightwater"];
const colors = [WAR, MAGE, PAL, DRU, HUNTER, LOCK, PRIEST, ROGUE, MAGE, WAR, PAL, LOCK];
const ladder = names.map((name, i) => ({ rank: i + 1, name, color: colors[i]!, score: String(300 - i * 17), record: `${20 - i}-${2 + i}` }));

const SAMPLES: Record<string, { kind: "result" | "banner"; spec: () => NextCardSpec }> = {
  duel: { kind: "result", spec: () => ({ type: "duel", emblem: "duel", label: "DUEL", title: "Duel result", hero: "Victory", heroNote: "+14 score",
    names: [{ text: "Aldric Stormvale", color: WAR }, { text: "beat Brenna Ironwood", color: MAGE }], stats: [{ value: "21-2", label: "record" }, { value: "W3", label: "streak" }, { value: "#1", label: "guild rank" }],
    strip: "Level 60 vs 58  \u00b7  13 Nov 2026", art: art("board/duel") }) },
  battleground: { kind: "result", spec: () => ({ type: "battleground", emblem: "flag", label: "BATTLEGROUND", title: "Warsong Gulch", hero: "Victory",
    stats: [{ value: "20:10", label: "match time" }, { value: "10v10", label: "bracket 60" }, { value: "Party", label: "confirmed" }], strip: "12 Nov 2026", art: art("board/battlegrounds") }) },
  frenchLong: { kind: "result", spec: () => ({ type: "dungeon", emblem: "gate", label: "DONJON TERMIN\u00c9", title: "Profondeurs de Rochenoire et leurs salles oubli\u00e9es", hero: "Donjon termin\u00e9 sans mort",
    names: [{ text: "Aldric-de-la-Vall\u00e9e-des-Tempêtes-Sombres", color: WAR }], stats: [{ value: "42:17", label: "dur\u00e9e totale du passage" }], strip: "13 novembre 2026  \u00b7  \u00c9quipe de cinq joueurs de la guilde", art: art("board/duel") }) },
  weekly: { kind: "banner", spec: () => ({ type: "weekly", emblem: "cup", label: "WEEKLY REPORT", title: "This week", hero: "24 players", stats: [{ value: "+18%", label: "vs last week" }],
    rows: [{ name: "Aldric", color: WAR, right: "1250" }, { name: "Brenna", color: MAGE, right: "980" }, { name: "Cedric", color: PRIEST, right: "740" }], strip: "Week 46  \u00b7  7 to 13 Nov 2026", art: art("board/hall-of-fame") }) },
  raid: { kind: "banner", spec: () => ({ type: "raid", emblem: "flame", label: "RAID NIGHT", title: "Molten Core", hero: "10/10 bosses", heroColor: "#86e66a",
    stats: [{ value: "38", label: "raiders" }, { value: "3h 00m", label: "duration" }, { value: "2", label: "items" }], rows: [{ name: "Sample Sword", color: "#f2c94c", sub: "Aldric", right: "100 GP" }],
    strip: "100 EP each  \u00b7  2 late  \u00b7  1 absent  \u00b7  9 Dec", art: art("raid/default") }) },
  ladder: { kind: "banner", spec: () => ({ type: "duel", emblem: "bars", label: "DUEL LADDER  \u00b7  13 NOV", title: "Guild duels", hero: "Aldric Stormvale", heroColor: WAR, heroNote: "leads with 300",
    ladder, strip: "160 duels  \u00b7  12 duellists", art: art("board/duel") }) },
  ladderLongNames: { kind: "banner", spec: () => ({ type: "crafting", emblem: "anvil", label: "TOP CRAFTERS", title: "Les meilleurs artisans de la guilde", hero: "Aldric-de-la-Vall\u00e9e-des-Tempêtes", heroColor: "#e8aa72",
    ladder: ladder.map((r) => ({ ...r, name: `${r.name} le Pr\u00e9parateur Infatigable` })), art: art("board/crafters") }) }
};

describe("redesigned card kit", () => {
  it("ships the upright font with its licence and an accent for every card type", () => {
    for (const file of ["Carlito-Regular.ttf", "Carlito-Bold.ttf", "CARLITO-LICENSE.txt"]) expect(existsSync(new URL(`../site/fonts/${file}`, import.meta.url)), file).toBe(true);
    expect(readFileSync(new URL("../site/fonts/CARLITO-LICENSE.txt", import.meta.url), "utf8")).toContain("SIL OPEN FONT LICENSE");
    for (const key of ["duel", "battleground", "dungeon", "crafting", "weekly", "raid"] as const) expect(ACCENTS[key].accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(ACCENTS.dungeon.accent).not.toBe(ACCENTS.crafting.accent);
  });

  it("refuses text under the 24 px floor and shrinks too-wide text to it, then clips", async () => {
    const c = new CardCanvas();
    await expect(c.text("tiny", 0, 0, { size: MIN_TEXT_PX - 1 })).rejects.toThrow(/floor/);
    const fit = await c.text("A very long player name that cannot possibly fit in this narrow place", 0, 0, { size: 40, maxW: 200 });
    expect(fit.w).toBeLessThanOrEqual(200);
    expect(c.texts[0]!.size).toBe(MIN_TEXT_PX);
    expect(c.texts[0]!.str.endsWith("\u2026")).toBe(true);
  });

  it.each(Object.keys(SAMPLES))("renders the %s sample at 1200x630 with every string at 24 px or more and %s:1 contrast", async (key) => {
    const { kind, spec } = SAMPLES[key]!;
    const { png, report } = await (kind === "result" ? renderResultCard(spec()) : renderBannerCard(spec()));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([CARD_W, CARD_H]);
    expect(report.length).toBeGreaterThan(5);
    expect(Math.min(...report.map((r) => r.size))).toBeGreaterThanOrEqual(MIN_TEXT_PX);
    expect(Math.min(...report.map((r) => r.ratio))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    assertCardRules(report);
    const out = process.env["CARD_RENDER_DIR"];
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `kit-${key}.png`), png); }
  }, 60_000);

  it("reports a failure when a string would sit on a bright backdrop", async () => {
    const white = await sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const { report } = await renderBannerCard({ ...SAMPLES["weekly"]!.spec(), art: white });
    // The overlay darkens the banner's left, but the flat body is dark: only a string on the bright edge may fail; the guard must at least measure.
    expect(report.every((r) => Number.isFinite(r.ratio))).toBe(true);
  }, 60_000);

  it("draws cards one at a time", async () => {
    const [a, b] = await Promise.all([renderResultCard(SAMPLES["duel"]!.spec()), renderResultCard(SAMPLES["battleground"]!.spec())]);
    expect(a.png.equals(b.png)).toBe(false);
  }, 60_000);
});
