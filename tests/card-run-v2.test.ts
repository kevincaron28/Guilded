import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { renderDungeonCard } from "../src/services/card-layouts-next.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { dungeonBackdrop } from "../src/services/dungeon-backdrop.js";

// Sample names only. CARD_RENDER_DIR writes the PNGs (run-card-v2 previews).
const OUT = process.env["CARD_RENDER_DIR"];
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); } };

type Details = NonNullable<DungeonImportResult["playerDetails"]>;
const base = (playerDetails: Details, extra: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Ragefire Chasm", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: playerDetails.map((d) => d.character), deaths: 0, unlinked: [],
  inGuildPlayers: playerDetails.filter((d) => d.character.startsWith("A") || d.character.startsWith("B")).map((d) => d.character), achievements: [], endedAt: 1794000000, playerDetails, ...extra
});
const d = (character: string, extra: Partial<Details[number]> = {}): Details[number] => ({ character, class: "WARRIOR", deaths: 0, presentSec: 1100, points: 0, ...extra });

const five = [
  d("Aldric Stormvale", { class: "WARRIOR", role: "TANK", level: 24, guild: "Québec Gold", ratingTotal: 412, ratingGain: 36 }),
  d("Brenna Ironwood", { class: "PRIEST", role: "HEALER", level: 23, guild: "Québec Gold", ratingTotal: 388, ratingGain: 36 }),
  d("Cedric Dawnhollow", { class: "MAGE", role: "DPS", level: 24, guild: "Les Gardiens de l'Aube Dorée", ratingTotal: 1210, ratingGain: 0 }),
  d("Dara Nightbloom", { class: "ROGUE", role: "DPS", level: 22, guild: "Nightfall Vanguard Company", ratingTotal: 57, ratingGain: 12 }),
  d("Edric Mira Coldharbour-des-Tempêtes-Sombres", { class: "HUNTER", role: "DPS", level: 24, guild: "Brotherhood of the Silver Hand of Stormwind" })
];
const run = (details: Details, extra: Partial<DungeonImportResult> = {}) => base(details, { ratingEnabled: true, ...extra });

describe("the run card v2: level, guild, score gained and season total", () => {
  it("carries level, gain and total only where the bot knows them", () => {
    const card = dungeonRunCard(run(five), "en");
    const party = card.dungeon!.party;
    expect(party[0]).toMatchObject({ level: 24, gain: 36, total: 412, guildName: "Québec Gold" });
    expect(party[2]).toMatchObject({ gain: 0, total: 1210 });
    expect(party[4]!.gain).toBeUndefined(); // no rating known for this player: nothing invented
    expect(party[4]!.total).toBeUndefined();
    expect(card.dungeon!.columns).toEqual({ level: "Lv", gain: "This run", total: "Season" });
    expect(dungeonRunCard(run(five), "fr").dungeon!.columns).toEqual({ level: "Niv", gain: "Cette run", total: "Saison" });
  });
  it("has no score columns for a run without ratings", () => {
    const card = dungeonRunCard(base([d("Aldric", { level: 24 })]), "en");
    expect(card.dungeon!.columns).toBeUndefined();
    expect(card.dungeon!.party[0]!.gain).toBeUndefined();
  });

  const scenes: [string, DungeonImportResult][] = [
    ["five-guilds", run(five, { guildRecord: true, previousGuildBest: 1450, deaths: 3 })],
    ["not-ranked", base(five.map((p) => { const q = { ...p, unrankedReason: "Participation-only route" } as Details[number]; delete q.ratingTotal; delete q.ratingGain; return q; }), { ratingEnabled: true })],
    ["record", run(five.slice(0, 3), { guildRecord: true, previousGuildBest: 1450 })]
  ];
  for (const lang of ["en", "fr"] as const) {
    it(`renders every scene (${lang})`, async () => {
      for (const [name, r] of scenes) {
        const png = await scoreCardPng(dungeonRunCard(r, lang));
        expect(png, name).toBeInstanceOf(Buffer);
        expect(await sharp(png!).metadata()).toMatchObject({ width: 1200, height: 630 });
        save(`run-${name}-${lang}`, png!);
      }
    }, 120_000);
  }

  it("draws both role emblem looks side by side", async () => {
    const card = dungeonRunCard(run(five), "en"), visual = card.dungeon!;
    const art = await dungeonBackdrop(visual.theme);
    for (const roleStyle of ["medal", "frame"] as const) {
      const { png } = await renderDungeonCard({
        label: "DUNGEON · NORMAL", title: "Ragefire Chasm", hero: "18:25", facts: ["3 deaths", "Dungeon score +36"],
        party: visual.party.slice(0, 5).map((m) => ({ name: m.name, color: m.color, role: m.role === "TANK" ? "tank" : m.role === "HEALER" ? "healer" : "dps", level: m.level, gain: m.gain, total: m.total === undefined ? undefined : String(m.total), guild: m.guildName })),
        columns: { level: "Lv", guild: "Guild", gain: "This run", total: "Season" }, roleStyle, strip: "2026-11-14 · Party · 2 from the guild", art
      });
      save(`run-emblems-${roleStyle}`, png);
      expect(png.length).toBeGreaterThan(10_000);
    }
  }, 120_000);
});
