import { describe, expect, it, vi } from "vitest";
import { recordLine, runLine } from "../src/commands/dungeon.js";
import { difficultyName, formatLeaderboard, playerSummary, pointsFilter, records } from "../src/services/dungeon-stats.js";
import { createDungeonRatingRules } from "../src/services/dungeon-rating.js";

it("uses eligible wing records for guild and personal views, filtering before taking the top times", async () => {
  const band = { min: 15, max: 25, difficultyId: 1 };
  const ratingRules = createDungeonRatingRules({ "189:graveyard": 1800, "189:library": 1800 }, 3,
    { "189:graveyard": band, "189:library": band });
  const row = (boss: string, durationSec: number, level = 20, presentSec = durationSec) => ({ instanceId: 189, dungeonName: "Scarlet Monastery",
    difficultyId: 1, durationSec, endedAt: new Date(), completedBy: "final boss", competitionData: {
      players: [{ name: "Kev", level, minLevel: level }], encounters: [{ id: 1, name: boss, success: true }] },
    players: [{ character: "Kev", memberId: "m", presentSec, deaths: 0 }] });
  const rows = [row("Bloodmage Thalnos", 300, 30), row("Bloodmage Thalnos", 400, 20, 100),
    row("Bloodmage Thalnos", 900), row("Arcanist Doan", 1000)];
  const findMany = vi.fn(async () => rows);
  const db = { dungeonSeason: { findFirst: async () => ({ id: "s", ratingRules }) }, dungeonRun: { findMany },
    dungeonPointTransaction: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    dungeonAchievement: { findMany: async () => [] } };
  expect((await records(db as never, "g", null)).map(r => r.dungeonName)).toEqual(["Scarlet Monastery: graveyard", "Scarlet Monastery: library"]);
  expect((await records(db as never, "g", 189, 1)).map(r => r.durationSec)).toEqual([900]);
  const personal = await playerSummary(db as never, "g", "m");
  expect(personal.bests.map(r => r.durationSec)).toEqual([900, 1000]);
});

describe("dungeon views", () => {
  it("formats the leaderboard with medals", () => {
    const text = formatLeaderboard([
      { memberId: "a", name: "Kev", points: 300 }, { memberId: "b", name: "Bob", points: 200 },
      { memberId: "c", name: "Amy", points: 100 }, { memberId: "d", name: "Zed", points: 50 }
    ]);
    expect(text.split("\n")).toEqual(["🥇 **Kev** — 300", "🥈 **Bob** — 200", "🥉 **Amy** — 100", "4. **Zed** — 50"]);
  });

  it("names difficulties and leaves unknown ones readable", () => {
    expect(difficultyName(2)).toBe("Heroic");
    expect(difficultyName(0)).toBe("");
    expect(difficultyName(99)).toBe("difficulty 99");
  });

  it("shows a record with its time and group", () => {
    expect(recordLine({ instanceId: 36, dungeonName: "Deadmines", difficultyId: 1, durationSec: 1305, endedAt: null, players: ["Kev", "Bob"] }, 0))
      .toBe("1. **Deadmines (Normal)** — 21:45 — Kev, Bob");
  });

  it("shows deaths only when tracked, and why a run did not count", () => {
    const base = { id: "x", runRef: "r", dungeonName: "Deadmines", difficultyId: 0, endedAt: null };
    const tracked = runLine({ ...base, state: "COMPLETED", valid: true, invalidReason: null, durationSec: 1500,
      players: [{ character: "Kev", deaths: 1 }, { character: "Pug", deaths: null }] }, "en");
    expect(tracked).toContain("completed 25:00 · 1 death(s)");
    const rejected = runLine({ ...base, state: "COMPLETED", valid: false, invalidReason: "too short (30s)", durationSec: 30,
      players: [{ character: "Kev", deaths: null }] }, "fr");
    expect(rejected).toContain("non compté (too short (30s))");
    expect(rejected).not.toContain("mort");
  });
});

it("selects archived season points without mixing the current season and rejects another guild's season", async () => {
  const findFirst = vi.fn(async () => ({ id: "past" }));
  const db = { dungeonSeason: { findFirst } };
  expect(await pointsFilter(db as never, "g", "season", new Date(), "past")).toEqual({ guildId: "g", seasonId: "past" });
  expect(findFirst).toHaveBeenCalledWith({ where: { guildId: "g", id: "past" } });
  await expect(pointsFilter({ dungeonSeason: { findFirst: async () => null } } as never, "g", "season", new Date(), "foreign")).rejects.toThrow("does not belong");
});
