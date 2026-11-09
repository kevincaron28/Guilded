import { describe, expect, it } from "vitest";
import { dungeonPosts } from "../src/services/dungeon-announce.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { leniencyOf, validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { bracketedVerdict, calculateDungeonRating, type RatingRun } from "../src/services/dungeon-rating.js";
import { addedRules } from "../src/services/public-score.js";

// 9.0.1: Season 1 hides fewer runs. The anti-cheat that matters stays: final boss, season window, SIM, evidence policy.
const lenient = provisionalSeasonRules().rules;
const strict = (() => { const { leniency: _l, ...rest } = lenient as typeof lenient & { leniency?: number }; void _l; return rest as typeof lenient; })();
const start = new Date("2026-11-10T20:00:00Z");
const band = lenient.levelBands["389"]!;
function run(level: number, presentSec: number, over: Partial<RatingRun> = {}): RatingRun {
  return { instanceId: 389, difficultyId: band.difficultyId, durationSec: 1200, completedBy: "final boss", startedAt: start,
    endedAt: new Date(start.getTime() + 1_200_000), createdAt: start, runRef: "R", dungeonName: "Ragefire Chasm",
    competitionData: { players: [{ name: "Kev Caron", level, minLevel: level }], encounters: [] },
    players: [{ character: "Kev Caron", memberId: "m", member: { displayName: "Kev" }, presentSec }], ...over };
}

describe("Season 1 leniency", () => {
  it("is part of the default Season 1 rules and a valid rule set", () => {
    expect(lenient.leniency).toBe(1);
    expect(validBracketedRules(lenient)).toBe(true);
    expect(leniencyOf(lenient)).toMatchObject({ on: true, presence: 0.5, overLevels: 6, belowLevels: 3 });
    expect(leniencyOf(strict).on).toBe(false);
  });
  it("counts a player present for half the run, and overlevel / slightly underlevel parties", () => {
    expect(calculateDungeonRating([run(band.min, 700)], lenient)[0]?.points).toBeGreaterThan(0);
    expect(calculateDungeonRating([run(band.min, 700)], strict)).toHaveLength(0);
    expect(bracketedVerdict(run(band.max + 5, 1200), lenient).reason).toBeUndefined();
    expect(bracketedVerdict(run(band.max + 5, 1200), strict).reason).toBe("Overlevel carry");
    expect(bracketedVerdict(run(band.min - 2, 1200), lenient).reason).toBeUndefined();
    expect(bracketedVerdict(run(band.min - 2, 1200), strict).reason).toBe("Below level range");
  });
  it("keeps the anti-cheat: manual finishes, far-out levels and under 50% presence stay unranked", () => {
    expect(bracketedVerdict(run(band.min, 1200, { completedBy: "manual" }), lenient).reason).toBeTruthy();
    expect(bracketedVerdict(run(band.max + 12, 1200), lenient).reason).toBe("Overlevel carry");
    expect(calculateDungeonRating([run(band.min, 400)], lenient)).toHaveLength(0);
  });
  it("reaches a running Season 1 through addedRules without changing targets or brackets", () => {
    const added = addedRules(strict, lenient);
    expect(added?.rules.leniency).toBe(1);
    expect(added?.rules.targets).toEqual(strict.targets);
    expect(added?.rules.brackets).toEqual(strict.brackets);
    expect(addedRules(lenient, lenient)).toBeNull();
  });
});

describe("quieter run post", () => {
  it("shows one unranked line, not one per member", () => {
    const player = (character: string) => ({ character, points: 0, deaths: 0, unrankedReason: "Target not calibrated", participationMode: "none" });
    const summary = { results: [{ valid: true, state: "COMPLETED", durationSec: 1200, runRef: "QG-1", dungeonName: "Ragefire Chasm", difficultyId: 0, players: ["A B", "C D", "E F"], unlinked: [], inGuildPlayers: ["A B", "C D", "E F"],
      playerDetails: [player("A B"), player("C D"), player("E F")], personalRecords: [], achievements: [], mentions: {}, points: 0 }] } as never;
    const text = dungeonPosts(summary, "en")[0]?.embed.data.description ?? "";
    expect(text.match(/Unranked/g)).toHaveLength(1);
    expect(text).toContain("Unranked ×3: Target not calibrated");
    expect(text).not.toContain("0 pts");
  });
});

describe("boards show full character names", () => {
  it("lists the whole guild party of a best run by full name", async () => {
    const { seasonBestRuns } = await import("../src/services/dungeon-best-runs.js");
    const database = {
      dungeonRun: { groupBy: async () => [{ instanceId: 389, difficultyId: 0, _min: { durationSec: 1621 } }],
        findFirst: async () => ({ instanceId: 389, dungeonName: "Ragefire Chasm", difficultyId: 0, durationSec: 1621, endedAt: null, players: [{ character: "El" }, { character: "Crashing" }, { character: "Chad" }] }) },
      character: { findMany: async () => [{ name: "El", displayName: "El Pirata" }, { name: "Crashing Pally", displayName: null }] },
      unclaimedCharacter: { findMany: async () => [{ name: "Chad Ho", displayName: null }] },
      guildRosterEntry: { findMany: async () => [] }
    };
    const rows = await seasonBestRuns(database as never, "g1", "s1");
    expect(rows[0]!.players).toEqual(["El Pirata", "Crashing Pally", "Chad Ho"]);
  });
  it("shows participation points by character, with the Discord name in parentheses", async () => {
    const { leaderboard } = await import("../src/services/dungeon-stats.js");
    const database = {
      dungeonSeason: { findFirst: async () => ({ id: "s1" }), findMany: async () => [{ id: "s1" }] },
      dungeonPointTransaction: { groupBy: async () => [{ memberId: "m1", _sum: { amount: 75 } }, { memberId: "m2", _sum: { amount: 25 } }] },
      member: { findMany: async () => [{ id: "m1", displayName: "Simon" }, { id: "m2", displayName: "El Pirata Qc" }] },
      character: { findMany: async () => [{ memberId: "m1", name: "Kev Caron", displayName: null }, { memberId: "m2", name: "El", displayName: "El Pirata" }] }
    };
    const rows = await leaderboard(database as never, "g1", "all", null);
    expect(rows.map(r => r.name)).toEqual(["Kev Caron (Simon)", "El Pirata (El Pirata Qc)"]);
  });
});
