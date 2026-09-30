import { describe, expect, it, vi } from "vitest";
import { recordLine, runLine } from "../src/commands/dungeon.js";
import { difficultyName, formatLeaderboard, pointsFilter } from "../src/services/dungeon-stats.js";

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
