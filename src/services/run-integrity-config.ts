import type { PlausibilityLimits } from "./run-plausibility.js";

// Server-side settings read from the environment.

export interface RunIntegrityConfig {
  limits: PlausibilityLimits | null;
  weights: Record<string, number>;
  defaultWeight: number;
  holdScore: number;
  deviceStrikes: number;
  challengeWindowSec: number | null;
  clockSlackSec: number | null;
  requireSeal: boolean;
  strikeWindowSec: number | null;
  /** Runs one PC may place on the public boards for players near it, per day. */
  relayedRunsPerDay: number;
  /** Runs made with other guilds' members: at most this many other guilds get a copy of one run. */
  crossGuildMaxGuilds: number;
  /** ... and only a run at least this many players' addons reported. */
  crossGuildMinReporters: number;
}

export const DEFAULT_CONFIG: RunIntegrityConfig = {
  limits: null, weights: {}, defaultWeight: 0, holdScore: Infinity, deviceStrikes: Infinity, challengeWindowSec: null, clockSlackSec: null, requireSeal: false, strikeWindowSec: null, relayedRunsPerDay: 60, crossGuildMaxGuilds: 6, crossGuildMinReporters: 1
};

const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

let warnedJson = false;
let warnedMissing = false;
let warnedSecret = false;

/** The settings from a JSON text. */
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
  for (const name of ["levelCap", "minSecondsPerBoss", "killSlackSec", "recordShare", "recordSample", "travelSec", "overlapSlackSec", "reachSec", "sharedPlayers", "endSpreadSec"] as const) {
    const value = num(given[name]);
    if (value !== undefined) limits[name] = value;
  }
  const weights = Object.fromEntries(Object.entries((raw["weights"] && typeof raw["weights"] === "object" ? raw["weights"] : {}) as Record<string, unknown>)
    .flatMap(([code, weight]) => num(weight) !== undefined ? [[code, weight as number] as const] : []));
  return {
    limits: Object.keys(limits).length ? limits : null, weights,
    defaultWeight: num(raw["defaultWeight"]) ?? 0,
    holdScore: num(raw["holdScore"]) ?? Infinity,
    deviceStrikes: num(raw["deviceStrikes"]) ?? Infinity,
    challengeWindowSec: num(raw["challengeWindowSec"]) ?? null,
    clockSlackSec: num(raw["clockSlackSec"]) ?? null,
    requireSeal: raw["requireSeal"] === true,
    strikeWindowSec: num(raw["strikeWindowSec"]) ?? null,
    relayedRunsPerDay: num(raw["relayedRunsPerDay"]) ?? DEFAULT_CONFIG.relayedRunsPerDay,
    crossGuildMaxGuilds: num(raw["crossGuildMaxGuilds"]) ?? DEFAULT_CONFIG.crossGuildMaxGuilds,
    crossGuildMinReporters: num(raw["crossGuildMinReporters"]) ?? DEFAULT_CONFIG.crossGuildMinReporters
  };
}

let cached: { text: string | undefined; value: RunIntegrityConfig } | null = null;
/** The live settings. */
export function integrityConfig(env: NodeJS.ProcessEnv = process.env): RunIntegrityConfig {
  const text = env["RUN_INTEGRITY_CONFIG"];
  if (!text && !warnedMissing) { warnedMissing = true; console.warn("RUN_INTEGRITY_CONFIG is not set."); }
  if (!cached || cached.text !== text) cached = { text, value: parseIntegrityConfig(text) };
  return cached.value;
}

/** The challenge secret, or null. */
export const challengeSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const secret = env["RUN_CHALLENGE_SECRET"];
  if (secret && secret.length < 16) {
    if (!warnedSecret) { warnedSecret = true; console.warn("RUN_CHALLENGE_SECRET is too short; it is ignored."); }
    return null;
  }
  return secret || null;
};

/** Whether a run is held. */
export function holdsRun(codes: readonly string[], config: RunIntegrityConfig, strikes: number): boolean {
  if (!codes.length) return false;
  const score = codes.reduce((sum, code) => sum + (config.weights[code] ?? config.defaultWeight), 0);
  return score >= config.holdScore || strikes >= config.deviceStrikes;
}
