import { z } from "zod";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import { challengeRatingSchema } from "./challenge-rating-rules.js";

// Version 5 is opt-in. No default preset, database access or season activation.
export const novemberDungeonKey = (key: string): boolean => /^[1-9]\d{0,5}(?::[a-z][a-z0-9-]{0,39})?$/.test(key);
const identityBase = z.object({
  ids: z.array(z.number().int().positive().max(1000000)).max(20),
  npcIds: z.array(z.number().int().positive().max(1000000)).max(20).optional(),
  names: z.array(z.string().trim().min(1).max(100)).max(20)
});
const identitySchema = identityBase.refine(b => b.ids.length + b.names.length + (b.npcIds?.length ?? 0) > 0, "Encounter evidence is required");
const bandSchema = z.object({ min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100), difficultyId: z.number().int().min(0) })
  .refine(b => b.min <= b.max);
const routeSchema = z.object({
  dungeonKey: z.string().refine(novemberDungeonKey), instanceId: z.number().int().positive().max(999999),
  name: z.string().trim().min(1).max(100),
  completion: identitySchema, requiredEncounters: z.array(identitySchema).max(40),
  routeStandard: z.string().trim().min(1).max(500),
  participationBand: bandSchema,
  targetSec: z.number().int().min(1).max(14400).nullable(),
  verification: z.object({ build: z.string().trim().min(1).max(100), runRef: z.string().trim().min(1).max(100),
    fullRoute: z.literal(true).optional(),
    method: z.literal("source-reviewed").optional(), sources: z.array(z.string().url()).max(40).optional() })
});
export type NovemberRoute = z.infer<typeof routeSchema>;
type EncounterIdentity = NovemberRoute["completion"];
const normalize = (name: string) => name.trim().normalize("NFC").toLowerCase();
const tokens = (b: EncounterIdentity) => [...b.ids.map(id => `id:${id}`), ...(b.npcIds ?? []).map(id => `npc:${id}`), ...b.names.map(n => `name:${normalize(n)}`)];

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
      const key = `${r.instanceId}/${r.participationBand.difficultyId}/${token}`;
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
const bracketSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,19}$/), min: z.number().int().min(1).max(100),
  max: z.number().int().min(1).max(100), bestCount: z.number().int().min(1).max(20) }).refine(b => b.min <= b.max);
export type DungeonBracket = z.infer<typeof bracketSchema>;
// A group a few levels above a route's band still scores, minus a share per level
// of the highest participant; beyond maxLevels it is a carry and scores 0.
export const DEFAULT_OVERLEVEL_PENALTY = { percentPerLevel: 10, maxLevels: 3 } as const;
const penaltySchema = z.object({ percentPerLevel: z.number().int().min(0).max(30), maxLevels: z.number().int().min(0).max(5) })
  .refine(p => p.percentPerLevel * p.maxLevels < 100, "The penalty must leave some points");
export type OverlevelPenalty = z.infer<typeof penaltySchema>;
// completionModel "addon-final-boss" (provisional seasons): the route is its whole map, completed
// when the addon detects the final boss from the Encounter Journal, as in the beta seasons. It has
// no encounter evidence and may not share its map with another route.
const bracketRouteSchema = routeSchema.extend({ competitionBand: bandSchema.nullable(), completion: identityBase,
  completionModel: z.literal("addon-final-boss").optional() })
  .refine(r => (r.targetSec === null) === (r.competitionBand === null), "Rated routes need a competition band; participation-only routes have none")
  .refine(r => r.completionModel === "addon-final-boss"
    ? r.completion.ids.length + r.completion.names.length + (r.completion.npcIds?.length ?? 0) === 0 && r.requiredEncounters.length === 0
    : r.completion.ids.length + r.completion.names.length + (r.completion.npcIds?.length ?? 0) > 0, "Encounter evidence is required (addon-final-boss routes have none)");
export type BracketRoute = z.infer<typeof bracketRouteSchema>;

export function bracketForLevel(brackets: readonly DungeonBracket[], level: unknown): DungeonBracket | undefined {
  return Number.isInteger(level) ? brackets.find(b => b.min <= (level as number) && (level as number) <= b.max) : undefined;
}

// A provisional season (owner, 18 October 2026: "use provisional recommendations until real timed
// runs exist") names its plan and the planned routes it could not include yet. An officer may later
// replace a route's target from real runs: each change applies to runs that END at or after `from`,
// so a score already earned keeps the target it was earned under.
const provisionalSchema = z.object({ plan: z.string().trim().min(1).max(60),
  waiting: z.array(z.object({ id: z.string().min(1).max(60), reason: z.string().min(1).max(120) })).max(60) });
const recalibrationSchema = z.object({ dungeonKey: z.string().refine(novemberDungeonKey), targetSec: z.number().int().min(60).max(14400),
  from: z.string().datetime(), runs: z.number().int().min(1).max(10000) });
export type TargetRecalibration = z.infer<typeof recalibrationSchema>;

export function createBracketedDungeonRules(input: unknown) {
  const parsed = z.object({ gameEdition: z.enum(GAME_EDITIONS).optional(), routes: z.array(bracketRouteSchema).max(100), brackets: z.array(bracketSchema).max(10),
    overlevelPenalty: penaltySchema.default({ ...DEFAULT_OVERLEVEL_PENALTY }),
    evidencePolicy: z.enum(["current-v1", "current-v2"]).optional(),
    seasonWindow: z.object({ from: z.string().datetime(), to: z.string().datetime().nullable() }).optional(),
    provisional: provisionalSchema.optional(), keystoneRating: challengeRatingSchema.optional(), recalibrations: z.array(recalibrationSchema).max(200).optional() }).refine(value => value.routes.length > 0 && value.brackets.length > 0
      || !!value.gameEdition && value.gameEdition !== "forever" && value.routes.length === 0 && value.brackets.length === 0, "A rated season needs routes and brackets").parse(input);
  const routes = checkedRoutes(parsed.routes);
  if (parsed.keystoneRating && parsed.gameEdition !== "retail") throw new Error("Keystone rating requires Retail");
  if (!parsed.provisional && routes.some(r => r.verification.method === "source-reviewed")) throw new Error("Source-reviewed routes require provisional benchmarks");
  for (const r of routes) if (r.completionModel && routes.some(o => o !== r && o.instanceId === r.instanceId)) throw new Error("A shared map needs encounter evidence for each route");
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
  const recalibrations = parsed.recalibrations;
  if (recalibrations && !parsed.provisional) throw new Error("Only a provisional season can recalibrate targets");
  for (const [i, c] of (recalibrations ?? []).entries()) {
    if (!rated.some(r => r.dungeonKey === c.dungeonKey)) throw new Error(`Route ${c.dungeonKey} is not rated`);
    if (i > 0 && Date.parse(c.from) < Date.parse(recalibrations![i - 1]!.from)) throw new Error("Recalibrations must be in time order");
  }
  // Current target: the latest recalibration, else the route's starting target.
  const current = (r: typeof rated[number]) => [...(recalibrations ?? [])].reverse().find(c => c.dungeonKey === r.dungeonKey)?.targetSec ?? r.targetSec!;
  const provisionalRoute = (key: string) => !!parsed.provisional && !(recalibrations ?? []).some(c => c.dungeonKey === key);
  return {
    version: 6, model: "distinct-dungeons", pointsPerDungeon: 200, speedBonus: 0,
    ...(parsed.gameEdition ? { gameEdition: parsed.gameEdition } : {}),
    ...(parsed.keystoneRating ? { keystoneRating: parsed.keystoneRating } : {}),
    ...(parsed.evidencePolicy ? { evidencePolicy: parsed.evidencePolicy } : {}),
    ...(parsed.seasonWindow ? { seasonWindow: parsed.seasonWindow } : {}),
    minimumPresence: 0.8, automaticCompletionOnly: true, minimumScore: 50, maximumScore: 400,
    participationModel: "weekly-variety-v1", routeEvidenceVersion: 1, routes, brackets, routeBracket, overlevelPenalty: { ...parsed.overlevelPenalty },
    ...(parsed.provisional ? { provisional: parsed.provisional, provisionalTargets: rated.some(r => provisionalRoute(r.dungeonKey)) } : {}),
    ...(recalibrations ? { recalibrations } : {}),
    targets: Object.fromEntries(rated.map(r => [r.dungeonKey, current(r)])),
    levelBands: Object.fromEntries(rated.map(r => [r.dungeonKey, { ...r.competitionBand! }])),
    participationLevelBands: Object.fromEntries(routes.map(r => [r.dungeonKey, { ...r.participationBand }])),
    catalog: rated.map(r => ({ dungeonKey: r.dungeonKey, instanceId: r.instanceId, name: r.name, targetSec: current(r),
      minLevel: r.competitionBand!.min, maxLevel: r.competitionBand!.max, bracket: routeBracket[r.dungeonKey]!,
      ...(parsed.provisional ? { provisional: provisionalRoute(r.dungeonKey) } : {}) }))
  };
}
export type BracketedRules = ReturnType<typeof createBracketedDungeonRules>;

/** The target a run is rated against: the one in force when it ended (the starting target when unknown). */
export function routeTargetAt(rules: BracketedRules, key: string, endedAt: Date | null | undefined): number | undefined {
  const route = rules.routes.find(r => r.dungeonKey === key);
  if (!route || route.targetSec === null) return undefined;
  const at = endedAt?.getTime();
  const change = at === undefined ? undefined : [...(rules.recalibrations ?? [])].reverse().find(c => c.dungeonKey === key && Date.parse(c.from) <= at);
  return change?.targetSec ?? route.targetSec;
}

/** A stored version 6 rule set must equal what its own routes and brackets produce. */
export function validBracketedRules(value: unknown): value is BracketedRules {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 6) return false;
  const r = value as BracketedRules;
  try {
    return sameJson(r, createBracketedDungeonRules({ ...(r.gameEdition ? { gameEdition: r.gameEdition } : {}), routes: r.routes, brackets: r.brackets, overlevelPenalty: r.overlevelPenalty ?? null,
      ...(r.keystoneRating !== undefined ? { keystoneRating: r.keystoneRating } : {}),
      ...(r.evidencePolicy !== undefined ? { evidencePolicy: r.evidencePolicy } : {}),
      ...(r.seasonWindow !== undefined ? { seasonWindow: r.seasonWindow } : {}),
      ...(r.provisional !== undefined ? { provisional: r.provisional } : {}), ...(r.recalibrations !== undefined ? { recalibrations: r.recalibrations } : {}) }));
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

interface EvidenceRun { instanceId: number; difficultyId?: number; startedAt?: Date | null; endedAt?: Date | null; competitionData?: unknown; completedBy?: string | null }
type Encounter = { id?: number; kind?: "npc"; name?: string; at?: number; success?: boolean };
function matches(b: EncounterIdentity, e: Encounter): boolean {
  if (e.kind === "npc") return typeof e.id === "number" && !!b.npcIds?.includes(e.id);
  return (typeof e.id === "number" && b.ids.includes(e.id)) || (typeof e.name === "string" && b.names.some(n => normalize(n) === normalize(e.name!)));
}
/** Only timestamped successful encounters inside this run can establish a route. */
export function resolveNovemberRoute(run: EvidenceRun, rules: { routes: NovemberRoute[] }): { key: string; route?: NovemberRoute; reason?: string } {
  const unknown = { key: String(run.instanceId), reason: "Dungeon route unknown" };
  const all = (run.competitionData as { encounters?: Encounter[] } | null)?.encounters;
  if (!run.startedAt || !run.endedAt || !Array.isArray(all)) return unknown;
  const encounters = all.filter(e => e && e.success === true && Number.isInteger(e.at)
    && e.at! >= run.startedAt!.getTime() / 1000 && e.at! <= run.endedAt!.getTime() / 1000);
  const finalBoss = (r: NovemberRoute) => (r as { completionModel?: string }).completionModel === "addon-final-boss";
  const candidates = rules.routes.filter(r => r.instanceId === run.instanceId
    && (run.difficultyId === undefined || r.participationBand.difficultyId === run.difficultyId)
    && (finalBoss(r) || [r.completion, ...r.requiredEncounters].some(b => encounters.some(e => matches(b, e)))));
  if (candidates.length !== 1) return unknown;
  const route = candidates[0]!;
  if (finalBoss(route)) return run.completedBy === "final boss" ? { key: route.dungeonKey, route } : { key: route.dungeonKey, route, reason: "Required encounter evidence missing" };
  if (!encounters.some(e => matches(route.completion, e)) || route.requiredEncounters.some(b => !encounters.some(e => matches(b, e)))) {
    return { key: route.dungeonKey, route, reason: "Required encounter evidence missing" };
  }
  return { key: route.dungeonKey, route };
}
