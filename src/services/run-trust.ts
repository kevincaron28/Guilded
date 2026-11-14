import { foreverSameName } from "../../companion/character-identity.mjs";
import { firstNameKey } from "./dungeon-import.js";

// Dungeon run trust (docs/plans/RUN_TRUST_2026-11-10.md). Everything in a saved file can be edited, so a run that only
// unsigned companions sent counts by corroboration: what the server already knows about the party (roster, links) and
// how many independent statements agree, never by which anonymous key uploaded it. Pure functions; the database side
// is storeDeviceRuns (companion-device.ts).

/** One witness is enough for a run to be stored and ranked (docs/plans/SINGLE_WITNESS_2026-11-13.md). Set false for the earlier rules. */
export const SINGLE_WITNESS = true;
/** The date from which one witness is enough. */
export const SINGLE_WITNESS_SINCE = "2026-11-13";

export const RUN_TRUST = {
  /** Everyone sees the final boss die at the same moment on the game server's clock. */
  endToleranceSec: 120,
  /** A late joiner's addon starts its timer later. */
  startToleranceSec: 600,
  /** A relayed or waiting run older than this can no longer count (same age as a member's relay). */
  maxAgeSec: 30 * 24 * 3600,
  /** Runs one device may have stored on its own word per day; more wait for a second statement. */
  singleStatementRunsPerDevicePerDay: 20,
  /** Statements one device may have waiting. */
  pendingPerDevice: 200,
  /** Runs a device may relay for guildmates in one upload. */
  relayedPerUpload: 25
} as const;

export const PENDING_REASON = "Waiting for a second player's addon to confirm it";
export const EXPIRED_REASON = SINGLE_WITNESS ? "Too old to count (over 30 days)" : "Not confirmed by a second player";
export const LIMIT_REASON = SINGLE_WITNESS ? "Daily limit for this PC: the rest are counted tomorrow" : "Daily limit for this PC: waiting for a second player's addon";

/**
 * Owner decision, 10 November 2026: during Season 1 a run only anonymous devices vouch for is stored and counted too
 * (marked trust "device"); from Season 2 on it waits for roster or a second witness. The switch is the official season
 * calendar: it is on until an official season numbered 2 or later has started. No stored flag, so nothing to forget to flip.
 */
export function countsDeviceOnlyRuns(startedSeasonNumbers: readonly number[]): boolean {
  if (SINGLE_WITNESS) return true;
  return !startedSeasonNumbers.some((number) => number >= 2);
}

export type RunTrust = "device" | "witnessed" | "member";

/** What two statements must agree on to be the same run. */
export interface RunFingerprint {
  instanceId: number; difficultyId: number;
  startedAt: number | null; endedAt: number | null;
  /** First-name keys of the party, sorted, no duplicates. */
  players: string[];
  /** Boss ids in kill order. */
  bosses: number[];
}

/** One unsigned companion speaking for one party character. */
export interface Statement extends RunFingerprint { deviceId: string; voucher: string; kind: "first-hand" | "relay" }

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;
const seconds = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
const partyNames = (run: Loose): string[] => (Array.isArray(run["players"]) ? run["players"] : [])
  .flatMap((player) => { const name = record(player)?.["character"]; return typeof name === "string" && name.trim() ? [name] : []; });

/** The fingerprint of an uploaded run, or null when it is not a run with a dungeon and a party. */
export function fingerprintOf(raw: unknown): RunFingerprint | null {
  const run = record(raw);
  if (!run || typeof run["instanceId"] !== "number" || !Number.isInteger(run["instanceId"])) return null;
  const players = [...new Set(partyNames(run).map(firstNameKey).filter(Boolean))].sort();
  if (!players.length) return null;
  const kills = (Array.isArray(run["encounters"]) ? run["encounters"] : []).flatMap((entry) => {
    const boss = record(entry);
    return boss && boss["success"] === true && boss["kind"] !== "npc" && typeof boss["id"] === "number" ? [{ id: boss["id"], at: seconds(boss["at"]) ?? 0 }] : [];
  });
  // Stable: kills with a time are ordered by it, the rest keep the order they were recorded in.
  const bosses = kills.map((kill, index) => ({ ...kill, index })).sort((a, b) => (a.at && b.at ? a.at - b.at : 0) || a.index - b.index).map((kill) => kill.id);
  return {
    instanceId: run["instanceId"], difficultyId: typeof run["difficultyId"] === "number" ? run["difficultyId"] : 0,
    startedAt: seconds(run["startedAt"]), endedAt: seconds(run["endedAt"]), players, bosses: bosses.filter((id, index) => bosses.indexOf(id) === index)
  };
}

/** One list is the other with kills missing: the order of the kills both hold is the same. */
function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  const shared = (list: readonly number[], other: readonly number[]) => list.filter((id) => other.includes(id));
  const left = shared(a, b), right = shared(b, a);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Do two fingerprints describe the same clear? Same dungeon and difficulty, times within the tolerances, a shared party, one boss order. */
export function sameRun(a: RunFingerprint, b: RunFingerprint): boolean {
  if (a.instanceId !== b.instanceId || a.difficultyId !== b.difficultyId) return false;
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return false;
  if (Math.abs(a.endedAt - b.endedAt) > RUN_TRUST.endToleranceSec || Math.abs(a.startedAt - b.startedAt) > RUN_TRUST.startToleranceSec) return false;
  const shared = a.players.filter((name) => b.players.includes(name)).length;
  if (shared < Math.min(2, a.players.length, b.players.length)) return false;
  return sameOrder(a.bosses, b.bosses);
}

/**
 * The party character an unsigned upload speaks for: one of the device's own characters in the party (first-hand), or a
 * participant whose addon sent the run in game (reporterNames, relay). Null: the device has no standing for this run.
 */
export function voucherOf(raw: unknown, deviceKeys: ReadonlySet<string>): { kind: "first-hand" | "relay"; voucher: string } | null {
  const run = record(raw);
  if (!run) return null;
  const party = partyNames(run);
  const own = party.find((name) => [...deviceKeys].some((key) => foreverSameName(key, name)));
  if (own) return { kind: "first-hand", voucher: firstNameKey(own) };
  const reporters = (Array.isArray(run["reporterNames"]) ? run["reporterNames"] : []).filter((name): name is string => typeof name === "string");
  const reporter = party.find((name) => reporters.some((heard) => foreverSameName(heard, name)));
  return reporter ? { kind: "relay", voucher: firstNameKey(reporter) } : null;
}

/** Independent: another device key, speaking for another party character, about the same run. */
export function independent(a: Statement, b: Statement): boolean {
  return a.deviceId !== b.deviceId && a.voucher !== b.voucher && sameRun(a, b);
}

/** Is a party member known to the server (synced roster or a linked character)? `known` holds lowercase full names or first names. */
export function anchored(raw: unknown, known: readonly string[]): boolean {
  const run = record(raw);
  return !!run && partyNames(run).some((name) => known.some((entry) => foreverSameName(entry, name)));
}

export type TrustDecision =
  | { store: "witnessed"; with: Statement }
  | { store: "device" }
  | { wait: string }
  | { expire: string };

/**
 * What happens to a run only unsigned companions sent and the server does not hold yet.
 * `others`: statements of other devices for this server around the same time. `storedToday`: runs this device already
 * had stored on its own word in the last 24 hours.
 */
export function decide(statement: Statement, others: readonly Statement[], context: { anchored: boolean; storedToday: number; nowSec: number; allowDeviceOnly?: boolean }): TrustDecision {
  const second = others.find((other) => independent(statement, other));
  if (second) return { store: "witnessed", with: second };
  const age = statement.endedAt ? context.nowSec - statement.endedAt : 0;
  if (age > RUN_TRUST.maxAgeSec) return { expire: EXPIRED_REASON };
  if (!context.anchored && !context.allowDeviceOnly) return { wait: PENDING_REASON };
  if (context.storedToday >= RUN_TRUST.singleStatementRunsPerDevicePerDay) return { wait: LIMIT_REASON };
  return { store: "device" };
}
