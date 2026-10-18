import { z } from "zod";

// Version 5 is opt-in. No default preset, database access or season activation.
export const novemberDungeonKey = (key: string): boolean => /^[1-9]\d{0,5}(?::[a-z][a-z0-9-]{0,39})?$/.test(key);
const identitySchema = z.object({
  ids: z.array(z.number().int().positive().max(1000000)).max(20),
  names: z.array(z.string().trim().min(1).max(100)).max(20)
}).refine(b => b.ids.length + b.names.length > 0, "Encounter evidence is required");
const bandSchema = z.object({ min: z.number().int().min(1).max(60), max: z.number().int().min(1).max(60), difficultyId: z.number().int().min(0) })
  .refine(b => b.min <= b.max);
const routeSchema = z.object({
  dungeonKey: z.string().refine(novemberDungeonKey), instanceId: z.number().int().positive().max(999999),
  name: z.string().trim().min(1).max(100),
  completion: identitySchema, requiredEncounters: z.array(identitySchema).max(40),
  routeStandard: z.string().trim().min(1).max(500),
  participationBand: bandSchema,
  targetSec: z.number().int().min(1).max(14400).nullable(),
  verification: z.object({ build: z.string().trim().min(1).max(100), runRef: z.string().trim().min(1).max(100) })
});
export type NovemberRoute = z.infer<typeof routeSchema>;
type EncounterIdentity = NovemberRoute["completion"];
const normalize = (name: string) => name.trim().normalize("NFC").toLowerCase();
const tokens = (b: EncounterIdentity) => [...b.ids.map(id => `id:${id}`), ...b.names.map(n => `name:${normalize(n)}`)];

export function validatedNovemberRoutes(value: unknown): NovemberRoute[] {
  const routes = checkedRoutes(z.array(routeSchema).min(8).max(100).parse(value));
  if (routes.filter(r => r.targetSec !== null).length < 8) throw new Error("At least eight calibrated rated routes are required");
  return routes;
}

function checkedRoutes<T extends NovemberRoute>(routes: T[]): T[] {
  const keys = new Set<string>();
  const evidenceOwners = new Map<string, string>();
  for (const r of routes) {
    if (Number(r.dungeonKey.split(":")[0]) !== r.instanceId || keys.has(r.dungeonKey)) throw new Error("Duplicate or mismatched route key");
    keys.add(r.dungeonKey);
    // A shared map must use explicit wing keys for every registered route.
    if (routes.filter(other => other.instanceId === r.instanceId).length > 1 && !r.dungeonKey.includes(":")) throw new Error("Shared maps require wing keys");
    for (const token of [r.completion, ...r.requiredEncounters].flatMap(tokens)) {
      const key = `${r.instanceId}/${token}`;
      const owner = evidenceOwners.get(key);
      if (owner && owner !== r.dungeonKey) throw new Error("Encounter evidence is shared by different wings");
      evidenceOwners.set(key, r.dungeonKey);
    }
  }
  return routes;
}

export function createNovemberDungeonRules(input: unknown) {
  const routes = validatedNovemberRoutes(input);
  const rated = routes.filter(r => r.targetSec !== null);
  return {
    version: 5, model: "distinct-dungeons", pointsPerDungeon: 200, speedBonus: 0,
    minimumPresence: 0.8, automaticCompletionOnly: true, minimumScore: 50, maximumScore: 400,
    bestCount: 8, competitionLevel: 60, participationModel: "weekly-variety-v1",
    routeEvidenceVersion: 1, routes,
    targets: Object.fromEntries(rated.map(r => [r.dungeonKey, r.targetSec!])),
    levelBands: Object.fromEntries(rated.map(r => [r.dungeonKey, { min: 60, max: 60, difficultyId: r.participationBand.difficultyId }])),
    participationLevelBands: Object.fromEntries(routes.map(r => [r.dungeonKey, { ...r.participationBand }])),
    catalog: rated.map(r => ({ dungeonKey: r.dungeonKey, instanceId: r.instanceId, name: r.name, targetSec: r.targetSec!, minLevel: 60, maxLevel: 60 }))
  };
}
export type NovemberRules = ReturnType<typeof createNovemberDungeonRules>;

export function validNovemberRules(value: unknown): value is NovemberRules {
  if (!value || typeof value !== "object") return false;
  const r = value as NovemberRules;
  try {
    const expected = createNovemberDungeonRules(r.routes);
    for (const field of ["version", "model", "pointsPerDungeon", "speedBonus", "minimumPresence", "automaticCompletionOnly",
      "minimumScore", "maximumScore", "bestCount", "competitionLevel", "participationModel", "routeEvidenceVersion"] as const) {
      if (r[field] !== expected[field]) return false;
    }
    for (const field of ["targets", "levelBands", "participationLevelBands"] as const) {
      if (!r[field] || Array.isArray(r[field]) || Object.keys(r[field]).length !== Object.keys(expected[field]).length) return false;
      for (const [key, expectedValue] of Object.entries(expected[field])) {
        const actual = (r[field] as Record<string, unknown>)[key];
        if (typeof expectedValue === "number" ? actual !== expectedValue : !actual || typeof actual !== "object"
          || Object.entries(expectedValue).some(([k, v]) => (actual as Record<string, unknown>)[k] !== v)) return false;
      }
    }
    return true;
  } catch { return false; }
}

// Version 6: one season for every level. Brackets are owner settings; this
// module only freezes them. No default season, targets or activation.
// Owner's choice (18 October 2026): these limits, and fewer counted routes below
// 60, where each bracket has fewer dungeons (estimated from the usual level ranges).
export const DEFAULT_DUNGEON_BRACKETS = [
  { key: "15-29", min: 15, max: 29, bestCount: 5 }, { key: "30-44", min: 30, max: 44, bestCount: 5 },
  { key: "45-59", min: 45, max: 59, bestCount: 4 }, { key: "60", min: 60, max: 60, bestCount: 8 }
] as const;
const bracketSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,19}$/), min: z.number().int().min(1).max(60),
  max: z.number().int().min(1).max(60), bestCount: z.number().int().min(1).max(20) }).refine(b => b.min <= b.max);
export type DungeonBracket = z.infer<typeof bracketSchema>;
// A group a few levels above a route's band still scores, minus a share per level
// of the highest participant; beyond maxLevels it is a carry and scores 0.
export const DEFAULT_OVERLEVEL_PENALTY = { percentPerLevel: 10, maxLevels: 3 } as const;
const penaltySchema = z.object({ percentPerLevel: z.number().int().min(0).max(30), maxLevels: z.number().int().min(0).max(5) })
  .refine(p => p.percentPerLevel * p.maxLevels < 100, "The penalty must leave some points");
export type OverlevelPenalty = z.infer<typeof penaltySchema>;
const bracketRouteSchema = routeSchema.extend({ competitionBand: bandSchema.nullable() })
  .refine(r => (r.targetSec === null) === (r.competitionBand === null), "Rated routes need a competition band; participation-only routes have none");
export type BracketRoute = z.infer<typeof bracketRouteSchema>;

export function bracketForLevel(brackets: readonly DungeonBracket[], level: unknown): DungeonBracket | undefined {
  return Number.isInteger(level) ? brackets.find(b => b.min <= (level as number) && (level as number) <= b.max) : undefined;
}

export function createBracketedDungeonRules(input: unknown) {
  const parsed = z.object({ routes: z.array(bracketRouteSchema).min(1).max(100), brackets: z.array(bracketSchema).min(1).max(10),
    overlevelPenalty: penaltySchema.default({ ...DEFAULT_OVERLEVEL_PENALTY }) }).parse(input);
  const routes = checkedRoutes(parsed.routes);
  const brackets = [...parsed.brackets].sort((a, b) => a.min - b.min);
  if (new Set(brackets.map(b => b.key)).size !== brackets.length || brackets.some((b, i) => i > 0 && b.min <= brackets[i - 1]!.max)) {
    throw new Error("Brackets must have distinct keys and must not overlap");
  }
  const rated = routes.filter(r => r.targetSec !== null);
  const routeBracket: Record<string, string> = {};
  for (const r of rated) {
    const band = r.competitionBand!;
    const bracket = brackets.find(b => b.min <= band.min && band.max <= b.max);
    if (!bracket) throw new Error(`Route ${r.dungeonKey}'s competition band is not inside one bracket`);
    routeBracket[r.dungeonKey] = bracket.key;
  }
  for (const b of brackets) {
    if (rated.filter(r => routeBracket[r.dungeonKey] === b.key).length < b.bestCount) throw new Error(`Bracket ${b.key} needs at least ${b.bestCount} rated routes`);
  }
  return {
    version: 6, model: "distinct-dungeons", pointsPerDungeon: 200, speedBonus: 0,
    minimumPresence: 0.8, automaticCompletionOnly: true, minimumScore: 50, maximumScore: 400,
    participationModel: "weekly-variety-v1", routeEvidenceVersion: 1, routes, brackets, routeBracket, overlevelPenalty: { ...parsed.overlevelPenalty },
    targets: Object.fromEntries(rated.map(r => [r.dungeonKey, r.targetSec!])),
    levelBands: Object.fromEntries(rated.map(r => [r.dungeonKey, { ...r.competitionBand! }])),
    participationLevelBands: Object.fromEntries(routes.map(r => [r.dungeonKey, { ...r.participationBand }])),
    catalog: rated.map(r => ({ dungeonKey: r.dungeonKey, instanceId: r.instanceId, name: r.name, targetSec: r.targetSec!,
      minLevel: r.competitionBand!.min, maxLevel: r.competitionBand!.max, bracket: routeBracket[r.dungeonKey]! }))
  };
}
export type BracketedRules = ReturnType<typeof createBracketedDungeonRules>;

/** A stored version 6 rule set must equal what its own routes and brackets produce. */
export function validBracketedRules(value: unknown): value is BracketedRules {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 6) return false;
  const r = value as BracketedRules;
  try {
    return sameJson(r, createBracketedDungeonRules({ routes: r.routes, brackets: r.brackets, overlevelPenalty: r.overlevelPenalty ?? null }));
  } catch { return false; }
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && kb.every(k => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
/** Either route-evidence model (version 5 level 60, version 6 brackets). */
export function validRouteRules(value: unknown): value is NovemberRules | BracketedRules {
  return validNovemberRules(value) || validBracketedRules(value);
}

interface EvidenceRun { instanceId: number; startedAt?: Date | null; endedAt?: Date | null; competitionData?: unknown }
type Encounter = { id?: number; name?: string; at?: number; success?: boolean };
function matches(b: EncounterIdentity, e: Encounter): boolean {
  return (typeof e.id === "number" && b.ids.includes(e.id)) || (typeof e.name === "string" && b.names.some(n => normalize(n) === normalize(e.name!)));
}
/** Only timestamped successful encounters inside this run can establish a route. */
export function resolveNovemberRoute(run: EvidenceRun, rules: { routes: NovemberRoute[] }): { key: string; route?: NovemberRoute; reason?: string } {
  const unknown = { key: String(run.instanceId), reason: "Dungeon route unknown" };
  const all = (run.competitionData as { encounters?: Encounter[] } | null)?.encounters;
  if (!run.startedAt || !run.endedAt || !Array.isArray(all)) return unknown;
  const encounters = all.filter(e => e && e.success === true && Number.isInteger(e.at)
    && e.at! >= run.startedAt!.getTime() / 1000 && e.at! <= run.endedAt!.getTime() / 1000);
  const candidates = rules.routes.filter(r => r.instanceId === run.instanceId
    && [r.completion, ...r.requiredEncounters].some(b => encounters.some(e => matches(b, e))));
  if (candidates.length !== 1) return unknown;
  const route = candidates[0]!;
  if (!encounters.some(e => matches(route.completion, e)) || route.requiredEncounters.some(b => !encounters.some(e => matches(b, e)))) {
    return { key: route.dungeonKey, route, reason: "Required encounter evidence missing" };
  }
  return { key: route.dungeonKey, route };
}
