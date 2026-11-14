import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { RUN_TRUST, sameRun, type Statement } from "./run-trust.js";
import type { Anomaly } from "./run-plausibility.js";

// Challenge, record chain and signature helpers shared by the features whose records the addon writes and a PC uploads
// (dungeon runs, duels). The record layout is documented in the owner's private notes.

export interface Seal { n: number; nonce: string; prev: string; mac: string | null }
export const NO_PREV = "0".repeat(64);

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;
const whole = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "";
const text = (value: unknown): string => typeof value === "string" ? value : "";
const NONCE = /^[0-9a-z]{4,10}\.[0-9a-f]{24}$/;

/** The seal on a record, or null when there is none or it is malformed. */
export function sealOf(raw: unknown): Seal | null {
  const seal = record(record(record(raw)?.["integrity"])?.["seal"]);
  if (!seal || typeof seal["n"] !== "number" || !Number.isInteger(seal["n"]) || seal["n"] < 1) return null;
  if (typeof seal["nonce"] !== "string" || !NONCE.test(seal["nonce"]) || typeof seal["prev"] !== "string" || !/^[0-9a-f]{64}$/.test(seal["prev"])) return null;
  const mac = typeof seal["mac"] === "string" && /^[0-9a-f]{64}$/.test(seal["mac"]) ? seal["mac"] : null;
  return { n: seal["n"], nonce: seal["nonce"], prev: seal["prev"], mac };
}

/** One field per line in a fixed order, lists sorted, whole numbers. */
export function canonicalText(raw: unknown, seal: Pick<Seal, "n" | "nonce" | "prev">): string {
  const run = record(raw) ?? {};
  const players = (Array.isArray(run["players"]) ? run["players"] : []).flatMap((entry) => {
    const player = record(entry);
    return player && typeof player["character"] === "string" ? [`${player["character"]}:${whole(player["level"])}:${whole(player["deaths"])}:${whole(player["presentSec"])}`] : [];
  }).sort();
  const kills = (Array.isArray(run["encounters"]) ? run["encounters"] : []).flatMap((entry) => {
    const boss = record(entry);
    return boss && boss["success"] === true && typeof boss["id"] === "number" ? [`${whole(boss["id"])}@${whole(boss["at"])}`] : [];
  });
  return ["guilded-record-2", String(seal.n), seal.nonce, seal.prev, text(run["id"]), whole(run["instanceId"]), whole(run["difficultyId"]), whole(run["startedAt"]),
    whole(run["endedAt"]), text(run["state"]), text(run["completedBy"]), players.join(","), kills.join(",")].join("\n");
}

/** SHA-256 of a record's canonical text. */
export const chainHash = (canonical: string): string => createHash("sha256").update(canonical).digest("hex");

/** The signing key derived from a device key. */
export const deriveSealKey = (deviceKey: string): string => createHmac("sha256", deviceKey).update("guilded-record-signing-2").digest("hex");

export const sealMac = (sealKey: string, canonical: string): string => createHmac("sha256", sealKey).update(canonical).digest("hex");

const timed = (secret: string, deviceId: string, issued: string): string => createHmac("sha256", secret).update(`${issued}:${deviceId}`).digest("hex").slice(0, 24);

/** A challenge for this PC: its issue time plus a proof made with the server secret. */
export function issueChallenge(secret: string, deviceId: string, nowSec: number): string {
  const issued = Math.floor(nowSec).toString(36);
  return `${issued}.${timed(secret, deviceId, issued)}`;
}

/** The issue time (seconds) of a challenge this server issued to this PC, or null. */
export function challengeTime(secret: string, deviceId: string, nonce: string): number | null {
  const [issued, proof] = nonce.split(".");
  if (!issued || !proof || !NONCE.test(nonce)) return null;
  const expected = Buffer.from(timed(secret, deviceId, issued), "hex"), given = Buffer.from(proof, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const at = parseInt(issued, 36);
  return Number.isFinite(at) ? at : null;
}

export interface BatchContext {
  deviceId: string;
  /** Key derived from the device key sent with this upload (deriveSealKey); null when unknown. */
  sealKey: string | null;
  /** The challenge secret; null turns challenge handling off. */
  secret: string | null;
  windowSec: number | null;
  clockSlackSec: number | null;
  /** When this PC registered, in seconds. */
  deviceSince: number | null;
  requireSeal: boolean;
}

export interface BatchEntry { raw: unknown; ref: string; endedAt: number | null; kind: Statement["kind"]; earlier: boolean }

/** Check results for a batch of records, by reference. */
export function verifyBatch(entries: readonly BatchEntry[], context: BatchContext): Map<string, Anomaly[]> {
  const flags = new Map<string, Anomaly[]>();
  const add = (ref: string, code: string, detail: string) => { const list = flags.get(ref) ?? []; if (!list.some((flag) => flag.code === code)) list.push({ code, detail }); flags.set(ref, list); };
  const sealed: { entry: BatchEntry; seal: Seal; canonical: string }[] = [];
  for (const entry of entries) {
    if (entry.earlier) continue;
    const seal = sealOf(entry.raw);
    if (entry.kind !== "first-hand") continue;
    if (!seal) { if (context.requireSeal) add(entry.ref, "seal-missing", "no record seal"); continue; }
    const canonical = canonicalText(entry.raw, seal);
    if (context.sealKey) {
      if (!seal.mac) add(entry.ref, "seal-unsigned", "record not signed");
      else {
        const expected = Buffer.from(sealMac(context.sealKey, canonical), "hex"), given = Buffer.from(seal.mac, "hex");
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) add(entry.ref, "seal-invalid", "signature does not match");
      }
    }
    const before = context.deviceSince !== null && entry.endedAt !== null && entry.endedAt < context.deviceSince;
    if (context.secret && !before) {
      const issued = challengeTime(context.secret, context.deviceId, seal.nonce);
      if (issued === null) add(entry.ref, "nonce-foreign", "challenge not issued to this PC");
      else if (entry.endedAt !== null && context.clockSlackSec !== null && issued > entry.endedAt + context.clockSlackSec) add(entry.ref, "nonce-future", "challenge issued after the run ended");
      else if (entry.endedAt !== null && context.windowSec !== null && entry.endedAt - issued > context.windowSec) add(entry.ref, "nonce-window", "run ended long after its challenge was issued");
    }
    sealed.push({ entry, seal, canonical });
  }
  // Chain links.
  const hashesByNumber = new Map<number, Set<string>>();
  for (const item of sealed) hashesByNumber.set(item.seal.n, new Set([...(hashesByNumber.get(item.seal.n) ?? []), chainHash(item.canonical)]));
  for (const item of sealed) {
    const earlier = hashesByNumber.get(item.seal.n - 1);
    if (earlier && !earlier.has(item.seal.prev)) add(item.entry.ref, "chain-break", `record ${item.seal.n} does not follow record ${item.seal.n - 1}`);
  }
  return flags;
}

/** Whether two statements conflict. */
export function contradicts(a: Statement, b: Statement): boolean {
  if (a.instanceId !== b.instanceId || a.difficultyId !== b.difficultyId || !a.endedAt || !b.endedAt || !a.startedAt || !b.startedAt) return false;
  if (Math.abs(a.endedAt - b.endedAt) > 5 * RUN_TRUST.endToleranceSec) return false;
  if (a.players.filter((name) => b.players.includes(name)).length < 2) return false;
  if (Math.min(a.endedAt, b.endedAt) <= Math.max(a.startedAt, b.startedAt)) return false;
  return !sameRun(a, b);
}
