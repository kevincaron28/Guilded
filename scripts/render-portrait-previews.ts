// Renders before/after previews of the cards that show a character portrait, with no network: the Armory pictures come from the fixture
// files made once by scripts/fetch-portrait-fixtures.ts (real renders of characters 6978517 and 6691071), through the real delivery step.
// Usage: npx tsx scripts/render-portrait-previews.ts <fixtures dir> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { withArmoryCardPortraits } from "../src/services/card-portraits.js";
import { createCharacterPortraits, portraitUrl } from "../src/services/character-portrait.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { weeklyHonorsMessage, weeklyPostCardExtra, weeklyRookieCardExtra } from "../src/services/community-honors.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

const [fixtures, outDir] = [process.argv[2], process.argv[3]];
if (!fixtures || !outDir) throw new Error("Usage: render-portrait-previews.ts <fixtures dir> <out dir>");
mkdirSync(outDir, { recursive: true });

const ids = [6978517n, 6691071n];
const renders = new Map(ids.map(id => [portraitUrl(id, "main-raw.png"), readFileSync(join(fixtures, `${id}-main-raw.png`))]));
const portraits = createCharacterPortraits({ fetchImage: async (url) => renders.get(url) ?? null });

/** The member's Discord avatar stand-in (what the card showed before). */
const avatar = (letter: string, color: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${color}"/><text x="128" y="168" font-size="130" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text></svg>`)).png().toBuffer();

// A database stand-in: Kev (u-kev) mains the first character, the dungeon party's first two guild members are the two fixtures.
const characters = [
  { name: "Kev", wowId: ids[0]!, discord: "11111111111111111", isMain: true },
  { name: "Melodie", wowId: ids[1]!, discord: "22222222222222222", isMain: true }
];
const db = {
  character: {
    findMany: async ({ where }: { where: { OR?: { name?: { equals: string } }[] } }) => {
      const wanted = where.OR?.[0]?.name?.equals?.toLowerCase();
      return characters.filter(c => c.name.toLowerCase() === wanted).map(c => ({ wowId: c.wowId, member: { discordUserId: c.discord } }));
    },
    findFirst: async ({ where }: { where: { member: { discordUserId: string } } }) => {
      const row = characters.find(c => c.discord === where.member.discordUserId);
      return row ? { name: row.name, wowId: row.wowId } : null;
    }
  },
  armoryRosterEntry: { findFirst: async () => null }
};

async function save(name: string, card: ScoreCard) {
  const png = await scoreCardPng(card);
  if (!png) throw new Error(`${name} did not render`);
  writeFileSync(join(outDir, `${name}.png`), png);
  console.log(name, `${(png.length / 1024).toFixed(0)} KB`);
}
async function pair(name: string, before: ScoreCard, member?: string) {
  await save(`${name}-before`, before);
  await save(`${name}-after`, await withArmoryCardPortraits(db as never, portraits, "guild", before, member));
}
const withAvatar = async (card: ScoreCard, letter: string, color: string): Promise<ScoreCard> => ({ ...card, portrait: (await avatar(letter, color)).toString("base64") });

// 1. Achievement unlock (one member).
await pair("achievement", await withAvatar(achievementUnlockedCard("Kev Caron", [ACTIVE_ACHIEVEMENTS[0]!.id], 12, "en"), "K", "#5865f2"), "11111111111111111");

// 2. Weekly honors (the MVP) and the standalone rookie card.
const A = "11111111111111111", B = "22222222222222222", C = "33333333333333333";
const board = [A, B, C].map((userId, i) => ({ userId, points: [241, 224, 112][i]!, balance: 0 }));
const recap = { points: 577, members: 37, messages: 50, reactions: 9, voiceHours: 0, activities: 0, raids: 0, bossKills: 0, dungeonRuns: 0, newMembers: 1 };
const names = new Map([[A, "Kev Caron"], [B, "Melodie G."], [C, "Newbie"]]);
const message = weeklyHonorsMessage("en", { week: "2026-11-09", board, mvps: [A], recap, rookie: board[2]!, names } as never);
const weekly = weeklyPostCardExtra("en", message, "2026-11-09", board, [A], board[2]!, names, recap, new Map([[A, 2]])) as unknown as { card: ScoreCard; cardMember: string };
await pair("weekly-mvp", await withAvatar(weekly.card, "K", "#5865f2"), weekly.cardMember);
const rookie = weeklyRookieCardExtra("en", message, "2026-11-09", board, board[1], names) as unknown as { card: ScoreCard; cardMember: string };
await pair("rookie", await withAvatar(rookie.card, "M", "#d4688a"), rookie.cardMember);

// 3. Dungeon run (a party of five: two guild characters with pictures, one without, an outsider).
const party = [
  { character: "Kev", full: "Kev Caron", class: "MAGE", role: "DAMAGER", deaths: 0, rating: 1310, gain: 41 },
  { character: "Melodie", full: "Melodie Gagnon", class: "PRIEST", role: "HEALER", deaths: 1, rating: 1185, gain: 35 },
  { character: "Xaldin", full: "Xaldin Morrow", class: "HUNTER", role: "DAMAGER", deaths: 0, rating: 980, gain: 0 },
  { character: "Gauthier", full: "Gauthier Tremblay", class: "PALADIN", role: "TANK", deaths: 2, rating: 1240, gain: 35 },
  { character: "Pug", full: "Pug Healson", class: "DRUID", role: "HEALER", deaths: 0, rating: undefined, gain: undefined }
];
const run: DungeonImportResult = {
  runRef: "QG-portraits", dungeonName: "The Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1302, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, guildRank: { rank: 2, of: 9 }, personalRecords: [], players: party.map(p => p.character), deaths: 3, unlinked: ["Pug"],
  inGuildPlayers: party.filter(p => p.rating !== undefined).map(p => p.character), achievements: [], endedAt: 1794000000, startedAt: 1793998800, ratingEnabled: true,
  fullNames: Object.fromEntries(party.map(p => [p.character, p.full])), encounters: [{ id: 1, name: "Edwin VanCleef", success: true, at: 1794000000 }],
  playerDetails: party.map(p => ({ character: p.character, class: p.class, role: p.role, deaths: p.deaths, presentSec: 1100, points: 0,
    ...(p.rating !== undefined ? { ratingTotal: p.rating, ratingGain: p.gain } : {}) }))
};
await pair("dungeon-run", dungeonRunCard(run, "en"));
