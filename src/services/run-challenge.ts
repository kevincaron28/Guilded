import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sameRun, type Statement } from "./run-trust.js";
import type { Anomaly } from "./run-plausibility.js";

// Challenge and record chain shared by every feature whose records the addon writes and a PC uploads (dungeon runs, duels).
//
// - The server hands each PC a fresh challenge at every sync (issueChallenge). The addon stamps the latest one on each record it
//   makes and links the record to the one before (a record hash chain). The companion adds a signature made with a key derived
//   from the device key (deriveSealKey), which the server recomputes from the key that arrives with each upload.
// - verifyBatch checks a batch of records against all of that and returns flags by index. Flags only describe; what a flag
//   weighs, and what holds a record for review, is server configuration (run-integrity-config.ts).
//
// The private protocol notes (record layout, canonical text, rules for the addon and companion) are kept by the owner, not here.

export interface Seal { n: number; nonce: string; prev: string; mac: string | null }
export const NO_PREV = "0".repeat(64);

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;
const whole = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "";
const text = (value: unknown): string => typeof value === "string" ? value : "";
const NONCE = /^[0-9a-z]{4,10}\.[0-9a-f]{24}$/;

/** The seal on a record, or null when there is none or it is malformed. A missing signature is fine here (the companion adds it). */
export function sealOf(raw: unknown): Seal | null {
  const seal = record(record(record(raw)?.["integrity"])?.["seal"]);
  if (!seal || typeof seal["n"] !== "number" || !Number.isInteger(seal["n"]) || seal["n"] < 1) return null;
  if (typeof seal["nonce"] !== "string" || !NONCE.test(seal["nonce"]) || typeof seal["prev"] !== "string" || !/^[0-9a-f]{64}$/.test(seal["prev"])) return null;
  const mac = typeof seal["mac"] === "string" && /^[0-9a-f]{64}$/.test(seal["mac"]) ? seal["mac"] : null;
  return { n: seal["n"], nonce: seal["nonce"], prev: seal["prev"], mac };
}

/** One field per line, fixed order, lists sorted, whole numbers: the addon's Lua and this code agree byte for byte. */
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

/** The link the next record carries: the hash of this record's canonical text. */
export const chainHash = (canonical: string): string => createHash("sha256").update(canonical).digest("hex");

/** The signing key the companion derives from its device key; the server derives the same one from the key sent with the upload. */
export const deriveSealKey = (deviceKey: string): string => createHmac("sha256", deviceKey).update("guilded-record-signing-2").digest("hex");

export const sealMac = (sealKey: string, canonical: string): string => createHmac("sha256", sealKey).update(canonical).digest("hex");

const timed = (secret: string, deviceId: string, issued: string): string => createHmac("sha256", secret).update(`${issued}:${deviceId}`).digest("hex").slice(0, 24);

/** A fresh challenge for this PC. Stateless: it carries its own issue time and proves it was issued by this server to this PC. */
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
  /** The PC sending the batch. */
  deviceId: string;
  /** Key derived from the device key sent with this upload (deriveSealKey); null when unknown. */
  sealKey: string | null;
  /** The challenge secret; null turns the challenge checks off. */
  secret: string | null;
  /** The newest record this PC sent before: its number and hash. */
  head: { n: number; hash: string } | null;
  windowSec: number;
  /** Count a record without a seal as flagged. */
  requireSeal: boolean;
}

export interface BatchEntry { raw: unknown; ref: string; endedAt: number | null; kind: Statement["kind"]; earlier: boolean }
export interface BatchResult { flags: Map<string, Anomaly[]>; head: { n: number; hash: string } | null }

/** Checks a batch of records one PC sent. Records already seen before (resent) are not re-checked. */
export function verifyBatch(entries: readonly BatchEntry[], context: BatchContext): BatchResult {
  const flags = new Map<string, Anomaly[]>();
  const add = (ref: string, code: string, detail: string) => { const list = flags.get(ref) ?? []; if (!list.some((flag) => flag.code === code)) list.push({ code, detail }); flags.set(ref, list); };
  const sealed: { entry: BatchEntry; seal: Seal; canonical: string }[] = [];
  for (const entry of entries) {
    if (entry.earlier) continue;
    const seal = sealOf(entry.raw);
    if (!seal) { if (context.requireSeal && entry.kind === "first-hand") add(entry.ref, "seal-missing", "no record seal"); continue; }
    const canonical = canonicalText(entry.raw, seal);
    // Signature (the companion's), checked when this upload carries the key.
    if (context.sealKey) {
      if (!seal.mac) add(entry.ref, "seal-unsigned", "record not signed by the companion");
      else {
        const expected = Buffer.from(sealMac(context.sealKey, canonical), "hex"), given = Buffer.from(seal.mac, "hex");
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) add(entry.ref, "seal-invalid", "signature does not match");
      }
    }
    // Challenge: only the recorder's own PC holds the challenges issued to it, so a guildmate's relayed record is not checked here.
    if (entry.kind === "first-hand") {
      if (context.secret) {
        const issued = challengeTime(context.secret, context.deviceId, seal.nonce);
        if (issued === null) add(entry.ref, "nonce-foreign", "challenge not issued to this PC");
        else if (entry.endedAt !== null && issued > entry.endedAt + 120) add(entry.ref, "nonce-future", "challenge issued after the run ended");
        else if (entry.endedAt !== null && entry.endedAt - issued > context.windowSec) add(entry.ref, "nonce-window", "run ended long after its challenge was issued");
      }
      sealed.push({ entry, seal, canonical });
    }
  }
  // Chain: consecutive numbers must link; one number twice with different records is a fork.
  const byNumber = new Map<number, { entry: BatchEntry; seal: Seal; canonical: string }[]>();
  for (const item of sealed) byNumber.set(item.seal.n, [...(byNumber.get(item.seal.n) ?? []), item]);
  for (const [n, items] of byNumber) {
    if (new Set(items.map((item) => item.canonical)).size > 1) for (const item of items) add(item.entry.ref, "chain-fork", `two records numbered ${n}`);
    const before = byNumber.get(n - 1)?.[0];
    for (const item of items) {
      if (before && item.seal.prev !== chainHash(before.canonical)) add(item.entry.ref, "chain-break", `record ${n} does not follow record ${n - 1}`);
      else if (!before && context.head && n === context.head.n + 1 && item.seal.prev !== context.head.hash) add(item.entry.ref, "chain-break", `record ${n} does not follow the last known record`);
      else if (context.head && n <= context.head.n) add(item.entry.ref, "chain-fork", `number ${n} was already used`);
    }
  }
  let head = context.head;
  for (const item of sealed) {
    if (flags.has(item.entry.ref)) continue;
    if (!head || item.seal.n > head.n) head = { n: item.seal.n, hash: chainHash(item.canonical) };
  }
  return { flags, head };
}

/**
 * Two statements about what looks like one run that disagree on facts they should agree on. Statements that match as one run
 * (run-trust sameRun) must also agree on the end time within a few seconds; near-matches that are not one run are a conflict.
 */
export function contradicts(a: Statement, b: Statement): boolean {
  if (a.instanceId !== b.instanceId || a.difficultyId !== b.difficultyId || !a.endedAt || !b.endedAt) return false;
  if (Math.abs(a.endedAt - b.endedAt) > 600) return false;
  const shared = a.players.filter((name) => b.players.includes(name)).length;
  if (shared < 2) return false;
  if (!a.startedAt || !b.startedAt || Math.min(a.endedAt, b.endedAt) <= Math.max(a.startedAt, b.startedAt)) return false; // two clears one after the other
  if (!sameRun(a, b)) return true;
  return Math.abs(a.endedAt - b.endedAt) > 30 || (a.bosses.length > 0 && b.bosses.length > 0 && a.bosses.length !== b.bosses.length);
}
