import { firstNameKey } from "./dungeon-import.js";
import { ingestPublicRuns, PUBLIC_LIMITS, type PublicRunStore } from "./public-runs.js";
import { plausibilityFlags } from "./run-plausibility.js";
import { holdsRun, integrityConfig } from "./run-integrity-config.js";
import { RUN_TRUST, voucherOf } from "./run-trust.js";

// Runs a companion carries for players near it (a party, any guild; 9.3.1). The addon marks a run `viaGroup` when it only
// reached that PC through the group. Such a run never enters a guild lane, on any path: it goes to the public boards here,
// as the statement of the player whose addon sent it, under the same checks as other runs.

/** What the bot advertises so a companion only sends group-carried runs to a bot that handles them. */
export const GROUP_RELAY_FEATURE = "group-relay";
/** A receipt for a run handled by this lane: it never marks the run as held by a guild (the addon keeps the two apart). */
export const GROUP_RECEIPT_PREFIX = "group:";

export const isGroupCarried = (run: unknown): boolean => (run as { viaGroup?: unknown } | null)?.viaGroup === true;

/** Splits a list of runs: the group-carried ones, and the rest. */
export function splitGroupCarried(runs: readonly unknown[]): { group: unknown[]; rest: unknown[] } {
  const group: unknown[] = [];
  const rest: unknown[] = [];
  for (const run of runs) (isGroupCarried(run) ? group : rest).push(run);
  return { group, rest };
}

export interface RelayResult {
  /** Receipt refs (prefixed) for every run this lane has dealt with, so the carrier stops sending them. */
  receipts: string[];
  /** Runs placed on the public boards. */
  published: number;
}

/**
 * The public lane for runs a carrier holds for other players.
 * - Only a run a participant's addon sent, none of the carrier's own characters in it (otherwise it is the carrier's own run).
 * - The claimed reporter must be a player of the run. A relayed copy never counts as a confirmation (it records no reporter): only a
 *   first-hand report from a player in the run does, so carriers (any number of devices) cannot confirm a run for each other.
 * - The same plausibility checks as other runs, and a per-carrier daily cap from the server configuration. The day's count is read
 *   from the stored uploads of the carrier, so it survives a restart. Runs over the cap are receipted (dropped), not re-sent for ever.
 */
export async function ingestRelayedRuns(store: PublicRunStore, input: { carrier: string; carrierKeys: ReadonlySet<string>; runs: readonly unknown[]; now?: Date;
  /** (9.3.2) Called with the runs this call placed on the public boards (the guilds with a member in them get a copy). */ onPlaced?: (runs: unknown[]) => void }): Promise<RelayResult> {
  const now = input.now ?? new Date();
  const config = integrityConfig();
  const receipts: string[] = [];
  const candidates: { id: string; run: Record<string, unknown>; reporter: string }[] = [];
  for (const raw of input.runs) {
    const run = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const id = typeof run?.["id"] === "string" && run["id"].length >= 3 && run["id"].length <= 100 ? run["id"] : null;
    if (!run || !id) continue;
    const standing = voucherOf(run, input.carrierKeys);
    // Dealt with, not published: not a run this lane can place (no reporter in the run, or the carrier played it itself).
    if (standing?.kind !== "relay") { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); continue; }
    const players = (Array.isArray(run["players"]) ? run["players"] : []).flatMap((player) => typeof (player as { character?: unknown } | null)?.character === "string" ? [(player as { character: string }).character] : []);
    const reporter = players.find((name) => firstNameKey(name) === standing.voucher) ?? null;
    if (!reporter) { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); continue; }
    candidates.push({ id, run, reporter });
  }
  const carrierKey = `relay:${input.carrier}`;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const room = Math.max(0, config.relayedRunsPerDay - await store.uploadsSince(carrierKey, dayStart));
  const allowed = candidates.slice(0, room);
  // Over the day's limit: dropped, but told as handled so they are not sent again at every sync.
  for (const over of candidates.slice(room)) receipts.push(`${GROUP_RECEIPT_PREFIX}${over.id}`);
  const accepted: unknown[] = [];
  for (const { id, run, reporter } of allowed) {
    const data = run as { instanceId?: unknown; startedAt?: unknown; endedAt?: unknown; players?: { character?: unknown; level?: unknown }[]; encounters?: { id?: unknown; at?: unknown; success?: unknown; kind?: unknown }[] };
    const flags = typeof data.instanceId === "number" ? plausibilityFlags({
      instanceId: data.instanceId, startedAt: typeof data.startedAt === "number" ? data.startedAt : null, endedAt: typeof data.endedAt === "number" ? data.endedAt : null,
      players: (data.players ?? []).flatMap((player) => typeof player.character === "string" ? [{ character: player.character, level: typeof player.level === "number" ? player.level : null }] : []),
      kills: (data.encounters ?? []).flatMap((boss) => boss.success === true && boss.kind !== "npc" && typeof boss.id === "number" ? [{ id: boss.id, at: typeof boss.at === "number" ? boss.at : null }] : [])
    }, { runRef: id, ...(config.limits ? { limits: config.limits } : {}), fastest: { seconds: null, count: 0 } }) : [];
    // A held run is not published; the carrier is told it was dealt with.
    if (holdsRun(flags.map((flag) => flag.code), config, 0)) { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); continue; }
    // Only the reporter's statement is kept: what the carrier's file says about who reported or recorded it is not used.
    const { recorder: _recorder, reporterNames: _reporters, reporters: _count, viaGroup: _via, ...rest } = run;
    void _recorder; void _reporters; void _count; void _via;
    accepted.push({ ...rest, reporterNames: [reporter], reporters: 1 });
  }
  let published = 0;
  for (let start = 0; start < accepted.length; start += PUBLIC_LIMITS.runsPerUpload) {
    const batch = accepted.slice(start, start + PUBLIC_LIMITS.runsPerUpload);
    // A hard stop by the public lane's own budget leaves the runs unreceipted: they are sent again later.
    const result = await ingestPublicRuns(store, { uploaderKey: carrierKey, character: null, source: "personal", relayed: true, runs: batch }).catch(() => null);
    if (!result) continue;
    published += result.accepted.length + result.confirmed.length;
    const placed = new Set([...result.accepted, ...result.confirmed]);
    if (placed.size) input.onPlaced?.(batch.filter((entry) => placed.has((entry as { id: string }).id)));
    for (const entry of batch) receipts.push(`${GROUP_RECEIPT_PREFIX}${(entry as { id: string }).id}`);
  }
  return { receipts: [...new Set(receipts)], published };
}

/**
 * The signed upload's share of the relay: takes the group-carried runs out of the snapshot (so no guild import can see them), places them
 * on the public boards and records the "group:" receipts. Never throws: the upload's own work goes on whatever happens here.
 */
export async function carrySignedGroupRuns(snapshot: { dungeonRuns: unknown[]; character?: { name: string } | null | undefined; alts: { name: string }[]; characters: { name: string }[] },
  options: { carrier: string; store: PublicRunStore; saveReceipts: (refs: string[]) => Promise<void>; onPlaced?: (runs: unknown[]) => void }): Promise<RelayResult | null> {
  const { group, rest } = splitGroupCarried(snapshot.dungeonRuns ?? []);
  if (!group.length) return null;
  snapshot.dungeonRuns = rest;
  const carrierKeys = new Set([snapshot.character, ...snapshot.alts, ...snapshot.characters].flatMap((entry) => entry ? [entry.name] : []).map((name) => name.trim().toLowerCase()));
  const carried = await ingestRelayedRuns(options.store, { carrier: options.carrier, carrierKeys, runs: group.slice(0, RUN_TRUST.relayedPerUpload), ...(options.onPlaced ? { onPlaced: options.onPlaced } : {}) }).catch(() => null);
  if (carried?.receipts.length) await options.saveReceipts(carried.receipts).catch(() => undefined);
  return carried;
}
