import { describe, expect, it } from "vitest";
import { characterScores, publicRouteKey, publicRules, publicSeasons, publicWeek, scoreRun, type ScoreRun } from "../src/services/public-score.js";
import { summarize } from "../src/services/public-runs.js";

const run = (id: string, durationSec: number, levels: number[], over: Partial<ScoreRun> = {}): ScoreRun => ({
  runId: id, instanceId: 389, routeKey: null, difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec, endedAt: new Date("2026-11-10T20:00:00Z"), confirmations: 1,
  players: levels.map((level, i) => ({ character: `P${i}`, realm: "Doomhowl", className: "Mage", role: "DPS", level })), ...over
});

describe("public dungeon score", () => {
  it("rates a route with the provisional target and the over-level penalty", () => {
    expect(publicRules().targets["389"]).toBe(1200);
    expect(scoreRun(run("a", 1200, [16, 17]))).toEqual({ key: "389", bracket: "15-29", points: 200, penaltyPercent: 0 });
    // Two levels above the 15-18 band: -20%.
    expect(scoreRun(run("b", 1200, [16, 20]))?.points).toBe(160);
    expect(scoreRun(run("c", 1200, [16, 22]))).toBeNull();
    expect(scoreRun(run("d", 1200, [14, 16]))).toBeNull();
    expect(scoreRun(run("e", 1200, [16, null as unknown as number]))).toBeNull();
    expect(scoreRun(run("f", 1200, [16], { difficultyId: 1 }))).toBeNull();
    // Scarlet Monastery needs its wing.
    expect(scoreRun(run("g", 1200, [30], { instanceId: 189 }))).toBeNull();
  });

  it("finds the Scarlet Monastery wing from the boss kills, and stores it on public runs", () => {
    expect(publicRouteKey(189, [{ name: "Herod", success: true }])).toBe("189:armory");
    expect(publicRouteKey(189, [{ name: "Herod", success: false }])).toBeNull();
    expect(publicRouteKey(389, [])).toBe("389");
    const summary = summarize({ id: "x", protocolVersion: 2, state: "COMPLETED", instanceId: 189, name: "Scarlet Monastery", difficultyId: 0, startedAt: 1_793_000_000, endedAt: 1_793_001_500,
      reporters: 1, encounters: [{ id: 1, name: "Arcanist Doan", success: true, at: 1_793_001_400 }], players: [{ character: "Kev", realm: "Doomhowl", level: 35, presentSec: 1500, inGuild: false }] } as never);
    expect(summary.routeKey).toBe("189:library");
  });

  it("sums each character's best route per bracket, best N only", () => {
    const rows = characterScores([run("a", 1500, [16]), run("b", 1200, [16]), run("c", 1000, [16], { instanceId: 9999 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bracket: "15-29", points: 200 });
    expect(rows[0]!.routes.map(r => [r.key, r.points, r.counted])).toEqual([["389", 200, true]]);
  });

  it("uses the seeded owner calendar by default: Beta before 4 November, then an open Season 1", () => {
    expect(publicSeasons(new Date("2026-10-20T00:00:00Z")).map(p => p.id)).toEqual(["beta"]);
    const december = publicSeasons(new Date("2026-12-15T00:00:00Z"));
    expect(december.map(p => p.id)).toEqual(["s1", "beta"]);
    expect(december[0]!.labelFr).toBe("Saison 1");
    expect(december[0]!.to).toBeNull();
    expect(publicWeek(new Date("2026-11-12T00:00:00Z")).from!.toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });
});
