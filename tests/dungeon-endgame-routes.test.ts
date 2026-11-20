import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRACKET_PLAN, bracketPlanProblems } from "../src/services/dungeon-bracket-plan.js";
import { SEASON2_ENDGAME_ROUTES, SEASON2_WAITING } from "../src/services/dungeon-endgame-routes.js";
import { resolveNovemberRoute, validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { ratingDungeonKey } from "../src/services/dungeon-rating.js";
import { season2Embed } from "../src/services/dungeon-season2-admin.js";
import { season2Proposal } from "../src/services/dungeon-season2.js";
import { publicRouteKey, publicRules } from "../src/services/public-score.js";
import { completeAtFinalBoss } from "../src/services/dungeon-recovery.js";
import { finalBossOf, routeBosses } from "../src/services/dungeon-bosses.js";
import { localDungeonName } from "../src/services/dungeon-names.js";

const START = new Date("2026-12-09T23:00:00Z");
const rules = { ...publicRules(), evidencePolicy: "current-v1" as const };
const proposal = () => season2Proposal(rules, [], START);

describe("Season 2 endgame routes (zero observations)", () => {
  it("includes every known 45-60 dungeon with the owner's provisional targets, even with no runs", () => {
    const { rules: s2, rows, added } = proposal();
    expect(validBracketedRules(s2)).toBe(true);
    expect(s2.evidencePolicy).toBe("current-v2");
    const minutes = (key: string) => s2.targets[key]! / 60;
    expect(Object.fromEntries(["209", "349", "109", "230", "229:lower", "229:upper", "429:east", "429:west", "429:north", "289", "329:main", "329:service"].map(k => [k, minutes(k)])))
      .toEqual({ "209": 40, "349": 50, "109": 45, "230": 70, "229:lower": 70, "229:upper": 75, "429:east": 25, "429:west": 35, "429:north": 30, "289": 60, "329:main": 50, "329:service": 45 });
    expect(s2.routeBracket["209"]).toBe("45-59");
    expect(s2.routeBracket["230"]).toBe("60");
    expect(s2.routeBracket["2970"]).toBe("30-44");
    expect(added).toBe(SEASON2_ENDGAME_ROUTES.length);
    // Provisional / no data, never dropped or warned about.
    for (const r of rows.filter(x => x.added)) expect(r).toMatchObject({ basis: "carried", samples: 0, added: true });
    expect(s2.catalog.filter(d => d.bracket === "60").every(d => d.provisional)).toBe(true);
    expect(s2.recalibrations).toBeUndefined();
  });
  it("keeps the 15-44 targets and adds the 45-59 and 60 brackets (best-N capped by the routes that exist)", () => {
    const { rules: s2 } = proposal();
    expect(s2.brackets.map(b => [b.key, b.bestCount])).toEqual([["15-29", 5], ["30-44", 5], ["45-59", 4], ["60", 8]]);
    for (const [key, sec] of Object.entries(rules.targets)) expect(s2.targets[key]).toBe(sec);
  });
  it("lists the dungeons whose map id nobody has seen as waiting, never invented as routes", () => {
    const { rules: s2, waiting } = proposal();
    expect(SEASON2_WAITING.map(w => w.id).sort()).toEqual(["blackmaw-hold", "shapers-terrace"]);
    expect(waiting.map(w => w.id)).toEqual(expect.arrayContaining(SEASON2_WAITING.map(w => w.id)));
    expect(s2.provisional!.waiting.map(w => w.id)).not.toContain("blackrock-depths");
    expect(s2.provisional!.waiting.map(w => w.id)).not.toContain("drowned-city");
    expect(s2.routes.map(r => r.name).join("|")).not.toMatch(/Blackmaw|Shaper/);
  });
  it("shows them as provisional in the review, not as missing", () => {
    const { rules: s2 } = proposal();
    const review = { loaded: { window: { name: "Season 1" }, rules, observations: { v2Runs: 0, ratedRuns: 0, unrated: [{ instanceId: 230, name: "Blackrock Depths", count: 2, median: 3000, levels: [60, 60] as [number, number] }] } },
      startsAt: START, proposal: { ...proposal(), rules: s2 } } as never;
    const embed = season2Embed(review).toJSON();
    const text = JSON.stringify(embed);
    expect(text).toContain("provisional, no data");
    expect(text).toContain("Blackrock Depths");
    expect(embed.fields!.some(f => f.name.startsWith("Not in Season 2 yet"))).toBe(false);
    expect(embed.fields!.find(f => f.name.startsWith("Waiting for a map id"))!.value).toContain("blackmaw-hold");
    expect(text.length).toBeLessThan(6000);
  });
  it("keeps the bracket plan in step with the Season 2 targets, with Upper Blackrock Spire", () => {
    expect(bracketPlanProblems()).toEqual([]);
    for (const r of SEASON2_ENDGAME_ROUTES) expect(BRACKET_PLAN.find(p => p.id === r.planId), r.planId).toMatchObject({ minutes: r.minutes, bracket: r.bracket });
  });
});

describe("Krol'dok Stronghold and Alcaz Prison (real runs of 19 November 2026)", () => {
  const { rules: s2 } = proposal();
  it("are provisional routes ending at their final boss, with generous targets", () => {
    const k = s2.routes.find(r => r.dungeonKey === "3039")!, a = s2.routes.find(r => r.dungeonKey === "2994")!;
    expect(k).toMatchObject({ instanceId: 3039, name: "Krol'dok Stronghold", completionModel: "addon-final-boss", targetSec: 70 * 60, competitionBand: { min: 40, max: 44, difficultyId: 0 } });
    expect(a).toMatchObject({ instanceId: 2994, name: "Alcaz Prison", completionModel: "addon-final-boss", targetSec: 60 * 60, competitionBand: { min: 48, max: 56, difficultyId: 0 } });
    expect(s2.routeBracket["3039"]).toBe("30-44");
    expect(s2.routeBracket["2994"]).toBe("45-59");
    expect(s2.provisional!.waiting.map(w => w.id).sort()).toEqual(["blackmaw-hold", "shapers-terrace"]);
  });
  it("knows both final bosses in the bot and in both addons", () => {
    expect(finalBossOf(3039)).toMatchObject({ ids: [3451], name: "Overseer Mugg" });
    expect(finalBossOf(2994)).toMatchObject({ ids: [3409], name: "Blazeroar" });
    expect(routeBosses(3039)!.bosses.flatMap(b => b.ids)).toEqual([3450, 3452, 3453, 3449, 3451]);
    expect(routeBosses(2994)!.bosses.flatMap(b => b.ids)).toEqual([3403, 3410, 3415, 3418, 3409]);
    for (const file of ["addon/Guilded/Compat.lua", "addon/GuildedDungeons/Shared/Compat.lua"]) {
      const lua = readFileSync(file, "utf8");
      for (const line of ["[3039] = 3451", "[2994] = 3409", '[3039] = { "Overseer Mugg" }', '[2994] = { "Blazeroar" }']) expect(lua, `${file} ${line}`).toContain(line);
    }
  });
  it("recovers an unfinished run at the final boss kill", () => {
    const T = 1_800_000_000;
    const k = (id: number, at: number) => ({ id, success: true, at, source: "native" });
    const r = completeAtFinalBoss({ id: "K1", instanceId: 3039, startedAt: T, state: "ABANDONED", encounters: [k(3450, T + 600), k(3451, T + 3600), k(3450, T + 5000)],
      players: [{ character: "A", realm: "Forever", presentSec: 4000 }] });
    expect("skip" in r).toBe(false);
    if (!("skip" in r)) expect(r).toMatchObject({ endedAt: T + 3600, trimmed: 1, run: { state: "COMPLETED", completedBy: "final boss" } });
  });
});

describe("Blackrock Spire, Dire Maul and Stratholme wings", () => {
  const killed = (...names: string[]) => names.map((name, i) => ({ name, success: true, at: 100 + i }));
  const route = (instanceId: number, ...names: string[]) => resolveNovemberRoute(
    { instanceId, difficultyId: 0, startedAt: new Date(50_000), endedAt: new Date(2_000_000), competitionData: { encounters: killed(...names) }, completedBy: "final boss" }, { routes: proposal().rules.routes }).key;
  it("tells Lower from Upper Blackrock Spire by the last boss", () => {
    expect(route(229, "Overlord Wyrmthalak")).toBe("229:lower");
    expect(route(229, "General Drakkisath")).toBe("229:upper");
    expect(route(229, "Overlord Wyrmthalak", "General Drakkisath")).toBe("229");
  });
  it("tells the Dire Maul wings and the Stratholme gates apart", () => {
    expect(route(429, "Alzzin the Wildshaper")).toBe("429:east");
    expect(route(429, "Prince Tortheldrin")).toBe("429:west");
    expect(route(429, "King Gordok")).toBe("429:north");
    expect(route(329, "Balnazzar")).toBe("329:main");
    expect(route(329, "Baron Rivendare")).toBe("329:service");
  });
  it("resolves the wings from French boss names (Wowhead FR)", () => {
    expect(route(229, "Seigneur Wyrmthalak")).toBe("229:lower");
    expect(route(229, "Général Drakkisath")).toBe("229:upper");
    expect(route(429, "Alzzin le Modeleur")).toBe("429:east");
    expect(route(429, "Prince Tortheldrin")).toBe("429:west");
    expect(route(429, "Roi Gordok")).toBe("429:north");
    expect(route(329, "Balnazzar")).toBe("329:main");
    expect(route(329, "Baron Rivendare")).toBe("329:service");
    expect(publicRouteKey(229, [{ name: "Général Drakkisath", success: true }])).toBe("229:upper");
    expect(ratingDungeonKey({ instanceId: 429, competitionData: { encounters: killed("Roi Gordok") } } as never)).toBe("429:north");
  });
  it("keeps the French names in the addon's final-boss table (escaped for the validator)", () => {
    const lua = readFileSync("addon/Guilded/Compat.lua", "utf8");
    for (const name of ["Seigneur Wyrmthalak", "G\\195\\169n\\195\\169ral Drakkisath", "Alzzin le Modeleur", "Roi Gordok", "Sombre Ma\\195\\174tre Gandling", "Empereur Dagran Thaurissan", "Chef Ukorz Scalpessable", "Princesse Theradras", "Ombre d'Eranikus"]) expect(lua).toContain(`"${name}"`);
    expect(readFileSync("addon/GuildedDungeons/Shared/Compat.lua", "utf8")).toContain("Sombre Ma\\195\\174tre Gandling");
  });
  it("resolves single-route maps by the addon's final-boss detection", () => {
    expect(route(230)).toBe("230");
    expect(route(289)).toBe("289");
  });
  it("derives the wing key for legacy and public uploads too", () => {
    expect(publicRouteKey(229, [{ name: "General Drakkisath", success: true }])).toBe("229:upper");
    expect(publicRouteKey(229, [])).toBeNull();
    expect(publicRouteKey(230, [])).toBe("230");
    expect(ratingDungeonKey({ instanceId: 429, competitionData: { encounters: killed("King Gordok") } } as never)).toBe("429:north");
  });
  it("names them in English and French", () => {
    expect(localDungeonName({ instanceId: 229, dungeonName: "Pic Rochenoire", routeKey: "229:upper" }, "en")).toBe("Upper Blackrock Spire");
    expect(localDungeonName({ instanceId: 229, dungeonName: "x", routeKey: "229:upper" }, "fr")).toBe("Sommet du pic Rochenoire");
    expect(localDungeonName({ instanceId: 36, dungeonName: "Mortemines" }, "en")).toBe("The Deadmines");
    expect(localDungeonName({ instanceId: 36, dungeonName: "The Deadmines" }, "fr")).toBe("Les Mortemines");
    expect(localDungeonName({ instanceId: 189, dungeonName: "Monastère écarlate", routeKey: "189:armory" }, "fr")).toBe("Monastère Écarlate : Armurerie");
    expect(localDungeonName({ instanceId: 999999, dungeonName: "Whatever" }, "en")).toBe("Whatever");
  });
});
