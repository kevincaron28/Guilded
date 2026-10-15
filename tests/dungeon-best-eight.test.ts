import { describe, expect, it } from "vitest";
import { bestEightBetaRules, betaSeasonRules } from "../src/services/dungeon-beta-preset.js";
import { calculateDungeonRating, frozenRating, hasDungeonRating, ratingEmbed, type RatingRun } from "../src/services/dungeon-rating.js";
import { computeWeeklyVarietyPoints, dungeonConfig } from "../src/services/dungeon-rules.js";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";

const rules = bestEightBetaRules();
function run(key: string, score = 200, level = 30, name = "Tester"): RatingRun {
  const durationSec = 200 * rules.targets[key]! / score;
  return { instanceId: Number(key.split(":")[0]), difficultyId: 0, runRef: key, durationSec,
    startedAt: new Date(1000000), endedAt: new Date((1000 + durationSec) * 1000),
    players: [{ character: name, memberId: "m", member: { displayName: "Account" }, presentSec: durationSec }],
    competitionData: { players: [{ name, level, minLevel: level }], encounters: [{ id: 1, success: true,
      name: key === "189:graveyard" ? "Bloodmage Thalnos" : key === "189:library" ? "Arcanist Doan" : "Boss", startedAt: 1001, at: 1031 }] } };
}

describe("best-eight beta", () => {
  it("counts 8 of 11 distinct routes and preserves non-counted runs and boss records in archives", () => {
    const runs = rules.catalog.map(d => run(d.dungeonKey));
    const rows = calculateDungeonRating(runs, rules);
    expect(rows[0]).toMatchObject({ points: 1600, dungeons: 11 });
    expect(rows[0]!.details!.filter(d => d.counted)).toHaveLength(8);
    expect(rows[0]!.details!.every(d => d.bosses?.length === 1)).toBe(true);
    expect(frozenRating(rows)).toEqual(rows);
    expect(calculateDungeonRating([...runs].reverse(), rules)).toEqual(rows);
    const bad = structuredClone(rows); bad[0]!.points = 2200;
    expect(frozenRating(bad)).toBeNull();
    const tampered = structuredClone(rows); tampered[0]!.details![0]!.counted = !tampered[0]!.details![0]!.counted;
    expect(frozenRating(tampered)).toBeNull();
    expect(calculateDungeonRating(rules.catalog.map(d => run(d.dungeonKey, 400)), rules)[0]!.points).toBe(3200);
  });
  it("replaces the weakest counted score; repeats and extra routes cannot inflate the total", () => {
    const keys = rules.catalog.map(d => d.dungeonKey);
    const runs = keys.slice(0, 8).map(k => run(k, 180));
    expect(calculateDungeonRating(runs, rules)[0]!.points).toBe(1440);
    expect(calculateDungeonRating([...runs, run(keys[8]!, 240)], rules)[0]!.points).toBe(1500);
    expect(calculateDungeonRating([...runs, run(keys[8]!, 150), ...runs], rules)[0]!.points).toBe(1440);
    expect(calculateDungeonRating([run(keys[0]!, 200), run(keys[0]!, 300), run(keys[0]!, 200, 30, "Alt")], rules).map(r => r.points)).toEqual([300, 200]);
  });
  it("requires the shared competition level including observed level changes, guests and replacements", () => {
    for (const level of [29, 31]) expect(calculateDungeonRating([run("33", 200, level)], rules)[0]!.points).toBe(0);
    const changed = run("33");
    (changed.competitionData as { players: { minLevel: number }[] }).players[0]!.minLevel = 29;
    expect(calculateDungeonRating([changed], rules)[0]!.points).toBe(0);
    const guest = run("33"); guest.players.push({ character: "Guest", memberId: null, member: null, presentSec: 1 });
    (guest.competitionData as { players: unknown[] }).players.push({ name: "Guest", level: 31, minLevel: 31 });
    expect(calculateDungeonRating([guest], rules)[0]!.points).toBe(0);
    const partial = run("33"); partial.players[0]!.presentSec = partial.durationSec! * 0.8 - 1;
    expect(calculateDungeonRating([partial], rules)).toEqual([]);
    partial.players[0]!.presentSec++;
    expect(calculateDungeonRating([partial], rules)[0]!.points).toBe(200);
  });
  it("keeps the legacy preset intact and rejects malformed v4 rules", () => {
    expect(betaSeasonRules().version).toBe(3);
    expect(betaSeasonRules().catalog).toHaveLength(16);
    expect(hasDungeonRating(rules)).toBe(true);
    expect(hasDungeonRating({ ...rules, bestCount: 9 })).toBe(false);
    expect(hasDungeonRating({ ...rules, competitionLevel: 29 })).toBe(false);
    expect(hasDungeonRating({ ...rules, participationLevelBands: null })).toBe(false);
    expect(rules.participationLevelBands["36"]).toMatchObject({ min: 17, max: 26 });
    expect(rules.targets["36"]).toBeUndefined();
  });
  it("freezes participation at 75/25/0 regardless of records, deaths or configurable bonuses", () => {
    const points = (earlierThisWeek: number, mode: "full" | "helper" | "completion") => computeWeeklyVarietyPoints({
      instanceId: 33, durationSec: 900, guildRecord: true, fullGuildGroup: true, config: dungeonConfig({ completion: 999 }),
      players: [{ memberId: "m", character: "Tester", deaths: 0, firstEver: true, previousBest: 1800, earlierThisWeek, participationMode: mode }]
    }).reduce((sum, a) => sum + a.amount, 0);
    expect([0, 1, 2, 5].map(n => points(n, "full"))).toEqual([75, 25, 0, 0]);
    expect([0, 1, 2].map(n => points(n, "helper"))).toEqual([50, 25, 0]);
    expect(points(0, "completion")).toBe(50);
  });
  it.each(["en", "fr"] as const)("explains active rules and fits Discord (%s)", lang => {
    const guide = dungeonScoringGuide(dungeonConfig(undefined), lang, rules);
    expect(guide.length).toBeLessThanOrEqual(6000);
    for (const field of guide.toJSON().fields!) expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(guide.toJSON().fields![0]!.value).toContain("8");
    expect(ratingEmbed([], "Beta", lang, rules).toJSON().description).toContain("3 200".replace(" ", lang === "en" ? "," : " "));
  });
});
