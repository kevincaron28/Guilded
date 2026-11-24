import { describe, expect, it } from "vitest";
import { parseDuelRecord, parseStanding, runTime } from "./characterData";

describe("my character numbers", () => {
  it("reads the player part of boards.json and duels.json, and nothing from an older server", () => {
    const standing = parseStanding({ season: "Season 1", player: { brackets: [{ key: "15-29", name: "Levels 15-29", rank: 4, points: 845, of: 120 }, { key: "x", rank: 0 }],
      runs: [{ dungeon: "Maraudon", bracket: "Levels 45-59", points: 400, durationSec: 1385, endedAt: "2026-11-23T20:00:00Z" }] } });
    expect(standing?.brackets).toEqual([{ key: "15-29", name: "Levels 15-29", rank: 4, points: 845, of: 120 }]);
    expect(standing?.runs[0]?.points).toBe(400);
    expect(parseStanding({ season: "Season 1", brackets: [] })).toBeNull();
    expect(parseDuelRecord({ player: { rank: 2, rating: 1002, wins: 1, losses: 0, streak: 1, bestStreak: 1, ranked: true } })).toMatchObject({ rank: 2, rating: 1002, wins: 1 });
    expect(parseDuelRecord({ players: [] })).toBeNull();
    expect(runTime(1385)).toBe("23:05");
  });
});
