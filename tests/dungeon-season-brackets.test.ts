import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUNGEON_BRACKETS, createBracketedDungeonRules, validBracketedRules, validNovemberRules, validRouteRules, type BracketRoute
} from "../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, defaultBracket, frozenRating, hasDungeonRating, ratingEmbed, seasonDungeonCatalog } from "../src/services/dungeon-rating.js";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { novemberFixtures, novemberRulesFixture, novemberRun } from "./fixtures/november-routes.js";

// Synthetic routes only: indices 0-3 are a low (20-29) band, the other rated ones level 60.
const LOW = [0, 1, 2, 3];
const BRACKETS = [{ key: "15-29", min: 15, max: 29, bestCount: 3 }, { key: "60", min: 60, max: 60, bestCount: 4 }];
function bracketRoutes(): BracketRoute[] {
  return novemberFixtures().map((r, i) => ({ ...r, competitionBand: r.targetSec === null ? null
    : LOW.includes(i) ? { min: 20, max: 29, difficultyId: 7 } : { min: 60, max: 60, difficultyId: 7 } }));
}
const rules = createBracketedDungeonRules({ routes: bracketRoutes(), brackets: BRACKETS });

describe("all-level season rules (version 6)", () => {
  it("freezes brackets, per-route competition bands and each route's bracket", () => {
    expect(rules).toMatchObject({ version: 6, brackets: BRACKETS });
    expect(rules).not.toHaveProperty("competitionLevel");
    expect(rules.routeBracket).toMatchObject({ "90001:east": "15-29", "90002:main": "15-29", "90002:service": "60", "90007": "60" });
    expect(rules.routeBracket).not.toHaveProperty("90006");
    expect(rules.levelBands["90001:east"]).toEqual({ min: 20, max: 29, difficultyId: 7 });
    expect(rules.participationLevelBands["90006"]).toEqual({ min: 10, max: 20, difficultyId: 7 });
    expect(seasonDungeonCatalog(rules, []).find(d => d.dungeonKey === "90001:east")).toMatchObject({ minLevel: 20, maxLevel: 29, bracket: "15-29" });
    expect(validBracketedRules(rules) && hasDungeonRating(rules) && validRouteRules(rules)).toBe(true);
    expect(validNovemberRules(rules)).toBe(false);
    expect(validBracketedRules(JSON.parse(JSON.stringify(rules)))).toBe(true);
  });
  it("keeps version 5 separate and unchanged", () => {
    const v5 = novemberRulesFixture();
    expect(v5).toMatchObject({ version: 5, competitionLevel: 60, bestCount: 8 });
    expect(validNovemberRules(v5) && hasDungeonRating(v5) && validRouteRules(v5)).toBe(true);
    expect(validBracketedRules(v5)).toBe(false);
    expect(Object.values(v5.levelBands).every(b => b.min === 60 && b.max === 60)).toBe(true);
  });
  it("proposes 15-29, 30-44, 45-59 and 60 by default without making a season", () => {
    expect(DEFAULT_DUNGEON_BRACKETS.map(b => b.key)).toEqual(["15-29", "30-44", "45-59", "60"]);
    // The synthetic routes cannot fill eight per default bracket: creation refuses.
    expect(() => createBracketedDungeonRules({ routes: bracketRoutes(), brackets: DEFAULT_DUNGEON_BRACKETS })).toThrow(/at least 8/);
  });
  it.each([
    ["overlapping brackets", { brackets: [{ key: "15-29", min: 15, max: 30, bestCount: 3 }, { key: "30-60", min: 30, max: 60, bestCount: 4 }] }],
    ["duplicate keys", { brackets: [{ key: "a", min: 15, max: 29, bestCount: 3 }, { key: "a", min: 60, max: 60, bestCount: 4 }] }],
    ["bad key", { brackets: [{ key: "Low!", min: 15, max: 29, bestCount: 3 }, BRACKETS[1]] }],
    ["too few routes for best-N", { brackets: [{ ...BRACKETS[0]!, bestCount: 5 }, BRACKETS[1]] }],
    ["a band outside every bracket", { brackets: [{ key: "15-25", min: 15, max: 25, bestCount: 3 }, BRACKETS[1]] }]
  ])("rejects %s", (_, change) => {
    expect(() => createBracketedDungeonRules({ routes: bracketRoutes(), ...change })).toThrow();
  });
  it("requires a competition band exactly on rated routes", () => {
    const missing = bracketRoutes(); missing[0]!.competitionBand = null;
    expect(() => createBracketedDungeonRules({ routes: missing, brackets: BRACKETS })).toThrow();
    const extra = bracketRoutes(); extra[6]!.competitionBand = { min: 60, max: 60, difficultyId: 7 };
    expect(() => createBracketedDungeonRules({ routes: extra, brackets: BRACKETS })).toThrow();
    expect(() => createBracketedDungeonRules({ routes: novemberFixtures(), brackets: BRACKETS })).toThrow();
  });
  it.each([
    ["best-N above its routes", (r: typeof rules) => { r.brackets[0]!.bestCount = 5; }],
    ["route bracket", (r: typeof rules) => { r.routeBracket["90001:east"] = "60"; }],
    ["target", (r: typeof rules) => { r.targets["90001:east"] = 999; }],
    ["band", (r: typeof rules) => { r.levelBands["90001:east"]!.max = 60; }],
    ["extra field", (r: typeof rules) => { (r as unknown as Record<string, unknown>)["competitionLevel"] = 60; }],
    ["missing catalog", (r: typeof rules) => { r.catalog = []; }]
  ])("refuses stored rules with a changed %s", (_, mutate) => {
    const stored = structuredClone(rules); mutate(stored);
    expect(validBracketedRules(stored)).toBe(false);
    expect(hasDungeonRating(stored)).toBe(false);
  });
});

describe("per-bracket rating", () => {
  it("rates each bracket separately with its own best-N, using the level during the run", () => {
    const low = LOW.map(i => novemberRun(i, i === 0 ? 900 : 1800, 25)); // 400 + 3 × 200, best 3 count
    const high = [4, 5].map(i => novemberRun(i, 1800, 60));
    const rows = calculateDungeonRating([...low, ...high], rules);
    expect(rows.map(r => [r.character, r.bracket, r.bestCount, r.points])).toEqual([["Tester", "15-29", 3, 800], ["Tester", "60", 4, 400]]);
    const lowRow = rows.find(r => r.bracket === "15-29")!;
    expect(lowRow.details!.filter(d => d.counted)).toHaveLength(3);
    expect(lowRow.details!.every(d => d.ratingVersion === 6)).toBe(true);
    expect(frozenRating(rows)).toEqual(rows);
    expect(calculateDungeonRating([...high, ...low].toReversed(), rules)).toEqual(rows);
  });
  it("never counts a level-60 run in a lower bracket", () => {
    const carry = novemberRun(0, 1800, 60);
    const rows = calculateDungeonRating([carry], rules);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bracket: "60", points: 0 });
    expect(rows[0]!.details![0]).toMatchObject({ dungeonKey: "90001:east", unrankedReason: "Overlevel carry" });
    // A level-60 route played below 60 is unranked in the player's own bracket.
    expect(calculateDungeonRating([novemberRun(4, 1800, 25)], rules)[0]).toMatchObject({ bracket: "15-29", points: 0 });
  });
  it("leaves characters outside every bracket off the board", () => {
    expect(calculateDungeonRating([novemberRun(0, 1800, 10)], rules)).toEqual([]);
  });
  it("refuses archives with a missing or changed bracket", () => {
    const rows = calculateDungeonRating([novemberRun(0, 1800, 25), novemberRun(1, 1800, 25), novemberRun(2, 1800, 25), novemberRun(3, 1800, 25)], rules);
    expect(rows[0]!.points).toBe(600);
    for (const mutate of [(r: typeof rows) => { delete r[0]!.bracket; }, (r: typeof rows) => { r[0]!.bestCount = 4; },
      (r: typeof rows) => { r[0]!.bracket = "Not a key"; }]) {
      const copy = structuredClone(rows); mutate(copy);
      expect(frozenRating(copy)).toBeNull();
    }
    const v5rows = calculateDungeonRating([novemberRun()], novemberRulesFixture());
    expect(v5rows[0]).not.toHaveProperty("bracket");
    expect(frozenRating([{ ...v5rows[0]!, bracket: "60" }])).toBeNull();
  });
  it.each(["en", "fr"] as const)("shows one bracket or every bracket and picks the viewer's (%s)", lang => {
    const rows = calculateDungeonRating([novemberRun(0, 1800, 25), novemberRun(4, 900, 60)], rules);
    expect(defaultBracket(rows, "m")).toBe("60");
    expect(defaultBracket(rows, "nobody")).toBeUndefined();
    const one = ratingEmbed(rows, "November", lang, rules, "15-29").toJSON();
    expect(one.description).toContain("Tester");
    expect(one.description).toContain("**200**");
    expect(one.description).not.toContain("**400**");
    const all = ratingEmbed(rows, "November", lang, rules).toJSON();
    expect(all.fields).toHaveLength(2);
    expect(all.fields![1]!.value).toContain("**400**");
    const guide = dungeonScoringGuide(dungeonConfig(undefined), lang, rules);
    expect(guide.toJSON().fields![0]!.value).toContain(lang === "fr" ? "3 meilleurs sur 4 parcours" : "best 3 of 4 routes");
    expect(guide.length).toBeLessThan(6000);
  });
});
