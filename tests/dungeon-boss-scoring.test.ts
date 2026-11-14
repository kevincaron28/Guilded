import { describe, expect, it } from "vitest";
import { BOSS_SCORING_V1, bossAdjusted, bossTally, ON_TARGET_POINTS } from "../src/services/dungeon-boss-scoring.js";
import { createBracketedDungeonRules, validBracketedRules, type BracketedRules } from "../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, frozenRating, timeRating, type RatingRun } from "../src/services/dungeon-rating.js";
import { addedRules, publicRules, rateRun, type ScoreRun } from "../src/services/public-score.js";

// docs/plans/BOSS_SKIP_SCORING_2026-11-14.md: skipping bosses must never be the way to the most points.

const DC = 2970;
const ALL = [3474, 3475, 3476, 3478, 3479, 3511]; // The Drowned City: 3479 (Min'loth) is the final boss.
const kills = (ids: number[]) => ids.map((id, i) => ({ id, name: `Boss ${id}`, success: true, at: 1000 + i * 100, startedAt: 950 + i * 100, source: "native" }));

describe("which bosses a run killed", () => {
  it("counts every listed boss with a successful kill", () => {
    expect(bossTally(DC, kills(ALL))).toEqual({ killed: 6, total: 6 });
    expect(bossTally(DC, kills([3474, 3479, 3511]))).toEqual({ killed: 3, total: 6 });
  });
  it("counts the final boss even when its own event is missing, because the run ended on it", () => {
    expect(bossTally(DC, kills([3474, 3475]))).toEqual({ killed: 3, total: 6 });
  });
  it("ignores wipes, npc events and unknown ids", () => {
    const events = [...kills([3474, 3479]), { id: 3475, success: false }, { id: 3476, kind: "npc", success: true }, { id: 999, success: true }];
    expect(bossTally(DC, events)).toEqual({ killed: 2, total: 6 });
  });
  it("says nothing when the bosses cannot be read: no list for the dungeon, no encounters, or none of its bosses seen", () => {
    expect(bossTally(389, kills(ALL))).toBeNull();
    expect(bossTally(DC, undefined)).toBeNull();
    expect(bossTally(DC, [])).toBeNull();
    expect(bossTally(DC, [{ id: 999, success: true }])).toBeNull();
  });
});

describe("the boss rule on the time points", () => {
  it("leaves a full clear and an unreadable run exactly as they were", () => {
    for (const points of [50, 120, 200, 333, 400]) {
      expect(bossAdjusted(points, { killed: 6, total: 6 })).toBe(points);
      expect(bossAdjusted(points, null)).toBe(points);
    }
  });
  it("never lets a run with skips beat a full clear at the same pace, or a full clear within the target", () => {
    const target = 2400;
    for (let seconds = 600; seconds <= 7200; seconds += 30) {
      const full = timeRating(seconds, target);
      for (let killed = 1; killed < 6; killed++) {
        const skipped = bossAdjusted(timeRating(seconds, target), { killed, total: 6 });
        expect(skipped).toBeLessThanOrEqual(full);
        if (full >= ON_TARGET_POINTS) expect(skipped).toBeLessThan(ON_TARGET_POINTS);
      }
    }
    expect(timeRating(2400, 2400)).toBe(200);
    expect(bossAdjusted(400, { killed: 5, total: 6 })).toBe(167);
  });
  it("more bosses never score less at the same pace", () => {
    for (const seconds of [900, 1800, 2400, 3600, 5000]) {
      let last = 0;
      for (let killed = 1; killed <= 6; killed++) {
        const points = bossAdjusted(timeRating(seconds, 2400), { killed, total: 6 });
        expect(points).toBeGreaterThanOrEqual(last);
        last = points;
      }
    }
  });
});

// A season whose rules carry the rule, with The Drowned City as a rated route (a copy of an existing route's band and bracket).
function seasonWith(bossScoring: boolean): BracketedRules {
  const base = publicRules();
  const model = base.routes.find((route) => route.targetSec !== null && route.completionModel === "addon-final-boss")!;
  const route = { ...model, dungeonKey: String(DC), instanceId: DC, name: "The Drowned City", targetSec: 2400 };
  return createBracketedDungeonRules({ routes: [...base.routes.filter((r) => r.instanceId !== DC), route], brackets: base.brackets, overlevelPenalty: base.overlevelPenalty,
    provisional: base.provisional, leniency: 1, ...(bossScoring ? { bossScoring: BOSS_SCORING_V1 } : {}) });
}
const START = new Date("2026-11-14T02:00:00Z");
function shapes(rules: BracketedRules, durationSec: number, ids: number[]) {
  const band = rules.levelBands[String(DC)]!;
  const level = band.min;
  const endedAt = new Date(START.getTime() + durationSec * 1000);
  const base = Math.floor(START.getTime() / 1000);
  const encounters = ids.map((id, i) => ({ id, name: `Boss ${id}`, success: true, at: base + 100 + i * 60, startedAt: base + 50 + i * 60 }));
  const names = ["Kev", "Amy"];
  const guild: RatingRun = { instanceId: DC, difficultyId: band.difficultyId, durationSec, startedAt: START, endedAt, completedBy: "final boss", dungeonName: "The Drowned City", runRef: "R",
    competitionData: { players: names.map((name) => ({ name, level, minLevel: level })), encounters },
    players: names.map((character) => ({ character, memberId: `m-${character}`, presentSec: durationSec, member: { displayName: character } })) };
  const site: ScoreRun = { runId: "R", instanceId: DC, routeKey: null, difficultyId: band.difficultyId, dungeonName: "The Drowned City", durationSec, endedAt, confirmations: 1,
    evidence: { startedAt: START, completedBy: "final boss", encounters },
    players: names.map((character) => ({ character, realm: "Doomhowl", className: null, role: null, level, minLevel: level, presentSec: durationSec })) };
  return { guild, site };
}
const sitePoints = (rules: BracketedRules, seconds: number, ids: number[]) => {
  const { site } = shapes(rules, seconds, ids);
  return rateRun(site, rules, site.players[0]!).score!.points;
};

describe("a season that carries the rule", () => {
  const on = seasonWith(true);
  const off = seasonWith(false);
  it("keeps the rule through validation and a mid-season rule addition", () => {
    expect(on.bossScoring).toEqual({ version: 1 });
    expect(off.bossScoring).toBeUndefined();
    expect(validBracketedRules(on)).toBe(true);
    expect(addedRules(on, seasonWith(true))).toBeNull();
  });
  it("scores the guild board and the public board the same, and shows the boss share", () => {
    const cases: [number, number[]][] = [[2400, ALL], [1200, [3474, 3479]], [3600, ALL], [2400, [3474, 3475, 3476, 3478, 3479]]];
    for (const [seconds, ids] of cases) {
      const { guild, site } = shapes(on, seconds, ids);
      const row = calculateDungeonRating([guild], on).find((r) => r.name === "Kev")!;
      const verdict = rateRun(site, on, site.players[0]!);
      expect(verdict.score?.points).toBe(row.details![0]!.points);
      expect(verdict.score?.bosses).toEqual(bossTally(DC, kills(ids)));
      expect(row.details![0]!.bossesKilled).toBe(bossTally(DC, kills(ids))!.killed);
    }
  });
  it("table of run shapes: full clear on target, fast skip run, slow full clear", () => {
    expect(sitePoints(on, 2400, ALL)).toBe(200); // full clear on target
    expect(sitePoints(on, 1200, [3474, 3479])).toBe(67); // 2 of 6 bosses in half the time: capped at 200, a third of it
    expect(sitePoints(on, 1200, [3474, 3475, 3476, 3478, 3479])).toBe(167); // one boss skipped, very fast
    expect(sitePoints(on, 3600, ALL)).toBe(133); // slow full clear is not cut
    expect(sitePoints(on, 3600, ALL)).toBeGreaterThan(sitePoints(on, 1200, [3474, 3479]));
  });
  it("a season without the rule scores skips as before (Season 1 is untouched)", () => {
    const { guild, site } = shapes(off, 1200, [3474, 3479]);
    expect(calculateDungeonRating([guild], off).find((r) => r.name === "Kev")!.details![0]).not.toHaveProperty("bossesKilled");
    expect(rateRun(site, off, site.players[0]!).score).toMatchObject({ points: 400 });
    expect(rateRun(site, off, site.players[0]!).score).not.toHaveProperty("bosses");
  });
  it("when the bosses cannot be read, the run is scored as before and shows no boss share", () => {
    const { guild, site } = shapes(on, 1200, []);
    expect(rateRun(site, on, site.players[0]!).score).toMatchObject({ points: 400 });
    expect(calculateDungeonRating([guild], on).find((r) => r.name === "Kev")!.details![0]).not.toHaveProperty("bossesKilled");
  });
  it("frozen rows with the boss fields still validate and a tampered one does not", () => {
    const { guild } = shapes(on, 1200, [3474, 3479]);
    const rows = calculateDungeonRating([guild], on);
    expect(frozenRating(JSON.parse(JSON.stringify(rows)))).not.toBeNull();
    const forged = JSON.parse(JSON.stringify(rows));
    forged[0].details[0].bossesKilled = 6;
    forged[0].details[0].bossesTotal = 6;
    expect(frozenRating(forged)).toBeNull();
  });
});
