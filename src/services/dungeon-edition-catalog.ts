import { dungeonCatalog } from "../../companion/dungeon-catalog.mjs";
import type { GameEdition } from "./game-edition.js";
import { createBracketedDungeonRules } from "./dungeon-november-rules.js";
import { MIDNIGHT_S2_RATING_V2 } from "./challenge-rating-rules.js";

/** Source-reviewed endpoints and explicitly provisional design targets, frozen per season. */
export function editionDungeonRules(edition: Exclude<GameEdition, "forever">) {
  const ranges = edition === "classic-era" ? [[15,29,5],[30,44,5],[45,59,3],[60,60,8]]
    : edition === "classic-tbc" ? [[15,29,5],[30,44,5],[45,59,3],[60,70,8]]
    : edition === "classic-mists" ? [[30,39,2],[40,59,1],[85,89,4],[90,90,8]] : [[90,90,8]];
  return createBracketedDungeonRules({ gameEdition: edition,
    ...(edition === "retail" ? { keystoneRating: MIDNIGHT_S2_RATING_V2 } : {}),
    brackets: ranges.map(([min,max,bestCount]) => ({key: `${min}-${max}`, min,max,bestCount})),
    provisional: { plan: dungeonCatalog.revision, waiting: [] },
    routes: dungeonCatalog.routes.filter(r => r.edition === edition).map(r => ({
      dungeonKey: r.dungeonKey, instanceId: r.instanceId, name: r.name,
      completion: r.completion, requiredEncounters: r.requiredEncounters,
      routeStandard: "First combat to the listed final boss, with every listed checkpoint in this attempt. Optional bosses and trash are not required. Design target; client confirmation pending.",
      participationBand: { min: r.min, max: r.max, difficultyId: r.difficultyId },
      competitionBand: { min: r.min, max: r.max, difficultyId: r.difficultyId }, targetSec: r.targetSec,
      verification: { build: "DBM source d989f711", runRef: `${dungeonCatalog.revision}/${r.dungeonKey}`,
        method: "source-reviewed", sources: r.sourceFiles.map(p => `${dungeonCatalog.source}/${p}`) }
    })) });
}
