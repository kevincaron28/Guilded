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
  const routes = z.array(routeSchema).min(8).max(100).parse(value);
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
  if (routes.filter(r => r.targetSec !== null).length < 8) throw new Error("At least eight calibrated rated routes are required");
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

interface EvidenceRun { instanceId: number; startedAt?: Date | null; endedAt?: Date | null; competitionData?: unknown }
type Encounter = { id?: number; name?: string; at?: number; success?: boolean };
function matches(b: EncounterIdentity, e: Encounter): boolean {
  return (typeof e.id === "number" && b.ids.includes(e.id)) || (typeof e.name === "string" && b.names.some(n => normalize(n) === normalize(e.name!)));
}
/** Only timestamped successful encounters inside this run can establish a route. */
export function resolveNovemberRoute(run: EvidenceRun, rules: NovemberRules): { key: string; route?: NovemberRoute; reason?: string } {
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
