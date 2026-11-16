import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BETA_DUNGEONS } from "../src/services/dungeon-beta-preset.js";
import { dungeonTheme, paintedKey } from "../src/services/dungeon-card.js";
import { LIFT_MAX, LIFT_TARGET, lifted } from "../src/services/dungeon-backdrop.js";
import sharp from "sharp";

const art = (key: string) => fileURLToPath(new URL(`../site/dungeon-art/${key}.jpg`, import.meta.url));
// Dungeons without a painting on purpose (they keep the procedural scene).
const NO_PAINTING: RegExp[] = [];
const EXTRA = ["Zul'Farrak", "Maraudon", "Blackrock Depths", "Stratholme: Main Gate", "Stratholme: Service Entrance", "Scholomance", "Dire Maul: East", "Dire Maul: North", "Dire Maul: West",
  "The Drowned City", "Blackmaw Hold", "Krol'dok Stronghold", "Sunken Temple", "Temple of Atal'Hakkar", "Alcaz Prison", "Lower Blackrock Spire", "Upper Blackrock Spire", "Shaper's Terrace",
  "Scarlet Monastery: Armory", "Scarlet Monastery: Cathedral", "Scarlet Monastery: Library", "Scarlet Monastery: Graveyard", "Profondeurs de Brassenoire", "Cavernes des Lamentations"];

describe("dungeon names map to painting files", () => {
  const names = [...new Set([...BETA_DUNGEONS.map((d) => d.name), ...EXTRA])];
  it.each(names)("%s", (name) => {
    const key = paintedKey(name);
    if (NO_PAINTING.some((re) => re.test(name))) { expect(key).toBeUndefined(); return; }
    expect(key, `no painting key for ${name}`).toBeTruthy();
    expect(existsSync(art(key!)), `site/dungeon-art/${key}.jpg is missing`).toBe(true);
    expect(dungeonTheme(name).painted).toBe(key);
  });
  it("every painting file is reached by some dungeon name", () => {
    const used = new Set(names.map((name) => paintedKey(name)).filter(Boolean));
    const files = readdirSync(fileURLToPath(new URL("../site/dungeon-art/", import.meta.url))).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4));
    expect(files.filter((file) => !used.has(file))).toEqual([]);
  });
});

describe("dark paintings are lifted", () => {
  const leftMean = async (buffer: Buffer) => {
    const stats = await sharp(buffer).extract({ left: 0, top: 0, width: 700, height: 630 }).stats();
    return stats.channels.slice(0, 3).reduce((total, channel) => total + channel.mean, 0) / 3;
  };
  it("brings every shipped painting's text column to a readable brightness", async () => {
    const dark = await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 40, g: 40, b: 40 } } }).jpeg().toBuffer();
    const result = await leftMean(await lifted(dark));
    expect(result).toBeGreaterThan(40 * 1.5);
    expect(result).toBeLessThanOrEqual(40 * LIFT_MAX + 15);
    expect(LIFT_TARGET).toBeGreaterThan(80);
  });
  it("leaves a bright painting alone", async () => {
    const bright = await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 150, g: 150, b: 150 } } }).jpeg().toBuffer();
    expect(await lifted(bright)).toBe(bright);
  });
});

import { dungeonDisplayName, runLabel } from "../src/services/dungeon-card.js";
describe("Scarlet Monastery names its wing", () => {
  const killed = (...names: string[]) => names.map((name) => ({ name, success: true }));
  it("derives the wing from the last boss killed, in English and French", () => {
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: killed("Interrogator Vishas", "Bloodmage Thalnos") })).toBe("Scarlet Monastery: Graveyard");
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: killed("Arcanist Doan") })).toBe("Scarlet Monastery: Library");
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: killed("Herod") }, "fr")).toBe("Scarlet Monastery : Armurerie");
    expect(dungeonDisplayName({ dungeonName: "Monastère Écarlate", encounters: killed("Grande Inquisitrice Blanchetête") }, "fr")).toBe("Monastère Écarlate : Cathédrale");
    expect(paintedKey(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: killed("Arcanist Doan") }))).toBe("scarlet-library");
  });
  it("keeps the name when there is no single wing boss, or a wing is already named", () => {
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: [] })).toBe("Scarlet Monastery");
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", encounters: killed("Arcanist Doan", "Herod") })).toBe("Scarlet Monastery");
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery: Library", encounters: killed("Herod") })).toBe("Scarlet Monastery: Library");
    expect(dungeonDisplayName({ dungeonName: "Gnomeregan", encounters: killed("Herod") })).toBe("Gnomeregan");
    expect(runLabel({ runRef: "R", dungeonName: "Scarlet Monastery", difficultyId: 1, encounters: killed("Arcanist Doan") })).toContain("Library");
  });
});
