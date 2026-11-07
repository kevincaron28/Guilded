// Renders sample cards with character pictures (docs/CHARACTER_PICTURES.md, slice 2) for the PR's docs/cards/ samples.
// The pictures are generated stand-ins (coloured busts), not real characters: real ones come from members' uploads.
// Usage: npx tsx scripts/render-picture-cards.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { withCardPictures } from "../src/services/card-pictures.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";

const outDir = process.argv[2] ?? "docs/cards";

/** A stand-in portrait: a lit backdrop and a simple bust in the character's colours. */
export async function standInPicture(sky: string, cloak: string, skin = "#e8c8a0"): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="l" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#0b0906"/></radialGradient></defs>`
    + `<rect width="256" height="256" fill="url(#l)"/><path d="M38 256C46 180 86 160 128 160S210 180 218 256Z" fill="${cloak}"/><circle cx="128" cy="112" r="46" fill="${skin}"/>`
    + `<path d="M80 104C84 60 172 60 176 104C168 84 88 84 80 104Z" fill="${cloak}" opacity=".9"/></svg>`;
  return sharp(Buffer.from(svg)).resize(128, 128).webp({ quality: 80 }).toBuffer();
}

const party = [
  { character: "Gauthier", full: "Gauthier Tremblay", class: "PALADIN", role: "TANK", deaths: 0, rating: 1240, gain: 35, picture: ["#f5a8c8", "#a8325a"] },
  { character: "Melodie", full: "Mélodie Gagnon", class: "PRIEST", role: "HEALER", deaths: 1, rating: 1185, gain: 35, picture: ["#d8e8ff", "#e8e8f0"] },
  { character: "Kev", full: "Kev Caron", class: "MAGE", role: "DAMAGER", deaths: 2, rating: 1310, gain: 41, picture: ["#7ac8ff", "#2a5ab0"] },
  { character: "Xaldin", full: "Xaldin Morrow", class: "HUNTER", role: "DAMAGER", deaths: 0, rating: 980, gain: 0, picture: null },
  { character: "Pug", full: "Pug Healson", class: "DRUID", role: "HEALER", deaths: 0, rating: undefined, gain: undefined, picture: null }
];
const run: DungeonImportResult = {
  runRef: "QG-pictures", dungeonName: "The Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1302, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, guildRank: { rank: 2, of: 9 }, personalRecords: [], players: party.map(p => p.character), deaths: 3, unlinked: ["Pug"],
  inGuildPlayers: party.filter(p => p.rating !== undefined).map(p => p.character), achievements: [], endedAt: 1794000000, startedAt: 1793998800, ratingEnabled: true,
  fullNames: Object.fromEntries(party.map(p => [p.character, p.full])), encounters: [{ id: 1, name: "Edwin VanCleef", success: true, at: 1794000000 }],
  playerDetails: party.map(p => ({ character: p.character, class: p.class, role: p.role, deaths: p.deaths, presentSec: 1100, points: 0,
    ...(p.rating !== undefined ? { ratingTotal: p.rating, ratingGain: p.gain } : {}) }))
};

// An in-memory stand-in for the two tables withCardPictures reads.
const pictures = await Promise.all(party.filter(p => p.picture).map(async (p, i) => ({ characterId: `c${i}`, name: p.character, displayName: p.full, isMain: true, discordUserId: i === 2 ? "kev" : `u${i}`, thumb: await standInPicture(p.picture![0]!, p.picture![1]!) })));
const db = {
  guildSettings: { findUnique: async () => ({ characterPicturesEnabled: true }) },
  characterPicture: {
    findMany: async ({ where }: { where: { characterId?: { in: string[] } } }) => where.characterId
      ? pictures.filter(p => where.characterId!.in.includes(p.characterId)).map(p => ({ characterId: p.characterId, thumb: p.thumb }))
      : pictures.map(p => ({ characterId: p.characterId, character: { name: p.name, displayName: p.displayName } })),
    findFirst: async ({ where }: { where: { character: { member: { discordUserId: string } } } }) => pictures.find(p => p.discordUserId === where.character.member.discordUserId) ?? null
  }
};

mkdirSync(outDir, { recursive: true });
for (const [name, card] of [
  ["dungeon-card-pictures", await withCardPictures(db as never, "guild", dungeonRunCard(run, "en"))],
  ["achievement-card-picture", await withCardPictures(db as never, "guild", achievementUnlockedCard("Kev Caron", [ACTIVE_ACHIEVEMENTS[0]!.id], 12, "en"), "kev")]
] as const) {
  const png = await scoreCardPng(card);
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, png!);
  console.log(`${file} ${(png!.length / 1024).toFixed(0)} KB`);
}
