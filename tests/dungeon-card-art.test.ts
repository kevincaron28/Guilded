import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dungeonArt } from "../src/services/dungeon-art.js";
import { dungeonRunCard, dungeonTheme, paintedKey } from "../src/services/dungeon-card.js";
import { dungeonBackdrop } from "../src/services/dungeon-backdrop.js";
import { existsSync, readdirSync } from "node:fs";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { ROLE_COLOR, roleGlyph, scoreCardPng } from "../src/services/score-card.js";

const run = (overrides: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Wailing Caverns", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: ["Tank", "Heal", "Mage", "Pug"], deaths: 1, unlinked: ["Pug"],
  inGuildPlayers: ["Tank", "Heal", "Mage"], achievements: [], endedAt: 1794000000,
  playerDetails: [
    { character: "Tank", class: "WARRIOR", role: "TANK", deaths: 0, presentSec: 1100, points: 0, ratingTotal: 1240, ratingGain: 35 },
    { character: "Heal", class: "PRIEST", role: "HEALER", deaths: 1, presentSec: 1100, points: 0, ratingTotal: 1185, ratingGain: 0 },
    { character: "Mage", class: "MAGE", role: "DAMAGER", deaths: 0, presentSec: 1100, points: 0, ratingTotal: 1310, ratingGain: 41 },
    { character: "Pug", class: "DRUID", role: "DAMAGER", deaths: 0, presentSec: 1100, points: 0 }
  ],
  ...overrides
});

/** Mean RGB of a rectangle of a rendered PNG. */
async function mean(png: Buffer, left: number, top: number, width: number, height: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
  return sum.map((v) => v / (data.length / info.channels)) as [number, number, number];
}
const luma = ([r, g, b]: [number, number, number]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

describe("painted dungeon backgrounds", () => {
  const forever = ["Ragefire Chasm", "The Hall of Thanes", "Ruins of Lordaeron", "Wailing Caverns", "The Deadmines", "Shadowfang Keep", "Blackfathom Deeps", "The Stockade",
    "Excavation Site: Wetlands", "City of Dalaran", "Gnomeregan", "Razorfen Kraul", "Scarlet Monastery: Cathedral", "The Drowned City", "Razorfen Downs", "Krol'dok Stronghold",
    "Uldaman", "Zul'Farrak", "Maraudon", "Alcaz Prison", "Temple of Atal'Hakkar (Sunken Temple)", "Blackrock Depths", "Dire Maul: East", "Blackmaw Hold", "Scholomance",
    "Shaper's Terrace", "Stratholme: Main Gate", "Upper Blackrock Spire"];

  it("gives every Forever dungeon its own painted scene, and unknown dungeons the generic one", () => {
    for (const name of forever) expect(dungeonTheme(name).scene, name).not.toBe("fortress");
    expect(dungeonTheme("Wailing Caverns").scene).toBe("wailing");
    expect(dungeonTheme("Cavernes des lamentations").scene).toBe("wailing");
    expect(dungeonTheme("Ragefire Chasm").scene).toBe("ragefire");
    expect(dungeonTheme("The Deadmines").scene).toBe("deadmines");
    expect(dungeonTheme("City of Dalaran").scene).toBe("dalaran");
    expect(dungeonTheme("Somewhere Nobody Charted").scene).toBe("fortress");
  });
  it("paints the same picture every time, and a different one per dungeon", () => {
    const wailing = dungeonArt(dungeonTheme("Wailing Caverns"));
    expect(dungeonArt(dungeonTheme("Wailing Caverns"))).toBe(wailing);
    expect(dungeonArt(dungeonTheme("Ragefire Chasm"))).not.toBe(wailing);
    // Two unknown dungeons share the generic scene but not its colours.
    expect(dungeonArt(dungeonTheme("Unknown Crypt"))).not.toBe(dungeonArt(dungeonTheme("Another Vault")));
  });
  it("still paints cards queued before scenes existed (motif only)", () => {
    const art = dungeonArt({ a: "#4a0f06", b: "#d2561a", motif: "fire", seed: 7 });
    expect(art).toContain("da-sky");
    expect(art.length).toBeGreaterThan(5000);
    expect(dungeonArt({ a: "hsl(10 55% 12%)", b: "hsl(35 50% 36%)", motif: "cave", seed: 7 })).toContain("da-sky");
  });
  it("embeds no images: the art is vector shapes only", () => {
    for (const name of forever) expect(dungeonArt(dungeonTheme(name)), name).not.toMatch(/<image|href=/);
  });
});

describe("role glyphs", () => {
  it("draws a shield, a cross and crossed swords as vector shapes in one colour per role", () => {
    const tank = roleGlyph("TANK", 0, 0), healer = roleGlyph("HEALER", 0, 0), dps = roleGlyph("DPS", 0, 0);
    expect(tank).toContain(ROLE_COLOR.TANK);
    expect(healer).toContain(ROLE_COLOR.HEALER);
    expect(dps).toContain(ROLE_COLOR.DPS);
    expect(dps.match(/rotate\(/g)).toHaveLength(2);
    for (const glyph of [tank, healer, dps]) expect(glyph).not.toMatch(/<text|<image/);
    expect(new Set([tank, healer, dps, roleGlyph(undefined, 0, 0)]).size).toBe(4);
  });
});

describe("member scores and guild rank", () => {
  it("shows each member's season score with this run's gain when the season is rated", () => {
    const en = dungeonRunCard(run(), "en").dungeon!, fr = dungeonRunCard(run(), "fr").dungeon!;
    expect(en.scoreLabel).toBe("Season score");
    expect(fr.scoreLabel).toBe("Score saison");
    expect(en.party.map((m) => [m.name, m.score, m.scoreNote])).toEqual([["Tank", "1240", "+35"], ["Heal", "1185", undefined], ["Mage", "1310", "+41"], ["Pug", undefined, undefined]]);
  });
  it("falls back to this run's points, and to no column at all", () => {
    const details = run().playerDetails!.map((detail) => {
      const rest = { ...detail, points: detail.character === "Pug" ? 0 : 50 };
      delete rest.ratingTotal; delete rest.ratingGain;
      return rest;
    });
    const points = dungeonRunCard(run({ playerDetails: details }), "fr").dungeon!;
    expect(points.scoreLabel).toBe("Points gagnés");
    expect(points.party.map((m) => m.score)).toEqual(["+50", "+50", "+50", undefined]);
    const none = dungeonRunCard(run({ playerDetails: details.map((d) => ({ ...d, points: 0 })) }), "en").dungeon!;
    expect(none.scoreLabel).toBeUndefined();
  });
  it("names a new record, a first clear, or the run's rank among the guild's clears", () => {
    expect(dungeonRunCard(run({ guildRecord: true, previousGuildBest: 1300, guildRank: { rank: 1, of: 4 } }), "en").badges).toEqual([{ text: "New guild record", tone: "ok" }]);
    expect(dungeonRunCard(run({ guildRank: { rank: 1, of: 1 } }), "fr").badges).toEqual([{ text: "Premier parcours de la guilde", tone: "ok" }]);
    expect(dungeonRunCard(run({ guildRank: { rank: 2, of: 9 } }), "en").badges).toEqual([{ text: "Guild rank 2 of 9", tone: "warn" }]);
    expect(dungeonRunCard(run({ guildRank: { rank: 7, of: 9 } }), "fr").badges).toEqual([{ text: "Rang 7 sur 9 dans la guilde", tone: "muted" }]);
    expect(dungeonRunCard(run(), "en").badges).toEqual([]);
  });
});

describe("rendered dungeon card", () => {
  it("draws the scene's colours, readable text areas and the role marks, well under Discord's attachment limit", async () => {
    const wailing = (await scoreCardPng(dungeonRunCard(run({ guildRank: { rank: 2, of: 5 } }), "en")))!;
    const ragefire = (await scoreCardPng(dungeonRunCard(run({ dungeonName: "Ragefire Chasm" }), "fr")))!;
    for (const png of [wailing, ragefire]) {
      expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
      expect(png.length).toBeLessThan(2 * 1024 * 1024);
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([1200, 630]);
    }
    // The painted backdrop carries the dungeon's colour: a green cavern is greener than red magma (the gutter between the
    // left column and the party panel, where the art shows through).
    const [wr, wg] = await mean(wailing, 560, 60, 40, 450), [rr, rg] = await mean(ragefire, 560, 60, 40, 450);
    expect(wg / wr).toBeGreaterThan(rg / rr);
    expect(rr).toBeGreaterThan(rg);
    // Text sits on dark ground: the empty part of the left column and the frosted panel stay dark.
    expect(luma(await mean(wailing, 330, 200, 220, 140))).toBeLessThan(0.3);
    expect(luma(await mean(ragefire, 330, 200, 220, 140))).toBeLessThan(0.3);
    expect(luma(await mean(wailing, 900, 470, 220, 30))).toBeLessThan(0.25);
    // The tank's mark (first party row) is drawn in the tank blue: the glyph's centre is blue-dominant.
    const [tr, tg, tb] = await mean(wailing, 638, 142, 4, 10);
    expect(tb).toBeGreaterThan(tr + 40);
    expect(tb).toBeGreaterThan(tg);
    // The healer's cross (second row) is green-dominant, the DPS swords (third row) red-dominant.
    const [hr, hg, hb] = await mean(wailing, 642, 205, 4, 4);
    expect(hg).toBeGreaterThan(hr + 40);
    expect(hg).toBeGreaterThan(hb);
    const [dr, dg] = await mean(wailing, 639, 262, 3, 3);
    expect(dr).toBeGreaterThan(dg + 40);
  }, 60_000);
});

describe("painted dungeon artwork files", () => {
  const dir = new URL("../site/dungeon-art/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4));
  it("maps every dungeon and wing to its painting, and leaves the rest procedural", () => {
    expect(paintedKey("Scarlet Monastery: Graveyard")).toBe("scarlet-graveyard");
    expect(paintedKey("Scarlet Monastery: Library")).toBe("scarlet-library");
    expect(paintedKey("Scarlet Monastery: Cathedral")).toBe("scarlet-cathedral");
    expect(paintedKey("Scarlet Monastery: Armory")).toBeUndefined();
    expect(paintedKey("Dire Maul: North")).toBe("dire-maul-north");
    expect(paintedKey("Stratholme: Service Gate")).toBe("stratholme-service");
    expect(paintedKey("Upper Blackrock Spire")).toBe("upper-blackrock-spire");
    expect(paintedKey("Lower Blackrock Spire")).toBe("lower-blackrock-spire");
    expect(paintedKey("Blackrock Depths")).toBe("blackrock-depths");
    expect(paintedKey("Razorfen Downs")).toBe("razorfen-downs");
    expect(paintedKey("Razorfen Kraul")).toBe("razorfen-kraul");
    expect(paintedKey("The Drowned City")).toBe("drowned-city");
    expect(paintedKey("Temple of Atal'Hakkar (Sunken Temple)")).toBe("sunken-temple");
    expect(paintedKey("Alcaz Prison")).toBe("alcaz-prison");
    expect(paintedKey("The Stockade")).toBe("stockade");
    expect(paintedKey("Somewhere Nobody Charted")).toBeUndefined();
    expect(dungeonTheme("Wailing Caverns").painted).toBe("wailing-caverns");
    expect(dungeonTheme("Somewhere Nobody Charted").painted).toBeUndefined();
  });
  it("has a file for every key the names can map to, each 1200x630", async () => {
    for (const name of ["Ragefire Chasm", "The Hall of Thanes", "Ruins of Lordaeron", "Wailing Caverns", "The Deadmines", "Shadowfang Keep", "Blackfathom Deeps", "The Stockade",
      "Excavation Site: Wetlands", "City of Dalaran", "Gnomeregan", "Razorfen Kraul", "Scarlet Monastery: Cathedral", "The Drowned City", "Razorfen Downs", "Krol'dok Stronghold",
      "Uldaman", "Zul'Farrak", "Maraudon", "Alcaz Prison", "Temple of Atal'Hakkar (Sunken Temple)", "Blackrock Depths", "Dire Maul: East", "Blackmaw Hold", "Scholomance",
      "Shaper's Terrace", "Stratholme: Main Gate", "Upper Blackrock Spire"]) {
      const key = paintedKey(name);
      expect(key, name).toBeDefined();
      expect(files, name).toContain(key);
    }
    for (const key of files) { const meta = await sharp(new URL(`${key}.jpg`, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1")).metadata(); expect([meta.width, meta.height], key).toEqual([1200, 630]); }
  });
  it("draws the painting, and falls back to the procedural scene when the file is missing or no painting is named", async () => {
    const theme = dungeonTheme("Wailing Caverns");
    const withArt = await dungeonBackdrop(theme), without = await dungeonBackdrop({ ...theme, painted: undefined }), missing = await dungeonBackdrop({ ...theme, painted: "no-such-file" }), unsafe = await dungeonBackdrop({ ...theme, painted: "../../package" });
    expect((await sharp(withArt).metadata()).width).toBe(1200);
    expect(withArt.equals(without)).toBe(false);
    expect(missing.equals(without)).toBe(true);
    expect(unsafe.equals(without)).toBe(true);
    expect(existsSync(new URL("wailing-caverns.jpg", dir))).toBe(true);
  });
});
