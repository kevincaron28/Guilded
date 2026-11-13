import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { assertCardRules } from "../src/services/card-kit.js";
import { guildTag, renderDungeonCard } from "../src/services/card-layouts-next.js";

const art = (n: string) => fs.readFileSync(new URL(`../site/dungeon-art/${n}.jpg`, import.meta.url));
const party = [
  { name: "Brenna Stoneward", color: "#c79c6e", role: "tank" as const, score: "412", guild: "Moonwell Vanguard of the North" },
  { name: "Aldric Vane", color: "#f58cba", role: "healer" as const, score: "388", guild: null },
  { name: "Thessaly Moonbright", color: "#69ccf0", role: "dps" as const, score: "401", guild: "Les Chevaliers d'Argent Libres" },
  { name: "Korvin", color: "#fff569", role: "dps" as const, score: "377", guild: "Quebec Gold" },
  { name: "Ysolde Fairwind", color: "#abd473", role: "dps" as const, score: "359", guild: "<Evil & \"Co\">" }
];
// A fake traced floor (a winding path of grid cells) with two deaths.
const cells: number[] = [];
for (let i = 0; i < 90; i++) cells.push((40 + i) * 200 + Math.round(100 + 30 * Math.sin(i / 9)));
const map = { cells, points: [{ x: 0.35, y: 0.5 }, { x: 0.58, y: 0.42 }] };

describe("dungeon card mock-up", () => {
  it("clips and brackets guild names", () => {
    expect(guildTag("  Moonwell   Vanguard ")).toBe("<Moonwell Vanguard>");
    expect(guildTag("x".repeat(40))).toBe(`<${"x".repeat(23)}…>`);
    expect(guildTag(null)).toBe("");
    expect(guildTag("   ")).toBe("");
  });
  it("holds the 24 px floor and 4.5:1 with five guild-named rows", async () => {
    const { png, report } = await renderDungeonCard({
      label: "DUNGEON · HEROIC", title: "Wailing Caverns", hero: "23:41", heroNote: "New guild record · was 24:10",
      facts: ["2 deaths", "Score 1,840", "Final boss down"], party, map, strip: "13 Nov 2026 · Party confirmed · 3 of 5 from Quebec Gold",
      art: art("wailing-caverns")
    });
    assertCardRules(report);
    expect(Math.min(...report.map((r) => r.size))).toBeGreaterThanOrEqual(24);
    if (process.env["CARD_RENDER_DIR"]) fs.writeFileSync(`${process.env["CARD_RENDER_DIR"]}/dungeon-run-guilds.png`, png);
  });
});
