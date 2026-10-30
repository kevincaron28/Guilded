import { describe, expect, it } from "vitest";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { editionDungeonRules } from "../src/services/dungeon-edition-catalog.js";
import { reviewedTimingRules, type TimingReview } from "../src/services/dungeon-timing-policy.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { readRuleSnapshot, snapshotRules, scoreRun, type ScoreRun } from "../src/services/public-score.js";
import { launchTimingRules, LAUNCH_TIMING_REVIEW } from "../src/services/dungeon-launch-timings.js";

describe("prospective timing reviews", () => {
  it("versions the launch adjustments without importing them into other editions or historical defaults", () => {
    const old = provisionalSeasonRules().rules;
    const result = launchTimingRules("forever");
    expect(result.changedRoutes.sort()).toEqual(["2959", "36", "48"]);
    expect(result.rules.targets).toEqual({ ...old.targets, "36": 1800, "48": 2100, "2959": 2400 });
    expect(result.rules.provisional?.plan).toBe(LAUNCH_TIMING_REVIEW);
    expect(result.rules.catalog.find(r => r.dungeonKey === "36")?.targetSec).toBe(1800);
    expect(provisionalSeasonRules().rules).toEqual(old);
    const run: ScoreRun = { runId: "historical", instanceId: 36, routeKey: null, difficultyId: 0,
      dungeonName: "Deadmines", durationSec: 2400, endedAt: new Date("2026-10-01T20:00:00Z"), confirmations: 1,
      players: [{ character: "Fixture", realm: "Fixture", className: "Mage", role: "DPS", level: 20 }] };
    const archived = readRuleSnapshot(snapshotRules(old, new Date("2026-10-01T00:00:00Z")))!;
    expect(scoreRun(run, archived.rules)?.points).toBe(200);
    expect(scoreRun(run, result.rules)?.points).toBe(150);
    expect(scoreRun(run, archived.rules)?.points).toBe(200);
    for (const edition of ["classic-era", "classic-tbc", "classic-mists", "retail"] as const) {
      const reviewed = launchTimingRules(edition);
      expect(reviewed.rules.targets).toEqual(editionDungeonRules(edition).targets);
      expect(reviewed.rules.routes.every(r => r.timing?.basis === "legacy-design-unverified")).toBe(true);
      expect(reviewed.rules.keystoneRating).toEqual(editionDungeonRules(edition).keystoneRating);
      expect(validBracketedRules(reviewed.rules)).toBe(true);
    }
  });
  const base = provisionalSeasonRules().rules;
  const route = base.routes.find(r => r.dungeonKey === "36")!;
  const review: TimingReview = { id: "timing-fixture-v1", edition: "forever", reviewedAt: "2026-10-30T11:10:42.000Z", routes: [{
    key: route.dungeonKey, difficultyId: route.competitionBand!.difficultyId,
    minLevel: route.competitionBand!.min, maxLevel: route.competitionBand!.max,
    previousTargetSec: route.targetSec!, targetSec: 1800, basis: "guide-estimate", clock: "Guide full run; first-combat timing remains provisional",
    note: "Synthetic policy fixture, not a published research claim", sources: ["https://example.com/guide"], rangeSec: { min: 1200, max: 1800 }
  }] };
  it("creates a deterministic, readable snapshot without changing the frozen baseline", () => {
    const original = JSON.stringify(base);
    const oldSnapshot = snapshotRules(base, new Date("2026-10-01T00:00:00Z"));
    const result = reviewedTimingRules(base, review);
    expect(result.rules.targets["36"]).toBe(1800);
    expect(result.rules.routes.find(r => r.dungeonKey === "36")!.timing?.basis).toBe("guide-estimate");
    expect(result.unverifiedRoutes.length).toBe(base.routes.length - 1);
    expect(validBracketedRules(result.rules)).toBe(true);
    expect(readRuleSnapshot(snapshotRules(result.rules, new Date(review.reviewedAt)))).not.toBeNull();
    expect(reviewedTimingRules(base, review).sha256).toBe(result.sha256);
    expect(JSON.stringify(base)).toBe(original);
    expect(oldSnapshot.rules.targets["36"]).toBe(route.targetSec);
  });
  it("rejects cross-edition, changed-route and unsupported numeric mappings", () => {
    expect(() => reviewedTimingRules(base, { ...review, edition: "retail" })).toThrow(/edition/);
    for (const change of [{ difficultyId: 8 }, { minLevel: 60 }, { previousTargetSec: 1 }, { key: "999999" }]) {
      expect(() => reviewedTimingRules(base, { ...review, routes: [{ ...review.routes[0]!, ...change }] })).toThrow(/no longer matches/);
    }
    expect(() => reviewedTimingRules(base, { ...review, routes: [{ ...review.routes[0]!, sources: [] }] })).toThrow(/sources/);
    expect(() => reviewedTimingRules(base, { ...review, routes: [{ ...review.routes[0]!, targetSec: 1900 }] })).toThrow(/range/);
  });
  it("keeps native Mythic+ timers separate from normal-mode estimates", () => {
    const retail = editionDungeonRules("retail");
    const result = reviewedTimingRules(retail, { ...review, edition: "retail", routes: [] });
    expect(result.rules.keystoneRating).toEqual(retail.keystoneRating);
    expect(result.rules.targets).toEqual(retail.targets);
    expect(result.unverifiedRoutes.length).toBe(retail.routes.length);
  });
});
