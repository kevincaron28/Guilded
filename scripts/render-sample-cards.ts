// Renders the website/marketing sample cards with made-up data (guild "Example Guild", invented characters, never real members).
// Output: optimised webp (site) in site/images/discord and PNG copies for CurseForge/social in docs/marketing/screenshots-9nov/discord.
// Usage: npx tsx scripts/render-sample-cards.ts [siteDir] [marketingDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dailyRecapCard } from "../src/services/daily-recap.js";
import { duelBoardCard } from "../src/services/duel-board.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { achievementUnlockedCard, battlegroundEndCard, raidEndCard } from "../src/services/end-cards.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { buildClassBook } from "../src/services/ladder-classes.js";
import { hallCard, raceCard, type RaceRow } from "../src/services/race-board.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

const siteDir = process.argv[2] ?? "site/images/discord";
const marketingDir = process.argv[3] ?? "docs/marketing/screenshots-9nov/discord";
const at = new Date("2026-11-07T14:05:00Z");
const GUILD = "Example Guild";
type Lang = "en" | "fr";

const NAMES = ["Aldric Stonehelm", "Mira Fenwick", "Tobias Rook", "Lyra Dawnwhistle", "Garrick Ashvale", "Sela Brightwater", "Dunmar Ironvale", "Nessa Quillfeather",
  "Orrin Mossgrove", "Petra Hollowell", "Bram Coldbrook", "Ysolde Marrow", "Corvin Thistle", "Hilda Rainsong", "Fenwick Oakes", "Talia Emberfall"];
const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const RACES = ["Human", "Dwarf", "Night Elf", "Gnome", "Orc", "Tauren", "Troll", "Undead"];
const name = (i: number) => NAMES[i % NAMES.length]!;
const cls = (i: number) => CLASSES[(i * 5) % CLASSES.length]!;
const book = buildClassBook(NAMES.map((n, i) => ({ name: n, className: cls(i) })));
const moves = (keys: string[]) => new Map<string, number | "new">(keys.map((key, i) => [key, i === 4 ? "new" : i % 5 === 1 ? 2 : i % 7 === 3 ? -1 : 0]));

function race(lang: Lang): ScoreCard {
  const rows: RaceRow[] = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, name: name(i), className: cls(i), race: RACES[i % RACES.length]!, level: Math.max(14, 60 - Math.floor(i * 3.1)),
    reachedMaxAt: i < 2 ? new Date(at.getTime() - (3 - i) * 3600_000) : null, firstSeenAt: at, weekGain: (i * 3) % 9, memberId: null, discordId: null, professions: [], lastSeenAt: at }));
  return raceCard({ rows, total: 96, finished: 2, edition: "forever" }, lang, 12, new Map(), at, moves(rows.map(r => r.key)));
}

function dungeon(lang: Lang): ScoreCard {
  const party = [
    { c: "Aldric", full: "Aldric Stonehelm", class: "PALADIN", role: "TANK", deaths: 0, rating: 1240, gain: 35 },
    { c: "Mira", full: "Mira Fenwick", class: "PRIEST", role: "HEALER", deaths: 1, rating: 1185, gain: 35 },
    { c: "Tobias", full: "Tobias Rook", class: "MAGE", role: "DAMAGER", deaths: 2, rating: 1310, gain: 41 },
    { c: "Lyra", full: "Lyra Dawnwhistle", class: "HUNTER", role: "DAMAGER", deaths: 0, rating: 1090, gain: 28 },
    { c: "Garrick", full: "Garrick Ashvale", class: "ROGUE", role: "DAMAGER", deaths: 0, rating: 1022, gain: 24 }
  ];
  const result: DungeonImportResult = {
    runRef: "EX-1", dungeonName: "Ragefire Chasm", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1958, points: 0, completedBy: "final boss",
    guildRecord: true, previousGuildBest: 2100, personalRecords: [], players: party.map(p => p.c), deaths: 3, unlinked: [], inGuildPlayers: party.map(p => p.c), achievements: [],
    endedAt: 1794000000, startedAt: 1793998000, ratingEnabled: true, fullNames: Object.fromEntries(party.map(p => [p.c, p.full])),
    encounters: [{ id: 1, name: "Bazzalan", success: true, at: 1794000000 }],
    playerDetails: party.map(p => ({ character: p.c, class: p.class, role: p.role, deaths: p.deaths, presentSec: 1900, points: 0, ratingTotal: p.rating, ratingGain: p.gain }))
  };
  return dungeonRunCard(result, lang);
}

function cards(lang: Lang): [string, ScoreCard | null][] {
  const ids = ACTIVE_ACHIEVEMENTS.map(def => def.id);
  return [
    ["dungeon-run", dungeon(lang)],
    ["daily-recap", dailyRecapCard({
      day: "2026-11-06",
      race: { gained: 41, top: [0, 1, 2, 3, 4].map(i => ({ name: name(i), className: cls(i), gain: 9 - i, level: 30 + i })), new60: [{ name: name(8), className: "Warrior" }] },
      dungeons: { clears: 7, dungeons: 2, mostRuns: { name: name(2), runs: 3 }, highlights: [{ kind: "first", dungeonName: "Shadowfang Keep" }, { kind: "clear", valueSec: 1569, previousSec: 1621, dungeonName: "Ruins of Lordaeron" }] },
      pvp: { duels: 12, topDueler: { name: name(3), wins: 7 }, bgPlayed: 4, bgWon: 3 }
    }, lang, GUILD)],
    ["race-to-60", race(lang)],
    ["hall-of-fame", hallCard({ order: 1, name: name(0), className: "Warrior", race: "Tauren", reachedAt: at, firstSeenAt: new Date("2026-11-04T23:00:00Z"), professions: "Mining 300 · Blacksmithing 285", memberDiscordId: null, sinceLaunchKnown: true }, lang, null)],
    ["duel-ladder", duelBoardCard({ duels: 214, edition: "forever", recent: [], standings: Array.from({ length: 10 }, (_, i) => { const wins = 30 - i * 2, losses = 4 + i; return { memberId: `m${i}`, name: name(i), wins, losses, games: wins + losses, winRate: wins / (wins + losses), streak: [3, -2, 1][i % 3]!, bestStreak: 5, score: 200 - i * 14 }; }) }, lang, book, at, moves(Array.from({ length: 10 }, (_, i) => `m${i}`)))],
    ["achievements", achievementUnlockedCard(name(1), ids.slice(0, 5), 18, lang)],
    ["raid-end", raidEndCard({ title: "Example Guild Raid Night", startedAt: at, endedAt: at, durationMinutes: 192, raiders: 20, late: 2, absent: 1, bossesKilled: 4, bossesPlanned: 5,
      killedNames: ["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor"], epAwarded: 40, epRecipients: 20, lootCount: 9, gpSpent: 1340,
      topLoot: [{ item: "Bow-stitched Leggings", winner: name(1), gp: 300 }, { item: "Hatefury Mantle", winner: name(0), gp: 280 }] }, lang)],
    ["battleground-end", battlegroundEndCard({ reportId: "r1", mode: "Warsong Gulch", mapId: 489, bracket: "20-29", endedAt: at, durationSeconds: 1420, outcome: "win", presence: "complete", status: "PROVISIONAL" },
      [{ reportId: "r1", mode: "Warsong Gulch", mapId: 489, bracket: "20-29", endedAt: at, outcome: "win", presence: "complete", status: "PROVISIONAL" }, { reportId: "r0", mode: "Arathi Basin", mapId: 529, bracket: "20-29", endedAt: at, outcome: "loss", presence: "complete", status: "PROVISIONAL" }], lang)]
  ];
}

mkdirSync(siteDir, { recursive: true });
mkdirSync(marketingDir, { recursive: true });
for (const lang of ["en", "fr"] as const) {
  for (const [file, card] of cards(lang)) {
    if (!card) { console.log(`${file}-${lang}: no card`); continue; }
    const png = Buffer.from((await scoreCardPng(card))!);
    const webp = await sharp(png).webp({ quality: 82, effort: 6 }).toBuffer();
    const meta = await sharp(png).metadata();
    writeFileSync(join(siteDir, `${file}-${lang}.webp`), webp);
    if (lang === "en") writeFileSync(join(marketingDir, `${file}.png`), await sharp(png).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
    console.log(`${file}-${lang}.webp ${meta.width}x${meta.height} ${webp.length}`);
  }
}
