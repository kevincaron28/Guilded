import { describe, expect, it } from "vitest";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { SEASON2_ENDGAME_ROUTES } from "../src/services/dungeon-endgame-routes.js";
import { publicRules, scoreRun, snapshotRules, readRuleSnapshot, type ScoreRun } from "../src/services/public-score.js";
import { season2Proposal } from "../src/services/dungeon-season2.js";
import { allDungeonsAddition } from "../src/services/season-all-dungeons.js";

// Season 1 as stored: the frozen public rules (current-v1), written before the endgame routes existed.
const season1 = snapshotRules(publicRules(), new Date("2026-11-04T23:00:00Z")).rules;
const START = new Date("2026-11-17T19:00:00Z");
// A run with the evidence Season 1 (current-v1) asks for: automatic final-boss completion, the last boss killed inside the run.
const run = (id: string, instanceId: number, routeKey: string | null, durationSec: number, level: number, name: string, boss?: string): ScoreRun => ({
  runId: id, instanceId, routeKey, difficultyId: 0, dungeonName: name, durationSec, endedAt: new Date(START.getTime() + durationSec * 1000), confirmations: 1,
  evidence: { startedAt: START, completedBy: "final boss", encounters: boss ? [{ name: boss, success: true, at: Math.floor(START.getTime() / 1000) + durationSec - 30 }] : [] },
  players: [0, 1].map((i) => ({ character: `P${i}`, realm: "Doomhowl", className: "Mage", role: "DPS", level, minLevel: level, presentSec: durationSec }))
});

describe("Season 1 gains every dungeon route (owner, 17 November 2026)", () => {
  const added = allDungeonsAddition(season1)!;

  it("adds exactly the Season 2 endgame routes, valid, still current-v1", () => {
    expect(added.routes.sort()).toEqual(SEASON2_ENDGAME_ROUTES.map((r) => r.key).sort());
    expect(validBracketedRules(added.rules)).toBe(true);
    expect(added.rules.evidencePolicy).toBe("current-v1");
    expect(added.brackets).toEqual(["45-59", "60"]);
    expect(readRuleSnapshot({ format: 1, frozenAt: "2026-11-04T23:00:00Z", additions: [], rules: added.rules })).not.toBeNull();
  });

  it("leaves every existing route, target, band, bracket, best-N and the penalty unchanged", () => {
    for (const [key, sec] of Object.entries(season1.targets)) expect(added.rules.targets[key]).toBe(sec);
    for (const [key, band] of Object.entries(season1.levelBands)) expect(added.rules.levelBands[key]).toEqual(band);
    for (const b of season1.brackets) expect(added.rules.brackets.find((x) => x.key === b.key)).toEqual(b);
    expect(added.rules.overlevelPenalty).toEqual(season1.overlevelPenalty);
    expect(added.rules.leniency).toBe(season1.leniency);
    expect(added.rules.routes.slice(0, season1.routes.length)).toEqual(season1.routes);
  });

  it("takes the Season 2 provisional targets for the new routes", () => {
    for (const r of SEASON2_ENDGAME_ROUTES) {
      expect(added.rules.targets[r.key]).toBe(r.minutes * 60);
      expect(added.rules.routeBracket[r.key]).toBe(r.bracket);
    }
  });

  it("ranks a Drowned City run and a Zul'Farrak run that Season 1 could not rank before", () => {
    const drowned = run("d", 2970, "2970", 35 * 60, 38, "The Drowned City");
    const zul = run("z", 209, "209", 40 * 60, 50, "Zul'Farrak");
    expect(scoreRun(drowned, season1)).toBeNull();
    expect(scoreRun(zul, season1)).toBeNull();
    expect(scoreRun(drowned, added.rules)).toEqual({ key: "2970", bracket: "30-44", points: 200, penaltyPercent: 0 });
    expect(scoreRun(zul, added.rules)).toEqual({ key: "209", bracket: "45-59", points: 200, penaltyPercent: 0 });
  });

  it("ranks wing routes by their stored route key", () => {
    expect(scoreRun(run("w", 229, "229:lower", 70 * 60, 60, "Lower Blackrock Spire", "Overlord Wyrmthalak"), added.rules)).toMatchObject({ key: "229:lower", bracket: "60", points: 200 });
    // No stored key: the wing comes from the last boss named in the run's evidence; without a boss kill it stays unranked.
    expect(scoreRun(run("w2", 429, null, 30 * 60, 60, "Dire Maul", "Prince Tortheldrin"), added.rules)).toMatchObject({ key: "429:west", bracket: "60" });
    expect(scoreRun(run("w3", 429, null, 30 * 60, 60, "Dire Maul"), added.rules)).toBeNull();
  });

  it("scores the original routes identically before and after", () => {
    const old = run("o", 389, "389", 1200, 16, "Ragefire Chasm", "Bazzalan");
    expect(scoreRun(old, added.rules)).toEqual(scoreRun(old, season1));
  });

  it("is idempotent, and leaves a current-v2 season alone", () => {
    expect(allDungeonsAddition(added.rules)).toBeNull();
    expect(allDungeonsAddition({ ...season1, evidencePolicy: "current-v2" })).toBeNull();
  });

  it("keeps Season 2's proposal working on top of the extended Season 1 rules", () => {
    const start = new Date("2026-12-09T23:00:00Z");
    const fresh = season2Proposal(season1, [], start).rules;
    const onTop = season2Proposal(added.rules, [], start).rules;
    expect(onTop.evidencePolicy).toBe("current-v2");
    expect(onTop.targets).toEqual(fresh.targets);
    expect(onTop.brackets).toEqual(fresh.brackets);
  });
});
