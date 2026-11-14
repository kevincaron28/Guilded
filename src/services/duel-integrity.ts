import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";

// Server-side checks on duel reports. The thresholds and which checks are required come from configuration (the environment variable
// DUEL_INTEGRITY_CONFIG, a JSON object), not from this file: the values below are neutral defaults. Which check held a record back is kept
// on the server and is never sent to a client. Held records stay out of every ladder until the owner reviews them.

export interface AnomalyLimits { pairMin: number; pairShare: number; rapidSeconds: number; rapidMin: number; fewOpponentsMin: number; fewOpponentsMax: number; streak: number }
export interface IntegrityConfig {
  /** How long a challenge issued to a device stays usable for the records made under it. */
  challengeWindowHours: number;
  requireChallenge: boolean; requireChain: boolean; requireEvidence: boolean;
  /** A record with at least this many flags is held. */
  holdAt: number;
  /** A device with at least this many held records holds everything it sends next. */
  deviceHoldAfter: number;
  evidenceSlackSec: number;
  anomaly: AnomalyLimits;
}

export const DEFAULT_INTEGRITY: IntegrityConfig = {
  challengeWindowHours: 72, requireChallenge: false, requireChain: false, requireEvidence: false, holdAt: 2, deviceHoldAfter: 3, evidenceSlackSec: 5,
  anomaly: { pairMin: 12, pairShare: 0.92, rapidSeconds: 15, rapidMin: 4, fewOpponentsMin: 12, fewOpponentsMax: 2, streak: 20 }
};

/** The defaults, overridden by the JSON in the environment (numbers and booleans of known names only; anything else is ignored). */
export function loadIntegrityConfig(env: Record<string, string | undefined> = process.env): IntegrityConfig {
  const out: IntegrityConfig = { ...DEFAULT_INTEGRITY, anomaly: { ...DEFAULT_INTEGRITY.anomaly } };
  let raw: unknown;
  try { raw = env["DUEL_INTEGRITY_CONFIG"] ? JSON.parse(env["DUEL_INTEGRITY_CONFIG"]) : null; } catch { return out; }
  if (!raw || typeof raw !== "object") return out;
  const given = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_INTEGRITY) as (keyof IntegrityConfig)[]) {
    if (key === "anomaly") continue;
    const value = given[key];
    if (typeof value === typeof DEFAULT_INTEGRITY[key] && (typeof value !== "number" || Number.isFinite(value))) (out as unknown as Record<string, unknown>)[key] = value;
  }
  const anomaly = given["anomaly"];
  if (anomaly && typeof anomaly === "object") for (const key of Object.keys(DEFAULT_INTEGRITY.anomaly) as (keyof AnomalyLimits)[]) {
    const value = (anomaly as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) out.anomaly[key] = value;
  }
  return out;
}

/** What the addon records around a real duel (the system messages and the zones), checked together. */
export interface DuelEvidence { countdownAt?: number; startAt?: number; endAt?: number; zoneWinner?: string; zoneLoser?: string }
export interface ChainFields { winner: string; winnerRealm?: string | undefined; loser: string; loserRealm?: string | undefined; at: number; reason: string; seq?: number | undefined }
export const CHAIN_START = "0000000000000000";

/** One link of the hash chain: it ties a record to the challenge it was made under and to the record before it. */
export const chainHash = (prev: string, nonce: string, d: ChainFields) =>
  createHash("sha256").update([prev, nonce, d.seq ?? 0, d.winner, d.winnerRealm ?? "", d.loser, d.loserRealm ?? "", d.at, d.reason].join("|")).digest("hex").slice(0, 16);

export interface RecordCheck {
  record: ChainFields & { nonce?: string | undefined; prev?: string | undefined; chain?: string | undefined; durationSec?: number | undefined; evidence?: DuelEvidence | undefined };
  /** The device's latest stored link (null = none yet). */
  lastChain: string | null;
  /** When the challenge named by the record was issued to this device (null = no such challenge). */
  challengeIssuedAt: Date | null;
  cfg: IntegrityConfig;
  now: Date;
}

/** The opaque flags a record trips (empty = nothing found). Codes are short on purpose; they are stored for the reviewer, never sent out. */
export function checkRecord(input: RecordCheck): string[] {
  const { record: r, cfg } = input, flags: string[] = [];
  const endMs = r.at * 1000;
  if (r.nonce) {
    const issued = input.challengeIssuedAt;
    if (!issued || endMs < issued.getTime() - 60_000 || endMs > issued.getTime() + cfg.challengeWindowHours * 3_600_000) flags.push("n");
  } else if (cfg.requireChallenge) flags.push("n");
  if (r.chain) {
    if (!r.nonce || !r.prev || chainHash(r.prev, r.nonce, r) !== r.chain || (input.lastChain && r.prev !== input.lastChain)) flags.push("c");
  } else if (cfg.requireChain) flags.push("c");
  const e = r.evidence;
  if (e) {
    const slack = cfg.evidenceSlackSec;
    const bad = (e.startAt !== undefined && e.endAt !== undefined && e.endAt < e.startAt)
      || (e.countdownAt !== undefined && e.startAt !== undefined && (e.startAt < e.countdownAt || e.startAt - e.countdownAt > 30 + slack))
      || (e.endAt !== undefined && Math.abs(e.endAt - r.at) > 30 + slack)
      || (e.startAt !== undefined && e.endAt !== undefined && r.durationSec !== undefined && r.durationSec > 0 && Math.abs((e.endAt - e.startAt) - r.durationSec) > slack)
      || (!!e.zoneWinner && !!e.zoneLoser && e.zoneWinner.toLowerCase() !== e.zoneLoser.toLowerCase());
    if (bad) flags.push("e");
  } else if (cfg.requireEvidence) flags.push("e");
  return flags;
}

type Tx = Prisma.TransactionClient;
/** At each sync the bot hands the companion a fresh challenge; the companion passes it to the addon, which puts it on every record it makes next. */
export async function issueDuelChallenge(db: Pick<Tx, "duelChallenge">, deviceId: string, now = new Date()): Promise<string> {
  const nonce = randomBytes(12).toString("hex");
  await db.duelChallenge.create({ data: { deviceId, nonce, issuedAt: now } });
  await db.duelChallenge.deleteMany({ where: { deviceId, issuedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } } });
  return nonce;
}
