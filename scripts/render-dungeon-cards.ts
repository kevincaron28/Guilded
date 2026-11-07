// Renders sample dungeon completion cards to PNG files, for design review and the PR's docs/cards/ samples.
// Usage: npx tsx scripts/render-dungeon-cards.ts [outDir] [dungeon name ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { scoreCardPng } from "../src/services/score-card.js";

const outDir = process.argv[2] ?? "docs/cards";
const names = process.argv.slice(3);
const all = ["Wailing Caverns", "Ragefire Chasm", "The Deadmines", "Shadowfang Keep", "The Stockade", "Blackfathom Deeps", "The Hall of Thanes", "Ruins of Lordaeron",
  "Excavation Site: Wetlands", "City of Dalaran", "Gnomeregan", "Razorfen Kraul", "Scarlet Monastery: Cathedral", "Uldaman", "Zul'Farrak", "Maraudon", "Blackrock Depths",
  "Stratholme: Main Gate", "Scholomance", "Dire Maul: East", "The Drowned City", "Blackmaw Hold", "Krol'dok Stronghold", "Some Unknown Crypt"];

const party = [
  { character: "Gauthier", full: "Gauthier Tremblay", class: "PALADIN", role: "TANK", spec: "Protection", deaths: 0, rating: 1240, gain: 35 },
  { character: "Melodie", full: "Mélodie Gagnon", class: "PRIEST", role: "HEALER", spec: "Holy", deaths: 1, rating: 1185, gain: 35 },
  { character: "Kev", full: "Kev Caron", class: "MAGE", role: "DAMAGER", spec: "Frost", deaths: 2, rating: 1310, gain: 41 },
  { character: "Xaldin", full: "Xaldin Morrow", class: "HUNTER", role: "DAMAGER", spec: undefined, deaths: 0, rating: 980, gain: 0 },
  { character: "Pug", full: "Pug Healson", class: "DRUID", role: "HEALER", spec: undefined, deaths: 0, rating: undefined, gain: undefined }
];

function sample(dungeonName: string, i: number): DungeonImportResult {
  const guild = party.filter((p) => p.rating !== undefined).map((p) => p.character);
  return {
    runRef: `QG-${i}`, dungeonName, difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105 + i * 97, points: 0, completedBy: "final boss",
    guildRecord: i % 3 === 0, previousGuildBest: i % 3 === 0 ? 1300 : null, ...(i % 3 === 0 ? {} : { guildRank: { rank: 1 + (i % 4), of: 6 + i } }),
    personalRecords: [], players: party.map((p) => p.character), deaths: 3, unlinked: ["Pug"], inGuildPlayers: guild, achievements: [],
    endedAt: 1794000000, startedAt: 1793998800, ratingEnabled: true,
    fullNames: Object.fromEntries(party.map((p) => [p.character, p.full])),
    encounters: [{ id: 1, name: "Final Boss of the Place", success: true, at: 1794000000 }],
    playerDetails: party.map((p) => ({ character: p.character, class: p.class, role: p.role, ...(p.spec ? { spec: p.spec } : {}), deaths: p.deaths, presentSec: 1100, points: 0,
      ...(p.rating !== undefined ? { ratingTotal: p.rating, ratingGain: p.gain } : {}) }))
  };
}

mkdirSync(outDir, { recursive: true });
for (const [i, name] of (names.length ? names : all).entries()) {
  const lang = i % 2 ? "fr" : "en", t0 = Date.now();
  const png = await scoreCardPng(dungeonRunCard(sample(name, i), lang));
  const file = join(outDir, `dungeon-card-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`);
  writeFileSync(file, png!);
  console.log(`${file} ${(png!.length / 1024).toFixed(0)} KB ${Date.now() - t0} ms`);
}
