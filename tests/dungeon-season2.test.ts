import { describe, expect, it } from "vitest";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { observeSeason } from "../src/services/dungeon-season-observations.js";
import { proposeTarget, season2Proposal, TARGET_POLICY } from "../src/services/dungeon-season2.js";
import { publicRules, readRuleSnapshot, snapshotRules, type ScoreRun } from "../src/services/public-score.js";

// Observation only: Season 1 keeps its frozen rules; Season 2 is a proposal computed from what it saw.
const FROM = new Date("2026-11-04T23:00:00Z");
const rules = { ...publicRules(), evidencePolicy: "current-v1" as const };
const RAGEFIRE = 389; // Ragefire Chasm, levels 15-18, Season 1 target 20 minutes

let counter = 0;
function run(over: { crew: number; day: number; durationSec: number; completedBy?: string; levels?: number; instanceId?: number; startTrigger?: string }): ScoreRun {
  const started = new Date(FROM.getTime() + over.day * 86_400_000 + 3_600_000);
  const level = over.levels ?? 16;
  return { runId: `run-${++counter}`, instanceId: over.instanceId ?? RAGEFIRE, routeKey: null, difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec: over.durationSec,
    endedAt: new Date(started.getTime() + over.durationSec * 1000), confirmations: 1,
    evidence: { startedAt: started, completedBy: over.completedBy ?? "final boss", encounters: [],
      ...(over.startTrigger ? { integrity: { version: 2, startWitness: "unknown", startTrigger: over.startTrigger, continuous: true } } : {}) },
    players: Array.from({ length: 5 }, (_, i) => ({ character: `crew${over.crew}-p${i}`, realm: "", className: null, role: null, level, minLevel: level, presentSec: over.durationSec })) };
}
const ragefire = (runs: ScoreRun[]) => observeSeason(runs, rules, FROM, null).routes.find(r => r.key === "389")!;

describe("Season 1 observations", () => {
  it("summarises ranked, unpenalised runs per route: count, median, quartiles", () => {
    const runs = [1500, 1200, 1800, 1400, 1600].map((durationSec, i) => run({ crew: i, day: i, durationSec }));
    expect(ragefire(runs)).toMatchObject({ count: 5, median: 1500, p25: 1400, p75: 1600, targetSec: 1200, bracket: "15-29" });
  });
  it("does not count manual completions, over-level groups or other maps, and reports unrated maps", () => {
    const runs = [run({ crew: 1, day: 1, durationSec: 1500 }), run({ crew: 2, day: 1, durationSec: 900, completedBy: "manual" }),
      run({ crew: 3, day: 1, durationSec: 900, levels: 19 }), run({ crew: 4, day: 1, durationSec: 2000, instanceId: 99999 })];
    const result = observeSeason(runs, rules, FROM, null);
    expect(result.routes.find(r => r.key === "389")).toMatchObject({ count: 1, median: 1500 });
    expect(result.penalisedRuns).toBe(1);
    expect(result.unrated).toEqual([{ instanceId: 99999, name: "Ragefire Chasm", count: 1, median: 2000, levels: [16, 16] }]);
  });
  it("counts one independent sample per crew and day, so farming adds no weight", () => {
    const farmed = Array.from({ length: 30 }, (_, i) => run({ crew: 1, day: 0, durationSec: 900 + i }));
    expect(ragefire(farmed)).toMatchObject({ count: 30, samples: 1, crews: 1, ready: false });
    const spread = Array.from({ length: 25 }, (_, i) => run({ crew: i % 6, day: Math.floor(i / 6), durationSec: 1500 }));
    expect(ragefire(spread)).toMatchObject({ ready: true, crews: 6, days: 5, independentMedian: 1500 });
  });
  it("leaves manual-start runs out of the independent sample and counts runs without start provenance", () => {
    const result = ragefire([run({ crew: 1, day: 1, durationSec: 1500, startTrigger: "manual" }), run({ crew: 2, day: 1, durationSec: 1500 })]);
    expect(result).toMatchObject({ count: 2, otherStart: 1, unverifiedStart: 1, samples: 1 });
  });
  it("ignores runs outside the season window", () => {
    expect(ragefire([run({ crew: 1, day: -3, durationSec: 1500 })])).toMatchObject({ count: 0, median: null });
  });
});

describe("Season 2 target formula", () => {
  const sample = (samples: number, independentMedian: number | null, ready = false) => ({ samples, independentMedian, ready });
  it("keeps the Season 1 estimate below 8 independent samples", () => {
    expect(proposeTarget(1200, sample(7, 2400))).toMatchObject({ targetSec: 1200, basis: "carried" });
    expect(proposeTarget(1200, undefined)).toMatchObject({ targetSec: 1200, basis: "carried" });
  });
  it("blends 8-19 samples with the estimate (12 samples' weight) and rounds to a minute", () => {
    // (10 * 1800 + 12 * 1200) / 22 = 1472.7 -> 1500
    expect(proposeTarget(1200, sample(10, 1800))).toMatchObject({ targetSec: 1500, basis: "blended" });
  });
  it("uses the crew/day median once the review policy is met", () => {
    expect(proposeTarget(1200, sample(24, 1700, true))).toMatchObject({ targetSec: 1680, basis: "measured" });
  });
  it("never moves further than half or double, or outside 5 minutes to 2 hours", () => {
    expect(proposeTarget(1200, sample(40, 9000, true)).targetSec).toBe(1200 * TARGET_POLICY.ceiling);
    expect(proposeTarget(1200, sample(40, 100, true)).targetSec).toBe(1200 * TARGET_POLICY.floor);
    expect(proposeTarget(400, sample(40, 100, true)).targetSec).toBe(300);
  });
});

describe("Season 2 proposal", () => {
  const start = new Date("2026-12-09T23:00:00Z");
  const spread = Array.from({ length: 25 }, (_, i) => run({ crew: i % 6, day: Math.floor(i / 6), durationSec: 1500 }));

  it("is a valid current-v2 rule set with measured targets and Season 1 levels, brackets and penalty", () => {
    const { rules: s2, rows, counts } = season2Proposal(rules, observeSeason(spread, rules, FROM, null).routes, start);
    expect(validBracketedRules(s2)).toBe(true);
    expect(s2.evidencePolicy).toBe("current-v2");
    expect(s2.targets["389"]).toBe(1500);
    expect(counts.measured).toBe(1);
    expect(counts.carried).toBe(rows.length - 1);
    expect(s2.brackets).toEqual(rules.brackets);
    expect(s2.levelBands).toEqual(rules.levelBands);
    expect(s2.overlevelPenalty).toEqual(rules.overlevelPenalty);
    expect(s2.catalog.find(d => d.dungeonKey === "389")).toMatchObject({ targetSec: 1500, provisional: false });
    expect(s2.catalog.find(d => d.dungeonKey === "36")).toMatchObject({ provisional: true });
  });
  it("leaves Season 1's frozen rules untouched", () => {
    const before = JSON.stringify(rules);
    season2Proposal(rules, observeSeason(spread, rules, FROM, null).routes, start);
    expect(JSON.stringify(rules)).toBe(before);
    expect(rules.targets["389"]).toBe(1200);
  });
  it("keeps current-v2 when frozen for the official calendar; everything else still freezes as current-v1", () => {
    const s2 = season2Proposal(rules, [], start).rules;
    expect(snapshotRules(s2, start).rules.evidencePolicy).toBe("current-v2");
    expect(readRuleSnapshot(snapshotRules(s2, start))).not.toBeNull();
    expect(snapshotRules(publicRules(), start).rules.evidencePolicy).toBe("current-v1");
  });
});
