import { describe, expect, it, vi } from "vitest";
import { bossKills, bossRecordLines, highlightHeadline, recordRunHighlights, runHighlights, type PriorClear } from "../src/services/dungeon-records.js";
import { dailyRecap, dailyRecapCard, dailyRecapEmbed, queueDailyRecaps, recapDay, recapIsEmpty, type DailyRecap } from "../src/services/daily-recap.js";
import { dayGain, nextEntry } from "../src/services/race-board.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import { dungeonPosts } from "../src/services/dungeon-announce.js";
import { scoreCardPng } from "../src/services/score-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";

const T0 = 1_762_500_000;
function run(over: Partial<DungeonImportResult> = {}): DungeonImportResult {
  return {
    runRef: "Alda-1", runId: "run1", dungeonName: "Wailing Caverns", instanceId: 43, difficultyId: 1, state: "COMPLETED", valid: true,
    durationSec: 1500, points: 0, guildRecord: false, previousGuildBest: null, personalRecords: [], players: ["Alda", "Bren", "Cyra", "Dax", "Eli"],
    deaths: 0, endedAt: T0 + 1500, startedAt: T0, unlinked: [], achievements: [],
    encounters: [{ id: 585, name: "Lady Anacondra", success: true, startedAt: T0 + 100, at: T0 + 160 }, { id: 592, name: "Mutanus", success: true, startedAt: T0 + 1400, at: T0 + 1490 }],
    playerDetails: ["Alda", "Bren", "Cyra", "Dax", "Eli"].map(character => ({ character, deaths: 0, presentSec: 1500, points: 0 })),
    ...over
  };
}
const prior = (over: Partial<PriorClear> = {}): PriorClear => ({ difficultyId: 1, endedAt: T0 - 86400, kills: [{ id: 585, name: "Lady Anacondra", sec: 90 }], deathless: true, allGuild: true, ...over });

describe("boss kills", () => {
  it("uses pull → kill seconds, ignores wipes, missing pull times and absurd values", () => {
    expect(bossKills([
      { id: 1, name: "A", success: true, startedAt: 100, at: 160 },
      { id: 2, name: "B", success: false, startedAt: 100, at: 160 },
      { id: 3, name: "C", success: true, at: 160 },
      { id: 4, name: "D", success: true, startedAt: 100, at: 101 },
      { id: 1, name: "A", success: true, startedAt: 200, at: 250 }
    ])).toEqual([{ id: 1, name: "A", sec: 50 }]);
  });
});

describe("run highlights", () => {
  it("the first guild clear of a dungeon is a highlight with all its challenges, but a first boss kill is not a record", () => {
    const items = runHighlights(run(), []);
    expect(items.map(item => item.kind)).toEqual(["first", "deathless", "guild5"]);
    expect(items[0]!.key).toBe("first:43:1");
  });
  it("beats an earlier boss kill on the same difficulty only", () => {
    const items = runHighlights(run(), [prior(), prior({ difficultyId: 2, kills: [{ id: 592, name: "Mutanus", sec: 10 }] })]);
    expect(items).toEqual([expect.objectContaining({ kind: "boss", label: "Lady Anacondra", valueSec: 60, previousSec: 90, key: "boss:585:1:run1" })]);
  });
  it("reuses the import's guild record decision for the fastest clear", () => {
    const items = runHighlights(run({ guildRecord: true, previousGuildBest: 1600 }), [prior({ kills: [] })]);
    expect(items.map(item => item.kind)).toEqual(["clear"]);
    expect(items[0]).toMatchObject({ valueSec: 1500, previousSec: 1600 });
  });
  it("challenges are once per dungeon: history that already did it, an outsider or an untracked death stops them", () => {
    expect(runHighlights(run(), [prior({ kills: [], deathless: false, allGuild: false })]).map(item => item.kind)).toEqual(["deathless", "guild5"]);
    const outsider = run({ unlinked: ["Eli"], inGuildPlayers: [] });
    expect(runHighlights(outsider, [prior({ kills: [], deathless: true, allGuild: false })])).toEqual([]);
    const untracked = run({ playerDetails: run().playerDetails!.map((p, i) => ({ ...p, deaths: i === 0 ? null : 0 })) });
    expect(runHighlights(untracked, [prior({ kills: [], deathless: false })]).map(item => item.kind)).toEqual([]);
  });
  it("simulations, invalid and unfinished runs never count", () => {
    expect(runHighlights(run({ runRef: "SIM-1" }), [])).toEqual([]);
    expect(runHighlights(run({ valid: false }), [])).toEqual([]);
    expect(runHighlights(run({ state: "ABANDONED" }), [])).toEqual([]);
  });
});

describe("recording highlights", () => {
  it("stores new highlights once and attaches only the new ones; an earlier run of the upload counts as history", async () => {
    const stored = new Set<string>(["deathless:43:1"]);
    const created: { key: string }[] = [];
    const db = {
      dungeonRun: { findMany: vi.fn(async (args: { where: { id?: { in?: string[] } } }) => args.where.id?.in
        ? [{ id: "run1", instanceId: 43, endedAt: new Date() }, { id: "run2", instanceId: 43, endedAt: new Date() }] : []) },
      dungeonHighlight: {
        findMany: vi.fn(async (args: { where: { key: { in: string[] } } }) => args.where.key.in.filter(key => stored.has(key)).map(key => ({ key }))),
        createMany: vi.fn(async (args: { data: { key: string }[] }) => { for (const row of args.data) { stored.add(row.key); created.push(row); } return { count: args.data.length }; })
      }
    };
    const first = run(), second = run({ runId: "run2", runRef: "Alda-2", endedAt: T0 + 9000, encounters: [{ id: 585, name: "Lady Anacondra", success: true, startedAt: T0 + 8000, at: T0 + 8030 }] });
    await recordRunHighlights(db as never, "g1", [second, first]);
    expect(first.highlights?.map(item => item.kind)).toEqual(["first", "guild5"]);
    expect(second.highlights?.map(item => item.kind)).toEqual(["boss"]);
    expect(created.map(row => row.key)).toEqual(["first:43:1", "guild5:43:1", "boss:585:1:run2"]);
  });
});

describe("run post callouts", () => {
  it("leads the post with the highlight and puts them on the card as badges", () => {
    const withHighlights = run({ highlights: runHighlights(run(), []) });
    const [post] = dungeonPosts({ results: [withHighlights], duplicates: 0, malformed: 0 }, "en");
    expect(post!.content).toBe("🏆 **First guild clear · Flawless · All-guild party** · Wailing Caverns (Normal)");
    expect(dungeonRunCard(withHighlights, "fr").badges?.map(badge => badge.text)).toEqual(["Premier parcours de la guilde", "Sans mort", "Groupe 100 % guilde"]);
    expect(dungeonPosts({ results: [run()], duplicates: 0, malformed: 0 }, "en")[0]!.content).toBeUndefined();
    expect(highlightHeadline([], "X", "en")).toBeUndefined();
  });
  it("board lines stay within their budget", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ encounterId: i, boss: `Boss ${i}`, dungeonName: "Deadmines", difficultyId: 1, sec: 61, endedAt: null, players: ["Alda Stone", "Bren", "Cyra", "Dax"] }));
    const lines = bossRecordLines(rows, 300);
    expect(lines.join("\n").length).toBeLessThanOrEqual(300);
    expect(lines[0]).toBe("⚔️ **Boss 0** (Deadmines) · 1:01 · Alda Stone, Bren, Cyra +1");
  });
});

describe("race day tracking", () => {
  const day1 = new Date("2026-11-06T05:00:00Z"), day2 = new Date("2026-11-07T05:00:00Z");
  it("keeps the finished day's gain across the rollover", () => {
    let entry = nextEntry(null, 10, new Date("2026-11-06T12:00:00Z"), day1);
    entry = nextEntry(entry, 14, new Date("2026-11-06T22:00:00Z"), day1);
    expect(dayGain(entry, day1)).toBe(4);
    entry = nextEntry(entry, 15, new Date("2026-11-07T06:00:00Z"), day2);
    expect(entry).toMatchObject({ dayStartLevel: 14, dayStartedAt: day2, lastDayGain: 4, lastDayStartedAt: day1 });
    expect(dayGain(entry, day1)).toBe(4);
    expect(dayGain(entry, day2)).toBe(1);
  });
  it("leaves the day alone without a server day", () => {
    const entry = nextEntry(nextEntry(null, 10, day1, day1), 12, day2);
    expect(entry).toMatchObject({ dayStartLevel: 10, dayStartedAt: day1 });
  });
});

const sample: DailyRecap = {
  day: "2026-11-06",
  race: { gained: 23, top: [{ name: "Alda Stone", className: "Mage", gain: 6, level: 42 }, { name: "Bren", className: "Warrior", gain: 4, level: 38 }], new60: [{ name: "Cyra Vale", className: "Priest" }] },
  dungeons: { clears: 7, dungeons: 4, mostRuns: { name: "Dax", runs: 4 }, highlights: [{ kind: "boss", label: "Mutanus", valueSec: 74, previousSec: 90, dungeonName: "Wailing Caverns" }, { kind: "deathless", dungeonName: "Deadmines" }] },
  pvp: { duels: 9, topDueler: { name: "Eli", wins: 5 }, bgPlayed: 3, bgWon: 2 }
};

describe("daily recap", () => {
  it("recaps the server day that ended", () => {
    expect(recapDay(new Date("2026-11-07T05:30:00Z"), "America/Toronto")).toBe("2026-11-06");
    expect(recapDay(new Date("2026-11-07T03:30:00Z"), "America/Toronto")).toBe("2026-11-05");
  });
  it("builds a card and a readable embed, in French too", async () => {
    const card = dailyRecapCard(sample, "fr", "Les Braves");
    expect(card.recap?.sections.map(section => section.title)).toEqual(["Course au 60 · niveaux", "Donjons · records", "JcJ"]);
    expect(card.stats).toHaveLength(4);
    // 9.3: the day picks one of three approved paintings (dawn, day, night); the same day always picks the same one.
    const keys = new Set(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map(day => dailyRecapCard({ ...sample, day }, "en", "G").backdrop?.key));
    expect([...keys].every(key => ["dawn", "day", "night"].includes(key!))).toBe(true);
    expect(card.backdrop?.kind).toBe("recap");
    expect(dailyRecapCard(sample, "en", "G").backdrop).toEqual(card.backdrop);
    const png = await scoreCardPng(card);
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
    const text = dailyRecapEmbed(sample, "en").data.description!;
    expect(text).toContain("Cyra Vale");
    expect(text).toContain("Fastest Mutanus kill · Wailing Caverns: **1:14** (was 1:30)");
    expect(text).toContain("Most runs: Dax (×4)");
  }, 60_000);
  it("gathers the day from stored data, sections empty when nothing happened", async () => {
    const db = {
      levelRaceEntry: { findMany: vi.fn(async () => [{ name: "Alda", className: "Mage", level: 20, dayStartLevel: 17, dayStartedAt: new Date("2026-11-06T05:00:00Z"), lastDayGain: 0, lastDayStartedAt: null }]) },
      raceHallEntry: { findMany: vi.fn(async () => []) },
      dungeonRun: { findMany: vi.fn(async () => [
        { instanceId: 43, players: [{ memberId: "m1", character: "Alda", member: { displayName: "Alda" } }] },
        { instanceId: 36, players: [{ memberId: "m1", character: "Alda", member: { displayName: "Alda" } }, { memberId: "m2", character: "Bren", member: { displayName: "Bren" } }] }
      ]) },
      dungeonHighlight: { findMany: vi.fn(async () => []) },
      duelResult: { findMany: vi.fn(async () => []) },
      battlegroundReport: { findMany: vi.fn(async () => []) }
    };
    const recap = await dailyRecap(db as never, "g1", "2026-11-06", "America/Toronto");
    expect(recap.race).toEqual({ gained: 3, top: [{ name: "Alda", className: "Mage", level: 20, gain: 3 }], new60: [] });
    expect(recap.dungeons).toMatchObject({ clears: 2, dungeons: 2, mostRuns: { name: "Alda", runs: 2 }, highlights: [] });
    expect(recap.pvp).toBeNull();
    expect(recapIsEmpty({ day: "x", race: null, dungeons: null, pvp: null })).toBe(true);
  });
  it("posts once per day and claims quiet days without posting", async () => {
    const empty = { findMany: vi.fn(async () => []) };
    let lastDay: string | null = null;
    const jobs: string[] = [];
    const tx = {
      guildSettings: { updateMany: vi.fn(async (args: { data: { dailyRecapLastDay: string } }) => { if (lastDay && lastDay >= args.data.dailyRecapLastDay) return { count: 0 }; lastDay = args.data.dailyRecapLastDay; return { count: 1 }; }) },
      discordJob: { upsert: vi.fn(async (args: { create: { key: string } }) => { jobs.push(args.create.key); return { id: "j" }; }), findUnique: vi.fn(async () => null), create: vi.fn(async (args: { data: { key: string } }) => { jobs.push(args.data.key); return { id: "j" }; }) }
    };
    const db = {
      guildSettings: { findMany: vi.fn(async () => [{ guildId: "g1", timezone: "UTC", language: "en", dailyRecapLastDay: lastDay, raceBoardEnabled: true, guild: { name: "Guild" } }]) },
      levelRaceEntry: empty, raceHallEntry: empty, dungeonHighlight: empty, duelResult: { findMany: vi.fn(async () => [{ winnerId: "m1", winnerCharacter: "Alda" }]) }, battlegroundReport: empty,
      dungeonRun: empty,
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    };
    expect(await queueDailyRecaps(db as never, new Date("2026-11-07T01:00:00Z"))).toBe(1);
    expect(lastDay).toBe("2026-11-06");
    db.guildSettings.findMany.mockResolvedValue([{ guildId: "g1", timezone: "UTC", language: "en", dailyRecapLastDay: lastDay, raceBoardEnabled: true, guild: { name: "Guild" } }]);
    expect(await queueDailyRecaps(db as never, new Date("2026-11-07T02:00:00Z"))).toBe(0);
    db.duelResult.findMany.mockResolvedValue([]);
    db.guildSettings.findMany.mockResolvedValue([{ guildId: "g1", timezone: "UTC", language: "en", dailyRecapLastDay: lastDay, raceBoardEnabled: true, guild: { name: "Guild" } }]);
    expect(await queueDailyRecaps(db as never, new Date("2026-11-08T01:00:00Z"))).toBe(0);
    expect(lastDay).toBe("2026-11-07");
    expect(jobs).toHaveLength(1);
  });
});
