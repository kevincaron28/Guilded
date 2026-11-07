import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bgLadderCard, bgLadderEmbed } from "../src/services/bg-ladder.js";
import { duelBoardCard, duelBoardEmbed } from "../src/services/duel-board.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";
import { buildClassBook, classOf } from "../src/services/ladder-classes.js";
import { clampTop, DEFAULT_TOP, raceCard, type RaceRow } from "../src/services/race-board.js";
import { ladderMeta, scoreCardPng } from "../src/services/score-card.js";

const at = new Date("2026-11-07T14:05:00Z");
const race = (n: number): RaceRow[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `Racer Number${i}`, className: ["Mage", "Warrior", "Priest"][i % 3]!, race: "Human",
  level: 60 - Math.floor(i / 2), reachedMaxAt: null, firstSeenAt: at, weekGain: i % 2, memberId: null, discordId: null, professions: [], lastSeenAt: at }));
const duelData = (n: number) => ({ duels: 40, edition: "forever", recent: [], standings: Array.from({ length: n }, (_, i) => ({ memberId: `m${i}`, name: i === 0 ? "Kev Caron" : `Duelist ${i}`,
  wins: 20 - i, losses: i, games: 20, winRate: (20 - i) / 20, streak: i === 0 ? 4 : -2, bestStreak: 5 })) });

/** Mean RGB of a rectangle. */
async function mean(png: Buffer, left: number, top: number, width: number, height: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
  return sum.map((v) => v / (data.length / info.channels)) as [number, number, number];
}

describe("class book", () => {
  it("finds a class by full name or first name, and drops an ambiguous first name", () => {
    const book = buildClassBook([{ name: "Kev Caron", className: "Mage" }, { name: "Ann", displayName: "Ann Roy", className: "Priest" }, { name: "Sam One", className: "Rogue" }, { name: "Sam Two", className: "Druid" }]);
    expect(classOf(book, "Kev Caron")).toBe("Mage");
    expect(classOf(book, "kev")).toBe("Mage");
    expect(classOf(book, "Ann Roy")).toBe("Priest");
    expect(classOf(book, "Sam Two")).toBe("Druid");
    expect(classOf(book, "Sam")).toBeUndefined();
    expect(classOf(book, "Nobody")).toBeUndefined();
  });
});

describe("leaderboard cards share the ladder layout", () => {
  it("Race to 60 shows the top 50 by default", () => {
    expect(DEFAULT_TOP).toBe(50);
    expect(clampTop(undefined)).toBe(50);
    expect(clampTop(80)).toBe(50);
    expect(raceCard({ rows: race(70), total: 70, finished: 0, edition: "forever" }, "en", undefined, new Map(), at).ladder!.boards[0]!.rows.map(row => row.rank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
  it("duels: top 25 with wins, losses, win rate, best and current streak, class colours where known", () => {
    const card = duelBoardCard(duelData(30), "fr", buildClassBook([{ name: "Kev Caron", className: "Mage" }]), at);
    const rows = card.ladder!.boards[0]!.rows;
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ rank: 1, name: "Kev Caron", color: "#69ccf0", values: ["20", "0", "100%", "5", "W4", ""] });
    expect(rows[0]).not.toHaveProperty("move");
    expect(card.ladder!.columns.map(column => column.label)).toEqual(["V", "D", "% vict.", "Record", "Série"]);
    expect(card.ladder!.meta).toBe(ladderMeta("fr", at));
    // With the card attached, the embed only names the top 3 and points at the image.
    const embed = duelBoardEmbed(duelData(30), "en", "g1", "duels.png").toJSON();
    expect(embed.image?.url).toBe("attachment://duels.png");
    expect(embed.description!.split("\n")).toHaveLength(3);
    expect(duelBoardEmbed(duelData(30), "en", "g1").toJSON().description!.split("\n")).toHaveLength(10);
  });
  it("battlegrounds: one panel per mode and bracket", () => {
    const standing = (name: string, wins: number) => ({ memberId: name, name, games: wins + 2, wins, losses: 2, draws: 0, winRate: wins / (wins + 2) });
    const data = { participations: 30, edition: "forever", brackets: [{ mode: "Warsong Gulch", bracket: "20-29", games: 20, standings: [standing("A", 8), standing("B", 4)] },
      { mode: "Arathi Basin", bracket: "30-39", games: 10, standings: [standing("C", 3)] }] };
    const card = bgLadderCard(data, "en", new Map(), at);
    expect(card.ladder!.boards.map(board => board.title)).toEqual(["Warsong Gulch · 20-29", "Arathi Basin · 30-39"]);
    expect(card.ladder!.boards[0]!.rows[0]).toMatchObject({ rank: 1, name: "A", values: ["8", "2", "80%", "10", ""] });
    const embed = bgLadderEmbed(data, "en", "g1", "battlegrounds.png").toJSON();
    expect(embed.image?.url).toBe("attachment://battlegrounds.png");
    expect(embed.fields ?? []).toHaveLength(0);
  });
  it("dungeon season: ranked by points with the season and updated time; dungeons counted when rated", () => {
    const rated = dungeonSeasonCard([{ name: "B", points: 900, dungeons: 5 }, { name: "A", points: 1200.4, dungeons: 7 }], "Season 1", "en", true, new Map(), at);
    expect(rated.ladder!.boards[0]!.rows.map(row => [row.rank, row.name, row.values])).toEqual([[1, "A", ["7", "1200", ""]], [2, "B", ["5", "900", ""]]]);
    expect(rated.ladder!.meta).toBe("Season 1 · Updated 2026-11-07 14:05 UTC");
    const points = dungeonSeasonCard([{ name: "A", points: 75 }], "Saison 1", "fr", false, new Map(), at);
    expect(points.ladder!.columns.map(column => column.label)).toEqual(["Points"]);
    expect(points.title).toBe("Points de donjon");
  });
});

describe("rendered ladder", () => {
  it("draws 50 race rows in two columns with gold, silver and bronze medals and a highlighted first place", async () => {
    const png = (await scoreCardPng(raceCard({ rows: race(60), total: 60, finished: 2, edition: "forever" }, "en", 50, new Map(), at)))!;
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBeGreaterThan(1200);
    expect(png.length).toBeLessThan(4 * 1024 * 1024);
    // Panels start at y=176; with a second line the first row runs from 216 to 264 (48 px rows), medals centred at x=92.
    const gold = await mean(png, 84, 238, 3, 3), silver = await mean(png, 84, 286, 3, 3), bronze = await mean(png, 84, 334, 3, 3);
    expect(gold[0]).toBeGreaterThan(200); expect(gold[2]).toBeLessThan(80);
    expect(Math.abs(silver[0] - silver[2])).toBeLessThan(40); expect(silver[1]).toBeGreaterThan(170);
    expect(bronze[0]).toBeGreaterThan(bronze[2] + 60);
    // The first-place row is tinted gold compared with the fourth row's background.
    const first = await mean(png, 368, 220, 8, 4), fourth = await mean(png, 368, 364, 8, 4);
    expect(first[0] - first[2]).toBeGreaterThan(fourth[0] - fourth[2] + 8);
    // The second column of the split board exists (rank 26 starts the right panel).
    const right = await mean(png, 640, 300, 400, 200);
    expect(right[0] + right[1] + right[2]).toBeGreaterThan(30);
  }, 120_000);
  it("draws an empty board without failing", async () => {
    const png = await scoreCardPng(duelBoardCard(duelData(0), "en", new Map(), at));
    expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
  }, 60_000);
});
