import { createBracketedDungeonRules, createNovemberDungeonRules, type BracketRoute, type NovemberRoute } from "../../src/services/dungeon-november-rules.js";
import type { RatingRun } from "../../src/services/dungeon-rating.js";

// Entirely synthetic IDs, names, difficulty and targets. Not game mappings.
export function novemberFixtures(): NovemberRoute[] {
  return ["90001:east", "90001:north", "90001:west", "90002:main", "90002:service", "90003:lower", "90003:upper", "90004", "90005", "90006", "90007"].map((key, i) => ({
    dungeonKey: key, instanceId: Number(key.split(":")[0]), name: `Fixture ${key}`,
    completion: { ids: [9000 + i * 2], names: [`Fixture final ${i}`, `Boss final fictif ${i}`] },
    requiredEncounters: [{ ids: [9001 + i * 2], names: [`Fixture required ${i}`] }],
    routeStandard: "Synthetic two-encounter test route; no game claim",
    participationBand: { min: key === "90006" ? 10 : 50, max: key === "90006" ? 20 : 60, difficultyId: 7 },
    targetSec: ["90003:upper", "90006"].includes(key) ? null : 1800,
    verification: { build: "SYNTHETIC-TEST", runRef: "FIXTURE-ONLY" }
  }));
}
export const novemberRulesFixture = () => createNovemberDungeonRules(novemberFixtures());
export function novemberRun(index = 0, durationSec = 1800, level = 60): RatingRun {
  const route = novemberFixtures()[index]!;
  return { instanceId: route.instanceId, difficultyId: 7, dungeonName: "Untrusted free text", durationSec,
    runRef: `test-${index}-${durationSec}`, startedAt: new Date(1000000), endedAt: new Date((1000 + durationSec) * 1000),
    players: [{ memberId: "m", character: "Tester", member: { displayName: "Account" }, presentSec: durationSec }],
    competitionData: { players: [{ name: "Tester", level, minLevel: level }], encounters: [
      { id: route.requiredEncounters[0]!.ids[0], name: "Localized required", success: true, startedAt: 1001, at: 1011 },
      { id: route.completion.ids[0], name: "Localized endpoint", success: true, startedAt: 1020, at: 1030 }
    ] } };
}

// All-level (version 6) fixture: routes 0-3 have a 20-29 band, the other rated ones 60.
export const BRACKET_FIXTURE = [{ key: "15-29", min: 15, max: 29, bestCount: 3 }, { key: "60", min: 60, max: 60, bestCount: 4 }];
export function bracketFixtureRoutes(): BracketRoute[] {
  return novemberFixtures().map((r, i) => ({ ...r, competitionBand: r.targetSec === null ? null
    : i < 4 ? { min: 20, max: 29, difficultyId: 7 } : { min: 60, max: 60, difficultyId: 7 } }));
}
export const bracketRulesFixture = () => createBracketedDungeonRules({ routes: bracketFixtureRoutes(), brackets: BRACKET_FIXTURE });
