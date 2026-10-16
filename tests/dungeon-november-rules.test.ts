import { describe, expect, it, vi } from "vitest";
import { createNovemberDungeonRules, resolveNovemberRoute, type NovemberRules } from "../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, dungeonRating, frozenRating, hasDungeonRating, ratingEmbed, seasonDungeonCatalog } from "../src/services/dungeon-rating.js";
import { bestEightBetaRules, betaSeasonRules } from "../src/services/dungeon-beta-preset.js";
import { participationMode } from "../src/services/dungeon-participation.js";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { novemberFixtures, novemberRulesFixture, novemberRun } from "./fixtures/november-routes.js";

const rules = novemberRulesFixture();
function encounters(run: ReturnType<typeof novemberRun>) {
  return (run.competitionData as { encounters: { id?: number; name?: string; success: boolean; at: number }[] }).encounters;
}
describe("separate November level-60 model", () => {
  it("counts eight of nine rated routes, caps at 3200 and keeps extra routes visible", () => {
    const runs = novemberFixtures().map((_, i) => novemberRun(i));
    const rows = calculateDungeonRating(runs, rules);
    expect(rows[0]).toMatchObject({ points: 1600, dungeons: 11 });
    expect(rows[0]!.details!.filter(d => d.counted)).toHaveLength(8);
    expect(rows[0]!.details!.find(d => d.dungeonKey === "90003:upper")).toMatchObject({ points: 0, unrankedReason: "Participation-only route" });
    expect(frozenRating(rows)).toEqual(rows);
    expect(calculateDungeonRating(runs.toReversed(), rules)).toEqual(rows);
    expect(calculateDungeonRating(novemberFixtures().map((_, i) => novemberRun(i, 900)), rules)[0]!.points).toBe(3200);
    expect(calculateDungeonRating([...runs, ...runs], rules)).toEqual(rows);
    expect(seasonDungeonCatalog(rules, [])).toHaveLength(9);
  });
  it("new ninth score replaces the weakest, and alts retain separate rating", () => {
    const indices = [0, 1, 2, 3, 4, 5, 7, 8];
    const runs = indices.map(i => novemberRun(i, 2000)); // 180 each
    expect(calculateDungeonRating(runs, rules)[0]!.points).toBe(1440);
    expect(calculateDungeonRating([...runs, novemberRun(10, 1500)], rules)[0]!.points).toBe(1500);
    const alt = novemberRun(); alt.players[0]!.character = "Alt";
    (alt.competitionData as { players: { name: string }[] }).players[0]!.name = "Alt";
    expect(calculateDungeonRating([novemberRun(), alt], rules).map(r => r.points)).toEqual([200, 200]);
  });
  it.each([30, 59, 61])("rejects observed level %i without changing beta's level 30 rules", level => {
    expect(calculateDungeonRating([novemberRun(0, 1800, level)], rules)[0]!.points).toBe(0);
    expect(bestEightBetaRules().competitionLevel).toBe(30);
    expect(hasDungeonRating({ ...bestEightBetaRules(), competitionLevel: 60 })).toBe(false);
  });
  it("checks outsiders, level changes, difficulty and exact 80% presence", () => {
    const run = novemberRun();
    run.players[0]!.presentSec = 1440;
    expect(calculateDungeonRating([run], rules)[0]!.points).toBe(200);
    run.players[0]!.presentSec--;
    expect(calculateDungeonRating([run], rules)).toEqual([]);
    run.players[0]!.presentSec++;
    run.difficultyId = 0;
    expect(calculateDungeonRating([run], rules)[0]!.points).toBe(0);
    run.difficultyId = 7;
    const data = run.competitionData as { players: { name: string; level: number; minLevel: number }[] };
    data.players[0]!.minLevel = 59;
    expect(calculateDungeonRating([run], rules)[0]!.points).toBe(0);
    data.players[0]!.minLevel = 60;
    run.players.push({ memberId: null, character: "Guest", member: null, presentSec: 1 });
    data.players.push({ name: "Guest", level: 61, minLevel: 61 });
    expect(calculateDungeonRating([run], rules)[0]!.points).toBe(0);
  });
  it("accepts numeric identity and configured English/French aliases, never the run name", () => {
    for (const alias of ["Fixture final 0", "Boss final fictif 0"]) {
      const run = novemberRun(); delete encounters(run)[1]!.id; encounters(run)[1]!.name = alias;
      expect(resolveNovemberRoute(run, rules).key).toBe("90001:east");
      expect(resolveNovemberRoute(run, rules).reason).toBeUndefined();
    }
    const run = novemberRun(); encounters(run).splice(0); run.dungeonName = "Fixture 90001:east";
    expect(resolveNovemberRoute(run, rules).reason).toBe("Dungeon route unknown");
  });
  it("rejects mixed wings, failed, missing and out-of-window evidence", () => {
    const mixed = novemberRun(); encounters(mixed).push(...encounters(novemberRun(1)));
    expect(resolveNovemberRoute(mixed, rules).reason).toBe("Dungeon route unknown");
    for (const mutation of ["failed", "early", "late", "missing"] as const) {
      const run = novemberRun();
      if (mutation === "failed") encounters(run)[0]!.success = false;
      if (mutation === "early") encounters(run)[0]!.at = 999;
      if (mutation === "late") encounters(run)[0]!.at = 2801;
      if (mutation === "missing") encounters(run).shift();
      expect(resolveNovemberRoute(run, rules).reason).toBe("Required encounter evidence missing");
      const rows = calculateDungeonRating([run], rules);
      expect(rows[0]!.details![0]!.bosses).toEqual([]);
      expect(rows[0]!.points).toBe(0);
      expect(frozenRating(rows)).toEqual(rows);
    }
  });
  it("rejects malformed configuration, guessed/empty evidence and fewer than eight rated routes", () => {
    expect(hasDungeonRating(rules)).toBe(true);
    expect(() => createNovemberDungeonRules([])).toThrow();
    const duplicate = novemberFixtures(); duplicate[1]!.completion = duplicate[0]!.completion;
    expect(() => createNovemberDungeonRules(duplicate)).toThrow(/shared/);
    const missing = novemberFixtures(); missing[0]!.verification.runRef = "";
    expect(() => createNovemberDungeonRules(missing)).toThrow();
    expect(() => createNovemberDungeonRules(novemberFixtures().slice(0, 8))).toThrow(/eight/);
    for (const change of [{ competitionLevel: 30 }, { bestCount: 9 }, { targets: { ...rules.targets, "90001:east": 999 } }, { participationLevelBands: {} }]) {
      expect(hasDungeonRating({ ...rules, ...change })).toBe(false);
    }
  });
  it("rejects mixed archive versions and tampered counted flags, preserves previous models", async () => {
    const before = JSON.stringify([betaSeasonRules(), bestEightBetaRules()]);
    const rows = calculateDungeonRating([novemberRun()], rules);
    const db = { dungeonRun: { findMany: vi.fn() } };
    expect(await dungeonRating(db as never, "g", { id: "old", startsAt: new Date(0), status: "ENDED", ratingRules: rules, finalRating: rows })).toEqual(rows);
    expect(db.dungeonRun.findMany).not.toHaveBeenCalled();
    const wrong = structuredClone(rows); wrong[0]!.details![0]!.counted = false;
    expect(frozenRating(wrong)).toBeNull();
    const mixed = calculateDungeonRating([novemberRun(), novemberRun(1)], rules); mixed[0]!.details![0]!.ratingVersion = 4;
    expect(frozenRating(mixed)).toBeNull();
    expect(JSON.stringify([betaSeasonRules(), bestEightBetaRules()])).toBe(before);
  });
  it("separates leveling/helpers from level-60 rating and denies incomplete-route participation", () => {
    const run = { ...novemberRun(9, 1800, 60), difficultyId: 7, completedBy: "final boss", competitionData: novemberRun(9).competitionData,
      players: [{ character: "Tester", memberId: "m", presentSec: 1800 }, { character: "New", memberId: "new", presentSec: 900 }] };
    (run.competitionData as { players: unknown[] }).players.push({ name: "New", level: 15, minLevel: 15 });
    const band = rules.participationLevelBands["90006"];
    expect(participationMode(run, "Tester", band, rules)).toBe("helper");
    expect(participationMode(run, "New", band, rules)).toBe("completion");
    run.players[1]!.presentSec = 899;
    expect(participationMode(run, "Tester", band, rules)).toBe("none");
    (run.competitionData as { encounters: unknown[] }).encounters = [];
    expect(participationMode(run, "Tester", band, rules)).toBe("none");
  });
  it.each(["en", "fr"] as const)("explains level 60 and fits Discord (%s)", lang => {
    const guide = dungeonScoringGuide(dungeonConfig(undefined), lang, rules);
    expect(guide.length).toBeLessThanOrEqual(6000);
    expect(guide.toJSON().title).toContain("60");
    for (const field of guide.toJSON().fields!) expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(ratingEmbed([], "November", lang, rules).toJSON().description).toContain("60");
  });
  it("does not accept a mutated input as frozen rules", () => {
    const input = novemberFixtures(); const frozen: NovemberRules = createNovemberDungeonRules(input);
    input[0]!.completion.ids[0] = 1;
    expect(frozen.routes[0]!.completion.ids[0]).toBe(9000);
  });
});
