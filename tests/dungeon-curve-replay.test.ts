import { describe, expect, it } from "vitest";
import { curvePoints, replayCurves } from "../src/services/dungeon-curve-replay.js";
import { publicRules, type ScoreRun } from "../src/services/public-score.js";
describe("offline curve replay", () => {
  it("reproduces the existing curve and exposes alternatives without changing rules", () => {
    expect([2400, 1800, 1500, 1200, 900, 720].map(sec => curvePoints("current", sec, 1800))).toEqual([150, 200, 240, 300, 400, 400]);
    expect(curvePoints("damped-ratio", 900, 1800)).toBe(283);
    expect(curvePoints("bounded-linear", 900, 1800)).toBe(300);
    const rules = publicRules(), before = JSON.stringify(rules);
    const run: ScoreRun = { runId: "x", instanceId: 389, routeKey: "389", difficultyId: 0, dungeonName: "RFC", durationSec: 600,
      endedAt: new Date("2026-10-22T12:10:00Z"), confirmations: 1, evidence: { startedAt: new Date("2026-10-22T12:00:00Z"), completedBy: "final boss", encounters: [] },
      players: [{ character: "Anonymous", realm: "Test", role: "TANK", className: null, level: 16, minLevel: 16, presentSec: 600 }] };
    const result = replayCurves([run, run, { ...run, runId: "old", evidence: null }, { ...run, runId: "manual", evidence: { ...run.evidence!, completedBy: "manual" } }], rules);
    expect(result).toMatchObject({ eligibleRuns: 1, excludedRuns: 3, duplicateRuns: 1, curves: [{ cappedRuns: 1 }, { cappedRuns: 0 }, { cappedRuns: 0 }] });
    expect(result.levelGroups.find(g => g.route === "389")?.groups[0]).toMatchObject({ runs: 1, medianTimeToTarget: 0.5, medianCurrentPoints: 400 });
    expect(() => replayCurves([run, { ...run, evidence: null }], rules)).toThrow(/Conflicting observations/);
    expect(result.curves[0]!.brackets[0]).toMatchObject({ characters: 1, rankChanges: 0, routes: [{ key: "389", counted: 1 }] });
    expect(JSON.stringify(result)).not.toContain("Anonymous");
    expect(JSON.stringify(rules)).toBe(before);
  });
});
