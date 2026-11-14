import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { duelBoardCard } from "../src/services/duel-board.js";
import { bgLadderCard } from "../src/services/bg-ladder.js";
import { worldPvpCard } from "../src/services/world-pvp.js";
import { craftLadderCard } from "../src/services/craft-ladder.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";
import { communityBoardCard } from "../src/services/community-leaderboard.js";
import { raceCard } from "../src/services/race-board.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

// Sample names only. CARD_RENDER_DIR writes the PNGs (group-2 previews).
const OUT = process.env["CARD_RENDER_DIR"];
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); } };
const NAMES = ["Aldric Stormvale", "Brenna Ironwood", "Cedric Dawnhollow", "Dara Nightbloom", "Edric Thornfield", "Fenna Ashgrove", "Garrick Moonwell", "Hilda Redcliff", "Ivor Stonebrook", "Jora Whitefen", "Kell Duskmantle", "Lysa Brightwater", "Mira Coldharbour-des-Tempêtes-Sombres", "Nox Valehart"];
const CLASSES = ["Warrior", "Mage", "Paladin", "Druid", "Hunter", "Warlock", "Priest", "Rogue"];
const classes = new Map(NAMES.map((n, i) => [n.toLowerCase(), CLASSES[i % CLASSES.length]!]));
const at = new Date("2026-11-13T15:05:00Z");
const moves = new Map<string, number | "new">(NAMES.map((n, i) => [n, i % 3 === 0 ? 1 : i % 3 === 1 ? -2 : "new"])) as never;

const duel = (n: number) => ({ standings: NAMES.slice(0, n).map((name, i) => ({ memberId: name, name, score: 1500 - i * 37, wins: 30 - i, losses: 2 + i, winRate: 0.9 - i * 0.03, bestStreak: 8 - (i % 5), streak: i % 4, ranked: true, rank: i + 1 })), duels: 160, recent: [], edition: "forever", mode: "points" as const });
const bg = { participations: 240, edition: "forever", brackets: [{ mode: "Warsong Gulch", bracket: "60", standings: NAMES.slice(0, 7).map((name, i) => ({ memberId: name, name, wins: 20 - i, losses: 3 + i, games: 23, winRate: 0.8 - i * 0.05 })) }, { mode: "Arathi Basin", bracket: "60", standings: NAMES.slice(0, 5).map((name, i) => ({ memberId: name, name, wins: 12 - i, losses: 2 + i, games: 14, winRate: 0.7 - i * 0.04 })) }] };
const pvp = { weekKey: 1, standings: NAMES.slice(0, 10).map((name, i) => ({ memberId: name, name, kills: 90 - i * 7, defends: 14 - i, helped: 9, deaths: 12 + i, rank: i + 1 })) };
const crafters = NAMES.slice(0, 12).map((name, i) => ({ memberId: name, name, className: CLASSES[i % 8]!, points: 80 - i * 5, crafts: 80 - i * 5, month: 20 - i, topProfession: i % 2 ? "Blacksmithing" : "Alchimie", lastAt: at }));
const season = NAMES.slice(0, 12).map((name, i) => ({ name, points: 900 - i * 41, dungeons: 30 - i, key: name }));
const community = NAMES.slice(0, 12).map((name, i) => ({ userId: name, balance: 0, discord: 180 - i * 9, dungeons: 60 - i * 3, pvp: 24 - i, points: 264 - i * 13 }));
const race = { total: 80, finished: 12, edition: "forever", rows: NAMES.slice(0, 12).map((name, i) => ({ key: name, name, className: CLASSES[i % 8]!, race: "Human", level: 60 - Math.floor(i / 3), reachedMaxAt: null, firstSeenAt: at, weekGain: i % 2 ? 3 : 0, memberId: null, discordId: null, professions: [], lastSeenAt: at })) };

function boards(lang: "en" | "fr", rows = 12): [string, ScoreCard][] {
  return [
    ["duel-ladder", duelBoardCard(duel(rows) as never, lang, classes, at, moves)],
    ["battleground-ladder", bgLadderCard(bg as never, lang, classes, at)],
    ["world-pvp-board", worldPvpCard(pvp as never, lang, classes, at)],
    ["crafters", craftLadderCard(crafters as never, 640, lang, at, moves)],
    ["dungeon-season", dungeonSeasonCard(season, "Season 1", lang, true, classes, at, moves)],
    ["community", communityBoardCard({ lang, season: { name: "Season 3 — November 2026", number: 3, status: "ACTIVE" }, board: community, names: new Map(NAMES.map(n => [n, n])), moves: new Map(NAMES.map((n, i) => [n, i % 3 === 0 ? 1 : i % 3 === 1 ? -2 : "new"])) as never, updatedAt: at })],
    ["race-to-60", raceCard(race as never, lang, 12, new Map(), at, moves)]
  ];
}

describe("ladder cards on the banner layout", () => {
  for (const lang of ["en", "fr"] as const) {
    it(`draws every board from its unchanged definition (${lang})`, async () => {
      for (const [name, card] of boards(lang)) {
        expect(card.ladder, name).toBeTruthy(); // the stored definition keeps its ladder
        const png = await scoreCardPng(card);
        expect(png, name).toBeInstanceOf(Buffer);
        const meta = await sharp(png!).metadata();
        expect([meta.width, meta.height], name).toEqual([1200, 630]); // the redesigned banner card; the old ladder card grew with its rows
        save(`${name}-${lang}`, png!);
      }
    }, 120_000);
  }

  it("keeps short and empty boards: one wide column, and an empty board stays on the old card", async () => {
    const short = await scoreCardPng(duelBoardCard(duel(3) as never, "en", classes, at, null));
    expect((await sharp(short!).metadata()).height).toBe(630);
    save("duel-ladder-3-rows", short!);
    const empty = duelBoardCard({ ...duel(0), standings: [] } as never, "en", classes, at, null);
    const png = await scoreCardPng(empty);
    expect(png).toBeInstanceOf(Buffer);
  }, 60_000);
});
