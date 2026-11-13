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
// A fake traced floor with a few deaths: a no-box map drawn straight on the painting.
const mapSvg = `<defs><radialGradient id="h"><stop offset="0" stop-color="#ff3b1f" stop-opacity=".8"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>
<path d="M760 470 C820 420 860 480 930 440 S1040 360 1100 400 1120 330 1090 300" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="22" stroke-linecap="round"/>
<path d="M760 470 C820 420 860 480 930 440 S1040 360 1100 400 1120 330 1090 300" fill="none" stroke="#e8d9b0" stroke-opacity=".9" stroke-width="9" stroke-linecap="round"/>
<circle cx="930" cy="440" r="26" fill="url(#h)"/><circle cx="930" cy="440" r="4" fill="#ffd0c8"/><circle cx="1100" cy="400" r="26" fill="url(#h)"/><circle cx="1100" cy="400" r="4" fill="#ffd0c8"/>`;

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
      facts: ["2 deaths", "Score 1,840", "Final boss down"], party, mapSvg, strip: "13 Nov 2026 · Party confirmed · 3 of 5 from Quebec Gold",
      art: art("wailing-caverns")
    });
    assertCardRules(report);
    expect(Math.min(...report.map((r) => r.size))).toBeGreaterThanOrEqual(24);
    if (process.env["CARD_RENDER_DIR"]) fs.writeFileSync(`${process.env["CARD_RENDER_DIR"]}/dungeon-run-guilds.png`, png);
  });
});
