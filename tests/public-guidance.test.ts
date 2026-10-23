import { describe, expect, it } from "vitest";
import { penalized, timeRating } from "../src/services/dungeon-rating.js";
import { GAIN_STEP, planBase, planImprovements, roleScores, scenarioAt, type PlanInput } from "../src/services/public-guidance.js";
import { createLeaderboardPages, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, type ScoreRun } from "../src/services/public-score.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md, item 2: the best next improvement recomputes the
// whole best-N selection on a hypothetical run, and role scores come from that role's runs only.
// Levels 15-29 targets (provisional plan): 389 Ragefire 20:00 (15-18), 3065 Hall of Thanes 25:00
// (15-20), 2999 Ruins 35:00 (15-22), 43 Wailing 40:00 (15-24), 36 Deadmines 40:00 (17-26),
// 33 Shadowfang 30:00 (20-29), 34 Stockade 20:00 (24-29); best 5 count.

const rules = publicRules();
const NOW = new Date("2026-11-20T00:00:00Z");
const ME = { character: "Kev", realm: "Doomhowl", className: "Warrior", role: "TANK", level: 20 };
let id = 0;
const run = (key: string, durationSec: number, over: { level?: number; role?: string | null; endedAt?: Date } = {}): LeaderRun => ({
  runId: `r${++id}`, instanceId: Number(key.split(":")[0]), routeKey: key, difficultyId: 0, dungeonName: `Dungeon ${key}`, durationSec,
  endedAt: over.endedAt ?? new Date("2026-11-10T00:00:00Z"), confirmations: 1, evidence: null, deaths: 0, bracket: "15-29", season: "2026-Q4",
  players: [{ ...ME, level: over.level ?? 20, minLevel: over.level ?? 20, role: over.role === undefined ? "TANK" : over.role }]
});
const input = (runs: ScoreRun[], level: number | null = 20): PlanInput => ({ runs, rules, me: ME, level, now: NOW });
// Best 5 full: 200, 200, 200, 190 (Ragefire at level 18, no penalty), 180 = 970; Deadmines 160 is not counted.
const full = () => [run("3065", 1500), run("2999", 2100), run("43", 2400), run("389", 1263, { level: 18 }), run("33", 2000), run("36", 3000)];
const routeOf = (plan: ReturnType<typeof planImprovements>, key: string) => plan!.routes.find((r) => r.key === key)!;

describe("best next improvement", () => {
  it("gives a counted route's slowest clear for the next gain, to the second", () => {
    const plan = planImprovements(input(full()))!;
    expect(plan).toMatchObject({ bracket: "15-29", bestCount: 5, total: 970, counted: 5, weakest: { key: "33", points: 180 } });
    const ruins = routeOf(plan, "2999");
    expect(ruins).toMatchObject({ targetSec: 2100, best: { points: 200, durationSec: 2100, counted: true }, fit: "ok", penaltyPercent: 0 });
    expect(ruins.next).toEqual({ durationSec: 2053, routePoints: 205, gain: GAIN_STEP, total: 975, pushedOut: [] });
    // One second slower is one point short.
    expect(timeRating(2054, 2100)).toBe(204);
  });

  it("says a faster run on a route outside best N adds nothing until it beats the lowest counted route", () => {
    const base = planBase(input(full()), "15-29");
    // Deadmines 160 → 178: the route improves, the season score does not.
    expect(scenarioAt(base, "36", 2700, 20)).toMatchObject({ routePoints: 178, gain: 0, total: 970, pushedOut: [] });
    // A tie with the lowest counted route (Shadowfang 180) adds nothing either.
    expect(scenarioAt(base, "36", 2667, 20)).toMatchObject({ routePoints: 180, gain: 0, pushedOut: [] });
    const deadmines = routeOf(planImprovements(input(full())), "36");
    expect(deadmines.best).toEqual({ points: 160, durationSec: 3000, counted: false, evidence: "legacy", confirmations: 1 });
    expect(deadmines.next).toEqual({ durationSec: 2601, routePoints: 185, gain: 5, total: 975, pushedOut: [{ key: "33", points: 180 }] });
  });

  it("pushes out the route characterScores would drop when the lowest counted routes tie", () => {
    // Wailing Caverns 180 ties Shadowfang 180: "33" sorts first, so "43" is the one left out.
    const runs = [run("3065", 1500), run("2999", 2100), run("43", 2667), run("389", 1263, { level: 18 }), run("33", 2000)];
    const plan = planImprovements(input(runs))!;
    expect(plan.weakest).toEqual({ key: "43", points: 180 });
    const next = routeOf(plan, "36").next!;
    expect(next.pushedOut).toEqual([{ key: "43", points: 180 }]);
    const after = characterScores([...runs, run("36", next.durationSec!)], rules).find((row) => row.bracket === "15-29")!;
    expect(after.points).toBe(next.total);
    expect(after.routes.filter((r) => r.counted).map((r) => r.key).sort()).toEqual(["2999", "3065", "33", "36", "389"]);
  });

  it("uses the over-level penalty and its rounding for the character's level", () => {
    const ragefire = routeOf(planImprovements(input(full())), "389");
    // Level 20 on a 15-18 route: two levels over, -20%. 190 is counted (earned at level 18).
    expect(ragefire).toMatchObject({ fit: "ok", penaltyPercent: 20, best: { points: 190, counted: true } });
    expect(ragefire.next).toMatchObject({ durationSec: 985, routePoints: 195, gain: 5 });
    expect(penalized(timeRating(985, 1200), 20)).toBe(195);
    expect(penalized(timeRating(986, 1200), 20)).toBe(194);
    // Three levels over is the most a ranked run allows; four is a carry.
    expect(routeOf(planImprovements(input(full(), 21)), "389")).toMatchObject({ fit: "ok", penaltyPercent: 30 });
    expect(routeOf(planImprovements(input(full(), 22)), "389")).toMatchObject({ fit: "carry", next: null });
    // Below a route's levels: the scenario is at its lowest level, without a penalty.
    const stockade = routeOf(planImprovements(input(full())), "34");
    expect(stockade).toMatchObject({ fit: "below", penaltyPercent: 0, best: null });
    expect(stockade.next).toMatchObject({ durationSec: 1300, routePoints: 185, gain: 5, pushedOut: [{ key: "33", points: 180 }] });
  });

  it("fills open places with any ranked clear and stops at the 400 maximum", () => {
    const plan = planImprovements(input([run("3065", 1500), run("2999", 2100), run("43", 2400)]))!;
    expect(plan).toMatchObject({ total: 600, counted: 3, weakest: null, easiest: null });
    expect(routeOf(plan, "36").next).toMatchObject({ durationSec: null, routePoints: 50, gain: 50, total: 650 });
    expect(routeOf(plan, "389").next).toMatchObject({ durationSec: null, routePoints: 40, gain: 40 });
    // 398 can only gain 2 more; 400 cannot gain.
    expect(routeOf(planImprovements(input([run("3065", 754)])), "3065").next).toMatchObject({ durationSec: 750, routePoints: 400, gain: 2 });
    expect(routeOf(planImprovements(input([run("3065", 700)])), "3065")).toMatchObject({ best: { points: 400 }, next: null });
  });

  it("finds nothing to gain when every counted route is at 400", () => {
    const capped = [run("3065", 700), run("2999", 1000), run("43", 1100), run("389", 500, { level: 18 }), run("33", 800)];
    const plan = planImprovements(input(capped))!;
    expect(plan.total).toBe(2000);
    expect(plan.routes.every((r) => r.next === null)).toBe(true);
    expect(plan.easiest).toBeNull();
  });

  it("picks the route needing the least speed against its target, and the right bracket", () => {
    // Shadowfang 30:00 target: 32:31 still gains (1.084 x target), just ahead of Deadmines (1.0838).
    expect(planImprovements(input(full()))!.easiest).toMatchObject({ key: "33", next: { durationSec: 1951, gain: 5 } });
    expect(planImprovements(input(full(), 50))).toBeNull();
    // Unknown level: the bracket of the newest rated run.
    const library = { ...run("189:library", 1500, { level: 33, endedAt: new Date("2026-11-12T00:00:00Z") }), bracket: "30-44" };
    expect(planImprovements(input([...full(), library], null))).toMatchObject({ bracket: "30-44", level: null, total: 200 });
  });
});

describe("role scores", () => {
  it("scores each role from its own runs, never added together, and leaves unknown roles out", () => {
    const runs = [run("3065", 1500), run("43", 2400), run("2999", 2100, { role: "HEALER" }), run("3065", 1200, { role: "healer" }), run("33", 2000, { role: null }), run("36", 2400, { role: "NONE" })];
    const { roles, unknownRuns } = roleScores(runs, rules, ME);
    const total = (role: string) => roles.find((r) => r.role === role)!.rows.find((row) => row.bracket === "15-29")?.points ?? null;
    expect(total("TANK")).toBe(400);
    expect(total("HEALER")).toBe(450);
    expect(total("DPS")).toBeNull();
    expect(unknownRuns).toBe(2);
    // The overall score picks the best run per route whatever the role: 250 + 200 + 200 + 200 + 180.
    expect(characterScores(runs, rules)[0]!.points).toBe(1030);
  });
});

describe("character page guidance", () => {
  async function page(runs: LeaderRun[], lang = "en") {
    const store: LeaderboardStore = { async runs() { return runs; }, async characterRuns() { return runs; }, async guilds() { return []; }, async guildRuns() { return []; }, async guildRoster() { return []; } };
    const pages = createLeaderboardPages({ store, personal: null, now: () => NOW });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) }, allows: () => true,
      postApplication: async () => null, routes: [pages.route], now: () => NOW });
    return (await app.respond({ method: "GET", path: "/leaderboards/character/Kev-Doomhowl", query: new URLSearchParams({ lang }), headers: {} }) as WebResponse).body;
  }

  it("shows each route's scenario, what it pushes out and the role scores", async () => {
    // Overall best 5: Wailing 240 (as healer), Hall of Thanes 214 (no role), Ruins 200, Ragefire 190, Shadowfang 180 = 1024.
    const runs = [...full(), run("43", 2000, { role: "HEALER" }), run("3065", 1400, { role: null })];
    const body = await page(runs);
    expect(body).toContain('<span class="score">1024</span>');
    expect(body).toContain("<h2>Best next improvement · Levels 15–29</h2>");
    expect(body).toContain("Scenarios, not predictions.");
    expect(body).toContain("Current best: legacy evidence.");
    expect(body).toContain("Scenario: no run or confirmation yet.");
    expect(body).toContain("Level 20 is taken as the party's highest.");
    expect(body).toContain("Most within reach: Shadowfang Keep in 32:31 adds 5 (season score 1024 → 1029).");
    // Deadmines is outside the best 5: its next gain pushes Shadowfang out.
    expect(body).toContain("<strong>43:21</strong> → +5 (season 1029) · replaces Shadowfang Keep (180)");
    expect(body).toContain("Outside the best 5, a run adds nothing until it scores over 180 (Shadowfang Keep, the lowest counted route).");
    expect(body).toContain("Beating 50:00 adds nothing until the run scores over 180.");
    expect(body.match(/adds nothing until the run scores/g)).toHaveLength(1);
    expect(body).toContain('title="Over-level penalty at level 20"');
    expect(body).toContain("<td>Ragefire Chasm</td><td>15–18 <span");
    expect(body).toContain("From level 24: <strong>21:40</strong> → +5");
    expect(body).toContain("<h2>Score by role · Season 1</h2>");
    expect(body).toContain("They are separate scores, never added together.");
    expect(body).toContain('<tr><td>Tank</td><td class="num score">970</td></tr>');
    expect(body).toContain('<tr><td>Healer</td><td class="num score">240</td></tr>');
    expect(body).toContain('<tr><td>DPS</td><td class="num">–</td></tr>');
    expect(body).toContain("1 ranked run has no recorded role: it counts in the overall score only.");
    expect(body).not.toContain("<script");

    const fr = await page(runs, "fr");
    expect(fr).toContain("<h2>Meilleure prochaine amélioration · Niveaux 15–29</h2>");
    expect(fr).toContain("Des scénarios, pas des prédictions.");
    expect(fr).toContain("Admissibilité et confiance");
    expect(fr).toContain("Scénario : aucun essai ni confirmation pour l'instant.");
    expect(fr).toContain("Le plus accessible : Shadowfang Keep en 32:31 ajoute 5 (score de saison 1024 → 1029).");
    expect(fr).toContain("<strong>43:21</strong> → +5 (saison 1029) · remplace Shadowfang Keep (180)");
    expect(fr).toContain("Hors des 5 meilleurs, un essai n'ajoute rien tant qu'il ne dépasse pas 180 (Shadowfang Keep, le plus bas des parcours comptés).");
    expect(fr).toContain("Battre 50:00 n'ajoute rien tant que l'essai ne dépasse pas 180.");
    expect(fr).toContain("Dès le niveau 24 : ");
    expect(fr).toContain("<h2>Score par rôle · Saison 1</h2>");
    expect(fr).toContain('<tr><td>Soigneur</td><td class="num score">240</td></tr>');
    expect(fr).toContain("1 essai classé n'a pas de rôle enregistré : il compte seulement dans le score global.");
  });

  it("explains open places, carries, the maximum and a level without a rated bracket", async () => {
    const open = await page([run("3065", 1500)]);
    expect(open).toContain("Places filled in the best 5: 1. Any ranked clear of a route not counted yet adds its whole score.");
    expect(open).toContain("<strong>Any ranked clear</strong> → +50 (season 250)");
    // Ragefire at level 20: -20% of the 50-point floor.
    expect(open).toContain("<strong>Any ranked clear</strong> → +40 (season 240)");
    expect(open).not.toContain("adds nothing until");
    const carry = await page([run("3065", 700, { level: 18 }), run("33", 1800, { level: 22 })]);
    expect(carry).toContain("Not ranked at level 22: more than 3 levels above this route.");
    expect(carry).toContain("Already 400, the maximum.");
    const high = await page([run("3065", 1500), run("2959", 2700, { level: 50 })]);
    expect(high).toContain("No rated bracket at level 50 yet (launch data needed).");
    expect(high).not.toContain("Most within reach");
  });
  it("shows previous-season roles separately with their own period context", async () => {
    const body = await page([run("36", 2400), run("36", 2000, { role: "HEALER", endedAt: new Date("2026-10-22T12:00:00Z") })]);
    expect(body).toContain("Previous-season role context");
    expect(body).toContain("Score by role · Beta (before Season 1)");
    expect(body).toContain("totals from different brackets or seasons are not directly comparable");
    const fr = await page([run("36", 2400), run("36", 2000, { role: "HEALER", endedAt: new Date("2026-10-22T12:00:00Z") })], "fr");
    expect(fr).toContain("Rôles de la saison précédente");
  });
});
