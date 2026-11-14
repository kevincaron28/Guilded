import type { PlausibilityLimits } from "./run-plausibility.js";

// Server-side settings for run records, read from the environment: RUN_INTEGRITY_CONFIG (a JSON object) and RUN_CHALLENGE_SECRET.
// Nothing here has a numeric default; a value that is not set switches what depends on it off.

export interface RunIntegrityConfig {
  limits: PlausibilityLimits | null;
  weights: Record<string, number>;
  defaultWeight: number;
  holdScore: number;
  deviceStrikes: number;
  challengeWindowSec: number | null;
  clockSlackSec: number | null;
  requireSeal: boolean;
}

export const DEFAULT_CONFIG: RunIntegrityConfig = {
  limits: null, weights: {}, defaultWeight: 0, holdScore: Infinity, deviceStrikes: Infinity, challengeWindowSec: null, clockSlackSec: null, requireSeal: false
};

const num = (value: unknown, min: number, max: number): number | undefined => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;

let warnedJson = false;
let warnedMissing = false;
let warnedSecret = false;

/** The configuration from a JSON text. */
export function parseIntegrityConfig(text: string | undefined): RunIntegrityConfig {
  if (!text) return DEFAULT_CONFIG;
  let raw: Record<string, unknown> | null;
  try { raw = JSON.parse(text) as Record<string, unknown>; } catch { raw = null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (!warnedJson) { warnedJson = true; console.warn("RUN_INTEGRITY_CONFIG is not a valid JSON object; it is ignored."); }
    return DEFAULT_CONFIG;
  }
  const given = (raw["limits"] && typeof raw["limits"] === "object" ? raw["limits"] : {}) as Record<string, unknown>;
  const limits: PlausibilityLimits = {};
  for (const name of ["levelCap", "minSecondsPerBoss", "killSlackSec", "recordShare", "recordSample", "travelSec", "overlapSlackSec"] as const) {
    const value = num(given[name], 0, 1_000_000);
    if (value !== undefined) limits[name] = value;
  }
  const weights = Object.fromEntries(Object.entries((raw["weights"] && typeof raw["weights"] === "object" ? raw["weights"] : {}) as Record<string, unknown>)
    .flatMap(([code, weight]) => typeof weight === "number" && Number.isFinite(weight) ? [[code, Math.min(100, Math.max(0, weight))] as const] : []));
  return {
    limits: Object.keys(limits).length ? limits : null, weights,
    defaultWeight: num(raw["defaultWeight"], 0, 100) ?? 0,
    holdScore: num(raw["holdScore"], 1, 1000) ?? Infinity,
    deviceStrikes: num(raw["deviceStrikes"], 1, 1000) ?? Infinity,
    challengeWindowSec: num(raw["challengeWindowSec"], 60, 365 * 86_400) ?? null,
    clockSlackSec: num(raw["clockSlackSec"], 0, 7 * 86_400) ?? null,
    requireSeal: raw["requireSeal"] === true
  };
}

let cached: { text: string | undefined; value: RunIntegrityConfig } | null = null;
/** The live configuration (read from the environment, cached per value). */
export function integrityConfig(env: NodeJS.ProcessEnv = process.env): RunIntegrityConfig {
  const text = env["RUN_INTEGRITY_CONFIG"];
  if (!text && !warnedMissing) { warnedMissing = true; console.warn("RUN_INTEGRITY_CONFIG is not set."); }
  if (!cached || cached.text !== text) cached = { text, value: parseIntegrityConfig(text) };
  return cached.value;
}

/** The server secret for challenges; without a usable one challenges are off. */
export const challengeSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const secret = env["RUN_CHALLENGE_SECRET"];
  if (secret && secret.length < 16) {
    if (!warnedSecret) { warnedSecret = true; console.warn("RUN_CHALLENGE_SECRET is too short; it is ignored."); }
    return null;
  }
  return secret || null;
};

/** Whether a run is held for review under this configuration. */
export function holdsRun(codes: readonly string[], config: RunIntegrityConfig, strikes: number): boolean {
  if (!codes.length) return false;
  const score = codes.reduce((sum, code) => sum + (config.weights[code] ?? config.defaultWeight), 0);
  return score >= config.holdScore || strikes >= config.deviceStrikes;
}
