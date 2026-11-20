import { novemberDungeonCatalog } from "./dungeon-november-catalog.js";
import { DEFAULT_DUNGEON_BRACKETS, type BracketRoute } from "./dungeon-november-rules.js";
import { ENDGAME_WINGS } from "./dungeon-rating.js";

// The routes Season 2 adds for levels 45-59 and 60 (owner decision, 16 November 2026). A current-v2 season cannot gain routes once it
// starts and no level 45+ run has been recorded yet, so every dungeon of these brackets with a KNOWN map id is a route from day one,
// with a slightly generous provisional target (the time that earns 200 points). The usual formula (dungeon-season2.ts) then takes over:
// a target is a "carried" Season 1-equivalent baseline until measured runs move it. Nothing here touches Season 1's frozen rules.
//
// Map ids are the Classic ones the beta client reported for the other dungeons. Final bosses (the route ends when the addon sees them):
//   Zul'Farrak Chief Ukorz Sandscalp, Maraudon Princess Theradras, Sunken Temple Shade of Eranikus, Blackrock Depths Emperor Dagran
//   Thaurissan (the BRD route is the full clear to the Emperor, so its 70 minute target is a full clear, not the Ring of Law),
//   Scholomance Darkmaster Gandling, The Drowned City Min'loth the Serpent (seen in real runs, map 2970).
// Wing routes (Blackrock Spire, Dire Maul, Stratholme) share one map and are told apart by their last boss (ENDGAME_WINGS).
// Krol'dok Stronghold (map 3039, final boss Overseer Mugg) and Alcaz Prison (map 2994, final boss Blazeroar) come from real guild runs
// of 19 November 2026 (6 and 1 runs); their targets are generous guesses, measured runs take over through the usual formula.
// Krol'dok Stronghold: Blizzard's corrected range is 40-45 (Sep 2026). A rated band must sit inside its bracket (bracketPlanProblems), and 45 belongs to the 45-59 bracket, so the band is 40-44 in "30-44"; a level-45 character is rated in the 45-59 bracket.
// NOT included, because no map id is known and none is invented: Blackmaw Hold, Shaper's Terrace (`SEASON2_WAITING`). Add them to the reviewed rules file once a real run reports their map id, before Season 2 starts.
export const ENDGAME_RUN_REF = "season-2-endgame-2026-11-16";

export interface EndgameRoute {
  /** Id in dungeon-bracket-plan.ts and the November catalog. */
  planId: string; key: string; instanceId: number; bracket: string; min: number; max: number; minutes: number;
  /** Set for a single-route map (route ends on the addon's final-boss detection); wing routes name their last boss in ENDGAME_WINGS. */
  finalBoss?: string;
}
const wing = (instanceId: keyof typeof ENDGAME_WINGS, w: string) => `${instanceId}:${w}`;

export const SEASON2_ENDGAME_ROUTES: readonly EndgameRoute[] = [
  { planId: "drowned-city", key: "2970", instanceId: 2970, bracket: "30-44", min: 34, max: 42, minutes: 35, finalBoss: "Min'loth the Serpent" },
  { planId: "kroldok-stronghold", key: "3039", instanceId: 3039, bracket: "30-44", min: 40, max: 44, minutes: 70, finalBoss: "Overseer Mugg" },
  { planId: "zulfarrak", key: "209", instanceId: 209, bracket: "45-59", min: 45, max: 54, minutes: 40, finalBoss: "Chief Ukorz Sandscalp" },
  { planId: "maraudon", key: "349", instanceId: 349, bracket: "45-59", min: 46, max: 55, minutes: 50, finalBoss: "Princess Theradras" },
  { planId: "alcaz-prison", key: "2994", instanceId: 2994, bracket: "45-59", min: 48, max: 56, minutes: 60, finalBoss: "Blazeroar" },
  { planId: "sunken-temple", key: "109", instanceId: 109, bracket: "45-59", min: 50, max: 59, minutes: 45, finalBoss: "Shade of Eranikus" },
  { planId: "blackrock-depths", key: "230", instanceId: 230, bracket: "60", min: 60, max: 60, minutes: 70, finalBoss: "Emperor Dagran Thaurissan" },
  { planId: "lower-blackrock-spire", key: wing(229, "lower"), instanceId: 229, bracket: "60", min: 60, max: 60, minutes: 70 },
  { planId: "upper-blackrock-spire", key: wing(229, "upper"), instanceId: 229, bracket: "60", min: 60, max: 60, minutes: 75 },
  { planId: "dire-maul-east", key: wing(429, "east"), instanceId: 429, bracket: "60", min: 60, max: 60, minutes: 25 },
  { planId: "dire-maul-west", key: wing(429, "west"), instanceId: 429, bracket: "60", min: 60, max: 60, minutes: 35 },
  { planId: "dire-maul-north", key: wing(429, "north"), instanceId: 429, bracket: "60", min: 60, max: 60, minutes: 30 },
  { planId: "scholomance", key: "289", instanceId: 289, bracket: "60", min: 60, max: 60, minutes: 60, finalBoss: "Darkmaster Gandling" },
  { planId: "stratholme-main", key: wing(329, "main"), instanceId: 329, bracket: "60", min: 60, max: 60, minutes: 50 },
  { planId: "stratholme-service", key: wing(329, "service"), instanceId: 329, bracket: "60", min: 60, max: 60, minutes: 45 }
];

/** Plan dungeons of levels 30-60 whose map id nobody has observed yet: no route can exist for them (a rated route needs its map id). */
export const SEASON2_WAITING: readonly { id: string; reason: string }[] = ["blackmaw-hold", "shapers-terrace"]
  .map(id => ({ id, reason: "Map id not known yet: add it to the reviewed rules before Season 2 starts" }));

/** Names of the last boss of a wing route, from ENDGAME_WINGS. */
const wingBosses = (route: EndgameRoute): readonly string[] => {
  const [map, w] = route.key.split(":");
  return (ENDGAME_WINGS[Number(map) as keyof typeof ENDGAME_WINGS] as readonly (readonly [string, readonly string[]])[] | undefined)?.find(([name]) => name === w)?.[1] ?? [];
};

/** The Season 2 route definitions (version 6 route objects) for every endgame route. */
export function season2EndgameRoutes(): BracketRoute[] {
  const names = new Map(novemberDungeonCatalog().routes.map(r => [r.id, r.name]));
  return SEASON2_ENDGAME_ROUTES.map((spec): BracketRoute => {
    const bosses = spec.finalBoss ? [] : wingBosses(spec);
    if (!spec.finalBoss && !bosses.length) throw new Error(`Route ${spec.key} has no last-boss names`);
    const band = { min: spec.min, max: spec.max, difficultyId: 0 };
    return {
      dungeonKey: spec.key, instanceId: spec.instanceId, name: names.get(spec.planId) ?? spec.planId,
      completion: { ids: [], names: [...bosses] }, requiredEncounters: [],
      ...(spec.finalBoss ? { completionModel: "addon-final-boss" as const } : {}),
      routeStandard: spec.finalBoss ? "Final boss detected by the addon (Encounter Journal)" : "Last boss of the wing, by name, inside the run",
      participationBand: band, competitionBand: { ...band }, targetSec: spec.minutes * 60,
      verification: { build: "provisional", runRef: ENDGAME_RUN_REF }
    };
  });
}

/** Default brackets Season 2 adds when the base rules lack them: best-N is capped by the routes that exist (a bracket needs that many). */
export function season2EndgameBrackets(routes: readonly Pick<BracketRoute, "competitionBand">[]) {
  return DEFAULT_DUNGEON_BRACKETS.flatMap(b => {
    const count = routes.filter(r => r.competitionBand && r.competitionBand.min >= b.min && r.competitionBand.max <= b.max).length;
    return count ? [{ ...b, bestCount: Math.min(b.bestCount, count) }] : [];
  });
}
