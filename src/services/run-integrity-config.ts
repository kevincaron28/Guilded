import { PLAUSIBILITY, type PlausibilityLimits } from "./run-plausibility.js";

// Server-side configuration of the run checks. The live values come from the environment (RUN_INTEGRITY_CONFIG, a JSON object, and
// RUN_CHALLENGE_SECRET); the numbers here are safe defaults only. Nothing from this module is ever shown to members.

export interface RunIntegrityConfig {
  limits: PlausibilityLimits;
  /** Weight of each check code; a code not listed weighs `defaultWeight`. */
  weights: Record<string, number>;
  defaultWeight: number;
  /** A run whose weights add up to this much is held for review. */
  holdScore: number;
  /** A PC with this many held runs in the last 7 days has every further flagged run held. */
  deviceStrikes: number;
  /** How long a challenge stays usable for the runs made after it, in seconds. */
  challengeWindowSec: number;
  /** Runs without the new record format count as flagged when true (set once the addon release is out). */
  requireSeal: boolean;
}

export const DEFAULT_CONFIG: RunIntegrityConfig = {
  limits: PLAUSIBILITY,
  weights: {},
  defaultWeight: 1,
  holdScore: 3,
  deviceStrikes: 3,
  challengeWindowSec: 14 * 86_400,
  requireSeal: false
};

const number = (value: unknown, fallback: number, min: number, max: number): number => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** The configuration from a JSON text; anything missing or out of range keeps its default. */
export function parseIntegrityConfig(text: string | undefined): RunIntegrityConfig {
  if (!text) return DEFAULT_CONFIG;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text) as Record<string, unknown>; } catch { return DEFAULT_CONFIG; }
  if (!raw || typeof raw !== "object") return DEFAULT_CONFIG;
  const given = (raw["limits"] && typeof raw["limits"] === "object" ? raw["limits"] : {}) as Record<string, unknown>;
  const limits = Object.fromEntries(Object.entries(PLAUSIBILITY).map(([name, fallback]) => [name, number(given[name], fallback as number, 0, 1_000_000)])) as unknown as PlausibilityLimits;
  const weights = Object.fromEntries(Object.entries((raw["weights"] && typeof raw["weights"] === "object" ? raw["weights"] : {}) as Record<string, unknown>)
    .flatMap(([code, weight]) => typeof weight === "number" && Number.isFinite(weight) ? [[code, Math.min(100, Math.max(0, weight))] as const] : []));
  return {
    limits, weights,
    defaultWeight: number(raw["defaultWeight"], DEFAULT_CONFIG.defaultWeight, 0, 100),
    holdScore: number(raw["holdScore"], DEFAULT_CONFIG.holdScore, 1, 1000),
    deviceStrikes: number(raw["deviceStrikes"], DEFAULT_CONFIG.deviceStrikes, 1, 1000),
    challengeWindowSec: number(raw["challengeWindowSec"], DEFAULT_CONFIG.challengeWindowSec, 60, 365 * 86_400),
    requireSeal: raw["requireSeal"] === true
  };
}

let cached: { text: string | undefined; value: RunIntegrityConfig } | null = null;
/** The live configuration (read from the environment, cached per value). */
export function integrityConfig(env: NodeJS.ProcessEnv = process.env): RunIntegrityConfig {
  const text = env["RUN_INTEGRITY_CONFIG"];
  if (!cached || cached.text !== text) cached = { text, value: parseIntegrityConfig(text) };
  return cached.value;
}

/** The server secret that issues challenges; without it challenges are off (nothing is issued, nothing checked). */
export const challengeSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const secret = env["RUN_CHALLENGE_SECRET"];
  return secret && secret.length >= 16 ? secret : null;
};

/** Whether a set of flags holds a run for review: the weights add up to the hold score, or the PC already has strikes. */
export function holdsRun(codes: readonly string[], config: RunIntegrityConfig, strikes: number): boolean {
  if (!codes.length) return false;
  const score = codes.reduce((sum, code) => sum + (config.weights[code] ?? config.defaultWeight), 0);
  return score >= config.holdScore || strikes >= config.deviceStrikes;
}
