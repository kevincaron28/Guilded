import { describe, expect, it } from "vitest";
import { analysisReport, analyzeRuns, findOutliers } from "../src/services/dungeon-analysis.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { bracketedVerdict, calculateDungeonRating, type RatingRun } from "../src/services/dungeon-rating.js";
import { SCORING_V2, season2Proposal } from "../src/services/dungeon-season2.js";
import { rateRun, type ScoreRun } from "../src/services/public-score.js";

// Analysis is read-only; scoring model 2 exists only in rule sets that carry it (Season 2 proposal, inactive until activated).
const rules = provisionalSeasonRules().rules;
const band = rules.levelBands["389"]!; // Ragefire Chasm
const target = rules.targets["389"]!;
let n = 0;
function scoreRun(over: { durationSec: number; levels?: number[]; crew?: number; completedBy?: string }): ScoreRun {
  const levels = over.levels ?? [16, 16, 16, 16, 16];
  const started = new Date("2026-11-05T20:00:00Z");
  return { runId: `r${++n}`, instanceId: 389, routeKey: null, difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec: over.durationSec,
    endedAt: new Date(started.getTime() + over.durationSec * 1000), confirmations: 1,
    evidence: { startedAt: started, completedBy: over.completedBy ?? "final boss", encounters: [] },
    players: levels.map((level, i) => ({ character: `crew${over.crew ?? 0}-p${i}`, realm: "", className: null, role: null, level, minLevel: level, presentSec: over.durationSec })) };
}

describe("run analysis", () => {
  const runs = Array.from({ length: 30 }, (_, i) => scoreRun({ durationSec: 1500 + (i % 5) * 30, crew: i % 6 }));
  it("summarises a route: spread, crews, status and a data-driven target", () => {
    const a = analyzeRuns(runs, rules);
    const route = a.routes.find(r => r.key === "389")!;
    expect(route).toMatchObject({ runs: 30, crews: 6, status: "measured", provisional: true });
    expect(route.time.median).toBe(1560);
    expect(route.suggestedTargetSec).toBe(1560);
    expect(route.medianVsTarget).toBe(Math.round(1560 / target * 100) / 100);
    expect(a.routes.find(r => r.key !== "389")!.status).toBe("none");
  });
  it("is thin below the evidence policy and ignores manual finishes", () => {
    const a = analyzeRuns([...runs.slice(0, 5), scoreRun({ durationSec: 900, completedBy: "manual" })], rules);
    expect(a.clears).toBe(5);
    expect(a.routes.find(r => r.key === "389")).toMatchObject({ status: "thin", suggestedTargetSec: null });
  });
  it("flags impossible and AFK times, not normal jitter", () => {
    const outliers = findOutliers([...runs.map(r => ({ runId: r.runId, durationSec: r.durationSec })), { runId: "fast", durationSec: 300 }, { runId: "afk", durationSec: 9000 }]);
    expect(outliers.map(o => o.runId).sort()).toEqual(["afk", "fast"]);
  });
  it("fits a level effect: groups above the band finish faster, and reports party size", () => {
    const mixed = Array.from({ length: 60 }, (_, i) => {
      const over = i % 4; // 0..3 levels over the band
      return scoreRun({ durationSec: Math.round(1500 * Math.pow(0.95, over)), levels: Array(i % 7 === 0 ? 3 : 5).fill(band.max + over), crew: i % 6 });
    });
    const a = analyzeRuns(mixed, rules);
    expect(a.level.runsFitted).toBe(60);
    expect(a.level.timePerLevel).toBeGreaterThan(0.04);
    expect(a.level.timePerLevel).toBeLessThan(0.06);
    expect(a.party.bySize.find(b => b.label === "1-3 players")!.n).toBeGreaterThan(0);
    expect(analysisReport(a)).toContain("Ragefire Chasm");
  });
});

describe("scoring model 2 (inactive until a season carries it)", () => {
  const v2 = season2Proposal(rules, [], new Date("2026-12-09T23:00:00Z"), "current-v1", SCORING_V2).rules;
  const asRun = (levels: number[], size = levels.length, seconds = 1200): RatingRun => {
    const start = new Date("2026-12-10T20:00:00Z");
    return { instanceId: 389, difficultyId: 0, durationSec: seconds, completedBy: "final boss", startedAt: start, endedAt: new Date(start.getTime() + seconds * 1000), createdAt: start, runRef: "R",
      competitionData: { players: levels.slice(0, size).map((l, i) => ({ name: `P${i}`, level: l, minLevel: l })), encounters: [] },
      players: levels.slice(0, size).map((_, i) => ({ character: `P${i}`, memberId: `m${i}`, member: { displayName: `P${i}` }, presentSec: seconds })) };
  };
  it("is a valid rule set, and Season 1's rules are untouched", () => {
    expect(validBracketedRules(v2)).toBe(true);
    expect(v2.scoring).toEqual(SCORING_V2);
    expect(rules.scoring).toBeUndefined();
    const before = bracketedVerdict(asRun([band.max + 3, band.max]), rules);
    expect(before.penaltyPercent).toBe(30);
    expect(before.targetSec).toBe(target);
  });
  it("prices a level difference into the target instead of a flat percentage", () => {
    const even = bracketedVerdict(asRun([band.max, band.max, band.max]), v2);
    const over = bracketedVerdict(asRun([band.max + 3, band.max, band.max]), v2);
    const under = bracketedVerdict(asRun([band.min - 1, band.max, band.max]), v2);
    expect(even.targetSec).toBe(v2.targets["389"]);
    expect(over.penaltyPercent).toBe(0);
    expect(over.targetSec).toBe(Math.round(v2.targets["389"]! * 0.85));
    expect(under.targetSec).toBe(Math.round(v2.targets["389"]! * 1.05));
    expect(bracketedVerdict(asRun([band.max + 7, band.max, band.max]), v2).reason).toBe("Overlevel carry");
  });
  it("leaves a party under the minimum unranked, for the guild and the public board alike", () => {
    expect(bracketedVerdict(asRun([band.max, band.max], 2), v2).reason).toBe("Party too small");
    expect(calculateDungeonRating([asRun([band.max, band.max], 2)], v2)[0]?.points ?? 0).toBe(0);
    const small = scoreRun({ durationSec: 1200, levels: [band.max, band.max] });
    expect(rateRun(small, v2).reason).toBe("Party too small");
    expect(rateRun(scoreRun({ durationSec: 1200, levels: [band.max, band.max, band.max] }), v2).score).not.toBeNull();
  });
});
