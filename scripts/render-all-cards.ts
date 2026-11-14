// Renders every share-card type, in English and French, with ordinary data and with the edge cases that break layouts
// (long two-part names, accents, decorative Unicode, 25+ row ladders, empty boards, one-member parties). For design review.
// Usage: npx tsx scripts/render-all-cards.ts [outDir] [filter]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bgLadderCard } from "../src/services/bg-ladder.js";
import { craftLadderCard } from "../src/services/craft-ladder.js";
import { dailyRecapCard, type DailyRecap } from "../src/services/daily-recap.js";
import { duelBoardCard } from "../src/services/duel-board.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";
import { achievementUnlockedCard, achievementsCard, battlegroundEndCard, raidEndCard, serverAnniversaryCard } from "../src/services/end-cards.js";
import { activityCard } from "../src/services/guild-activity.js";
import { buildClassBook } from "../src/services/ladder-classes.js";
import { pvpGroupCard } from "../src/services/pvp-group-post.js";
import { hallCard, raceCard, type RaceRow } from "../src/services/race-board.js";
import { raidNightCard } from "../src/services/raid-night-check.js";
import { buildRosterVisual, rosterVisualCard } from "../src/services/roster-visual.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";
import { serverStatsCard } from "../src/services/stats-card.js";
import { worldPvpCard } from "../src/services/world-pvp.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";

const outDir = process.argv[2] ?? "card-review";
const filter = process.argv[3] ?? "";
const at = new Date("2026-11-07T14:05:00Z");
type Lang = "en" | "fr";

// Names as members really have them: first and last name, accents, a very long pair, and a decorated nickname.
const NAMES = ["Banished Zakarum", "Mélodie Gagnon", "Crashing Pally", "Aethyria Sylvaeryn", "Johnnysinz Johnnysinzington", "Éloïse Bélanger-Lévesque", "𝓕𝓻𝓾𝓶𝓹𝔂™🎲 Frump",
  "Mortdreath Bloodkazull", "Hulke Hogan", "Xaldin Xaldin", "Nekthrax Doomfist", "Steady Release", "Høly Sheep", "Chad Ho", "Maxle Druide", "El Pirata", "Tusky Restomon",
  "Domichammon Graves", "Nephenee Storm", "Atreyu Mumu", "Holy Zerked", "Mister Haragot", "Shawir Forever", "Grok Solidtusk", "Sysol Makhoj", "Lebowski Holyroller",
  "Vaneesia Main", "Passe Moontagne", "Fire Startaa", "Drakka Whitefang"];
const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const RACES = ["Human", "Dwarf", "Night Elf", "Gnome", "Orc", "Tauren", "Troll", "Undead"];
const name = (i: number) => NAMES[i % NAMES.length]!;
const cls = (i: number) => CLASSES[(i * 5) % CLASSES.length]!;
const book = buildClassBook(NAMES.map((n, i) => ({ name: n, className: cls(i) })));
const moves = (keys: string[]) => new Map<string, number | "new">(keys.map((key, i) => [key, i === 4 ? "new" : i % 5 === 1 ? 2 : i % 7 === 3 ? -1 : 0]));

function race(lang: Lang, count: number): ScoreCard {
  const rows: RaceRow[] = Array.from({ length: count }, (_, i) => ({ key: `k${i}`, name: name(i), className: cls(i), race: RACES[i % RACES.length]!, level: Math.max(8, 60 - Math.floor(i * 0.9)),
    reachedMaxAt: i < 2 ? new Date(at.getTime() - (3 - i) * 3600_000) : null, firstSeenAt: at, weekGain: (i * 3) % 9, memberId: null,
    discordId: i % 3 === 0 ? String(100000000000000000n + BigInt(i)) : null, professions: [], lastSeenAt: at }));
  const members = new Map(rows.filter(r => r.discordId).map((r, i) => [r.discordId!, i % 2 ? "kevmister28" : `${r.name} (discord)`]));
  return raceCard({ rows, total: rows.length + 90, finished: 2, edition: "forever" }, lang, 50, members, at, moves(rows.map(r => r.key)));
}

function dungeon(lang: Lang, partySize: number, longNames: boolean): ScoreCard {
  const party = [
    { c: "Gauthier", full: longNames ? "Johnnysinz Johnnysinzington" : "Gauthier Tremblay", class: "PALADIN", role: "TANK", deaths: 0, rating: 1240, gain: 35 },
    { c: "Melodie", full: longNames ? "Éloïse Bélanger-Lévesque" : "Mélodie Gagnon", class: "PRIEST", role: "HEALER", deaths: 1, rating: 1185, gain: 35 },
    { c: "Frump", full: "𝓕𝓻𝓾𝓶𝓹𝔂™🎲 Frump", class: "MAGE", role: "DAMAGER", deaths: 2, rating: 1310, gain: 41 },
    { c: "Xaldin", full: "Xaldin Xaldin", class: "HUNTER", role: "DAMAGER", deaths: 0, rating: undefined, gain: undefined },
    { c: "Pug", full: "Pug Healson", class: "DRUID", role: "DAMAGER", deaths: 0, rating: undefined, gain: undefined }
  ].slice(0, partySize);
  const result: DungeonImportResult = {
    runRef: "QG-1", dungeonName: longNames ? "Scarlet Monastery: Cathedral" : "Ragefire Chasm", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1958, points: 0, completedBy: "final boss",
    guildRecord: true, previousGuildBest: 2100, personalRecords: [], players: party.map(p => p.c), deaths: 3, unlinked: party.filter(p => p.rating === undefined).map(p => p.c), inGuildPlayers: party.filter(p => p.rating !== undefined).map(p => p.c), achievements: [],
    endedAt: 1794000000, startedAt: 1793998000, ratingEnabled: true, fullNames: Object.fromEntries(party.map(p => [p.c, p.full])),
    encounters: [{ id: 1, name: longNames ? "High Inquisitor Whitemane and Scarlet Commander Mograine" : "Bazzalan", success: true, at: 1794000000 }],
    playerDetails: party.map(p => ({ character: p.c, class: p.class, role: p.role, deaths: p.deaths, presentSec: 1900, points: 0, ...(p.rating !== undefined ? { ratingTotal: p.rating, ratingGain: p.gain } : {}) }))
  };
  return dungeonRunCard(result, lang);
}

const recap = (full: boolean): DailyRecap => ({
  day: "2026-11-06",
  race: full ? { gained: 41, top: [0, 1, 2, 3, 4].map(i => ({ name: name(i), className: cls(i), gain: 9 - i, level: 30 + i })), new60: [{ name: "Johnnysinz Johnnysinzington", className: "Warrior" }] } : null,
  dungeons: { clears: 7, dungeons: 2, mostRuns: { name: full ? "Éloïse Bélanger-Lévesque" : "Maxle Druide", runs: 3 }, highlights: full ? [{ kind: "first", dungeonName: "Shadowfang Keep" }, { kind: "clear", valueSec: 1569, previousSec: 1621, dungeonName: "Ruins of Lordaeron" }] : [] },
  pvp: full ? { duels: 12, topDueler: { name: "Crashing Pally", wins: 7 }, bgPlayed: 4, bgWon: 3 } : null
});

const stat = (day: string, k: number) => ({ day, discordMembers: 140 + k, activeMembers: 60 + k, linkedMembers: 30 + k, rosterSize: 120 + k, onlinePeak: 25, level60: k, messages: 400, voiceMinutes: 900, raids: 0, dungeonRuns: 12 + k,
  levelBands: { "1-19": 40, "20-39": 50, "40-59": 28, "60": k }, classCounts: Object.fromEntries(CLASSES.map((c, i) => [c, 4 + ((i * 7 + k) % 13)])) });

function cards(lang: Lang): [string, ScoreCard | null][] {
  const ids = ACTIVE_ACHIEVEMENTS.map(def => def.id);
  return [
    ["race-50", race(lang, 64)], ["race-empty", race(lang, 0)], ["race-3", race(lang, 3)],
    ["hall", hallCard({ order: 1, name: "Johnnysinz Johnnysinzington", className: "Warrior", race: "Tauren", reachedAt: at, firstSeenAt: new Date("2026-11-04T23:00:00Z"), professions: "Mining 300 · Blacksmithing 285", memberDiscordId: "1", sinceLaunchKnown: true }, lang, "kevmister28")],
    ["duels-18", duelBoardCard({ duels: 214, edition: "forever", recent: [], standings: Array.from({ length: 18 }, (_, i) => { const wins = 30 - i, losses = 4 + i; return { memberId: `m${i}`, name: name(i), wins, losses, games: wins + losses, winRate: wins / (wins + losses), streak: [3, -2, 1][i % 3]!, bestStreak: 5, score: 200 - i * 9 }; }) }, lang, book, at, moves(Array.from({ length: 18 }, (_, i) => `m${i}`)))],
    ["duels-empty", duelBoardCard({ duels: 0, edition: "forever", recent: [], standings: [] }, lang, book, at)],
    ["bg", bgLadderCard({ participations: 40, edition: "forever", brackets: [{ mode: "Warsong Gulch", bracket: "20-29", games: 20, standings: Array.from({ length: 6 }, (_, i) => ({ memberId: `m${i}`, name: name(i), games: 8, wins: 6 - i % 4, losses: 2 + i % 4, draws: 0, winRate: 0.6 })) }] }, lang, book, at)],
    ["dungeon-season-25", dungeonSeasonCard(Array.from({ length: 25 }, (_, i) => ({ name: name(i), points: 545 - i * 19, dungeons: 4 - Math.floor(i / 7), key: `d${i}` })), "Season 1", lang, true, book, at, moves(Array.from({ length: 25 }, (_, i) => `d${i}`)))],
    ["dungeon-season-empty", dungeonSeasonCard([], "Season 1", lang, true, book, at)],
    ["activity", activityCard({ view: "season", label: "Season 1", since: at, rows: Array.from({ length: 4 }, (_, i) => ({ memberId: `a${i}`, name: name(i), dungeons: 250 - i * 60, duels: i * 5, battlegrounds: 0, total: 250 - i * 55 })) }, lang, book, at)],
    ["activity-empty", activityCard({ view: "week", label: lang === "fr" ? "Cette semaine" : "This week", since: at, rows: [] }, lang, book, at)],
    ["crafters", craftLadderCard(Array.from({ length: 12 }, (_, i) => ({ memberId: `c${i}`, name: name(i), className: cls(i), points: 90 - i * 6, crafts: 30 - i, month: 10 - (i % 5), topProfession: ["Blacksmithing", "Leatherworking", "Alchemy"][i % 3]!, lastAt: at })), 312, lang, at)],
    ["crafters-empty", craftLadderCard([], 0, lang, at)],
    ["world-pvp", worldPvpCard({ weekKey: 1, standings: Array.from({ length: 9 }, (_, i) => ({ memberId: `w${i}`, name: name(i), kills: 20 - i * 2, defends: i % 4, helped: i % 3 })) }, lang, book, at)],
    ["world-pvp-empty", worldPvpCard({ weekKey: 1, standings: [] }, lang, book, at)],
    ["dungeon-run-5", dungeon(lang, 5, false)], ["dungeon-run-long", dungeon(lang, 5, true)], ["dungeon-run-1", dungeon(lang, 1, false)],
    ["unlock-one", achievementUnlockedCard("Détergents (Déter Gents)", [ids[3]!], 1, lang)],
    ["unlock-seven-long-name", achievementUnlockedCard("Banished Zakarum (Banished Zakarum)", ids.slice(0, 7), 7, lang)],
    ["unlock-three", achievementUnlockedCard("𝓕𝓻𝓾𝓶𝓹𝔂™🎲", ids.slice(10, 13), 21, lang)],
    ["unlock-twelve", achievementUnlockedCard("Éloïse Bélanger-Lévesque", ids.slice(20, 32), 40, lang)],
    ["achievements-profile", achievementsCard("Johnnysinz Johnnysinzington", ids.slice(0, 30).map((id, i) => ({ id, earnedAt: i < 12 ? new Date(at.getTime() - i * 86400_000) : null, value: i })), lang)],
    ["achievements-none", achievementsCard("Chad Ho", [], lang)],
    ["recap-full", dailyRecapCard(recap(true), lang, "⚜Quebec Gold⚜")], ["recap-thin", dailyRecapCard(recap(false), lang, "Quebec Gold")],
    ["raid-end", raidEndCard({ title: "Hyjal Summit — Les Pulliticiens", startedAt: at, endedAt: at, durationMinutes: 192, raiders: 20, late: 2, absent: 1, bossesKilled: 4, bossesPlanned: 5,
      killedNames: ["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor"], epAwarded: 40, epRecipients: 20, lootCount: 9, gpSpent: 1340,
      topLoot: [{ item: "Bow-stitched Leggings", winner: "Éloïse Bélanger-Lévesque", gp: 300 }, { item: "Hatefury Mantle", winner: "Johnnysinz Johnnysinzington", gp: 280 }] }, lang)],
    ["bg-end", battlegroundEndCard({ reportId: "r1", mode: "Warsong Gulch", mapId: 489, bracket: "20-29", endedAt: at, durationSeconds: 1420, outcome: "win", presence: "complete", status: "PROVISIONAL" },
      [{ reportId: "r1", mode: "Warsong Gulch", mapId: 489, bracket: "20-29", endedAt: at, outcome: "win", presence: "complete", status: "PROVISIONAL" }, { reportId: "r0", mode: "Arathi Basin", mapId: 529, bracket: "20-29", endedAt: at, outcome: "loss", presence: "complete", status: "PROVISIONAL" }], lang)],
    ["anniversary", serverAnniversaryCard({ serverName: "⚜Quebec Gold⚜", years: 2, founded: new Date("2024-11-07"), members: 412, achievementsEarned: 980, oldestMembers: NAMES.slice(0, 5).map((n, i) => ({ displayName: n, createdAt: new Date(2024, 10, 7 + i) })) }, lang)],
    ["pvp-group", pvpGroupCard({ id: "g1", title: "WSG 20-29 premade — Johnnysinz Johnnysinzington", size: 10, status: "OPEN", createdAt: at, minLevel: 20, maxLevel: 29, leaderDiscordId: "1", voiceChannelId: null,
      members: NAMES.slice(0, 6).map((n, i) => ({ name: n, role: (["TANK", "HEALER", "DPS"] as const)[i % 3], color: undefined })), waiting: [{ name: "Høly Sheep", role: "DPS" }] } as never, lang)],
    ["raid-night", raidNightCard({ raidId: "r", title: "Barrow Deeps", scheduledAt: at, slots: [{ role: "TANK", signed: 2, limit: 2 }, { role: "HEALER", signed: 1, limit: 3 }, { role: "DPS", signed: 6, limit: 5 }],
      rows: NAMES.slice(0, 9).map((n, i) => ({ name: n, className: cls(i), role: (["TANK", "HEALER", "DPS"] as const)[i % 3], status: (["READY", "PARTIAL", "NO_CHECK", "LEVELLING"] as const)[i % 4], issues: i % 4 === 1 ? ["NO_FLASK", "MISSING_ENCHANTS"] : [], late: i === 2, lastSeenDays: i === 5 ? 6 : 0 })),
      maybe: 2, waitlisted: 1 }, lang, "America/Toronto")],
    ["roster", rosterVisualCard(buildRosterVisual(Array.from({ length: 140 }, (_, i) => ({ className: cls(i), level: (i * 7) % 61 || null })), [{ profession: "Mining", skillLevel: 150, characterId: "a" }, { profession: "Tailoring", skillLevel: 80, characterId: "b" }], 70), lang, "⚜Quebec Gold⚜")],
    ["server-stats", serverStatsCard([stat("2026-11-05", 1), stat("2026-11-06", 2)], "⚜Quebec Gold⚜", lang)]
  ];
}

mkdirSync(outDir, { recursive: true });
for (const lang of ["en", "fr"] as const) {
  for (const [file, card] of cards(lang)) {
    if (filter && !file.includes(filter)) continue;
    if (!card) { console.log(`${file}-${lang}: no card`); continue; }
    try {
      const png = await scoreCardPng(card);
      writeFileSync(join(outDir, `${file}-${lang}.png`), png!);
      console.log(`${file}-${lang}.png`);
    } catch (error) { console.log(`${file}-${lang}: FAILED ${(error as Error).message}`); }
  }
}
