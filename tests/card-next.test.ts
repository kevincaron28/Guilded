import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertCardRules } from "../src/services/card-kit.js";
import { renderDungeonCard } from "../src/services/card-layouts-next.js";
import { cardAltText } from "../src/services/card-alt.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { duelResultCard } from "../src/services/duel-card.js";
import { dungeonRunCard, guildDisplayName } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { dungeonPosts } from "../src/services/dungeon-announce.js";
import { battlegroundEndCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";

// Sample names only. CARD_RENDER_DIR also writes the PNGs for review.
const OUT = process.env["CARD_RENDER_DIR"];
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); } };

type Details = NonNullable<DungeonImportResult["playerDetails"]>;
const d = (character: string, extra: Partial<Details[number]> = {}): Details[number] => ({ character, class: "WARRIOR", role: "DPS", deaths: 0, presentSec: 1100, points: 0, ...extra });
const run = (playerDetails: Details, extra: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Wailing Caverns", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1421, points: 12, completedBy: "final boss",
  guildRecord: true, previousGuildBest: 1450, personalRecords: [], players: playerDetails.map((p) => p.character), deaths: 2, unlinked: [],
  inGuildPlayers: playerDetails.slice(0, 2).map((p) => p.character), achievements: [], endedAt: 1794000000, playerDetails, ...extra
});
const party = (): Details => [
  d("Aldric", { role: "TANK", class: "WARRIOR", deaths: 1, ratingTotal: 412, ratingGain: 18 }),
  d("Brenna", { role: "HEALER", class: "PRIEST", ratingTotal: 388, ratingGain: 12, guild: "Our Own Guild" }),
  d("Thessaly", { class: "MAGE", guild: "Moonwell Vanguard of the North Reaches", deaths: 1 }),
  d("Korvin", { class: "ROGUE", guild: "Les Chevaliers d'Argent Libres" }),
  d("Ysolde", { class: "DRUID", guild: "<Evil & \"Co\">" })
];
const names = { Aldric: "Aldric Stormvale", Brenna: "Brenna Ironwood", Thessaly: "Thessaly Moonbright", Korvin: "Korvin Ashgrove", Ysolde: "Ysolde Fairwind" };

describe("dungeon run card (redesign)", () => {
  it("carries every player's recorded guild name (9.3.2), clipped and never raw", () => {
    const card = dungeonRunCard(run(party(), { fullNames: names, inGuildPlayers: ["Aldric", "Brenna"], unlinked: ["Thessaly", "Korvin", "Ysolde"] }), "en");
    const [a, b, c, , e] = card.dungeon!.party;
    expect(a!.guildName).toBeUndefined();
    expect(b!.guildName).toBe("Our Own Guild"); // 9.3.2: shown for everyone the recorder saw a guild for
    expect(c!.guildName).toBe("Moonwell Vanguard of th…");
    expect(c!.guildName!.length).toBeLessThanOrEqual(24);
    expect(e!.guildName).toBe("Evil & \"Co\"");
    expect(cardAltText(card)).toContain("Thessaly Moonbright");
    expect(cardAltText(card)).toContain("<Moonwell Vanguard of th…>");
    expect(guildDisplayName("\u0000\u0007  ")).toBeUndefined();
    expect(guildDisplayName(null)).toBeUndefined();
  });

  it("adds the guild name to the post's text fallback", () => {
    const summary = { results: [run(party(), { fullNames: names, inGuildPlayers: ["Aldric", "Brenna"], unlinked: ["Thessaly", "Korvin", "Ysolde"], mentions: {} })] } as never;
    const [post] = dungeonPosts(summary, "en");
    const text = JSON.stringify(post!.embed.toJSON());
    expect(text).toContain("Thessaly Moonbright");
    expect(text).toMatch(/Moonwell Vanguard of th/);
  });

  for (const lang of ["en", "fr"] as const) {
    it(`draws the redesigned card with five guild-named rows and a death map (${lang})`, async () => {
      const cells: number[] = [];
      for (let i = 0; i < 90; i++) cells.push((40 + i) * 200 + Math.round(100 + 30 * Math.sin(i / 9)));
      const card = dungeonRunCard(run(party(), { fullNames: names, inGuildPlayers: ["Aldric"], unlinked: ["Brenna", "Thessaly", "Korvin", "Ysolde"] }), lang, { deathPoints: [{ x: 0.35, y: 0.5 }, { x: 0.58, y: 0.42 }] });
      card.dungeon = { ...card.dungeon!, mapOutline: { map: 1, cells } };
      const png = await scoreCardPng(card);
      expect(png).not.toBeNull();
      const meta = await sharp(png!).metadata();
      expect([meta.width, meta.height]).toEqual([1200, 630]);
      save(`dungeon-run-${lang}`, png!);
    }, 60_000);
  }

  it("keeps a long party, hostile guild names and the contrast rule: 24 px floor over every painting", async () => {
    const hostile = ["\u0000\u0007bad‮", "\u{1F600}\u{1F409}", "", "x".repeat(300), "Z̈algo"];
    const rows = hostile.map((guild, i) => ({ name: `Player ${i}`, color: "#abd473", role: "dps" as const, score: "300", guild }));
    const paintings = readdirSync(new URL("../site/dungeon-art", import.meta.url)).filter((f) => f.endsWith(".jpg"));
    expect(paintings.length).toBe(34);
    for (const file of paintings) {
      const art = readFileSync(new URL(`../site/dungeon-art/${file}`, import.meta.url));
      const { report, scrim } = await renderDungeonCard({ label: "DUNGEON COMPLETED · HEROIC", title: file.replace(".jpg", ""), hero: "59:59", heroNote: "New guild record", facts: ["Deaths 12", "Dungeon score +123", "Final boss Archmage Arugal"], party: rows, strip: "2026-11-13  ·  Party · 3 from the guild", art });
      assertCardRules(report);
      expect(scrim, file).toBeLessThanOrEqual(0.4);
    }
  }, 120_000);
});

describe("duel and battleground result cards (redesign)", () => {
  it("draws both through the redesign, English and French, from unchanged definitions", async () => {
    const classes = new Map([["aldric", "Warrior"], ["brenna", "Mage"]]);
    const duel = { reportKey: "k1", winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 60, loserLevel: 58, reason: "knockout", points: 14, winnerScore: 120, winnerStreak: 3, winnerBest: 5 } as never;
    const bg = { reportId: "r", mode: "10v10", mapId: 489, bracket: "60", endedAt: new Date(1794000000000), durationSeconds: 1210, outcome: "win", presence: "complete", status: "PROVISIONAL", corroborated: false } as never;
    for (const lang of ["en", "fr"] as const) {
      const d1 = duelResultCard(duel, lang, classes, emptyNameBook), b1 = battlegroundEndCard(bg, [bg], lang);
      expect(d1.rows?.length).toBe(2); // the stored definition keeps its shape
      for (const [name, card] of [["duel", d1], ["battleground", b1]] as const) {
        const png = await scoreCardPng(card);
        expect(png).not.toBeNull();
        save(`${name}-${lang}`, png!);
      }
    }
  }, 60_000);
});
