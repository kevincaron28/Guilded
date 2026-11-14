import { firstNameKey } from "./dungeon-import.js";
import { ingestPublicRuns, type PublicRunStore } from "./public-runs.js";
import { plausibilityFlags } from "./run-plausibility.js";
import { holdsRun, integrityConfig } from "./run-integrity-config.js";
import { voucherOf } from "./run-trust.js";

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

// Per carrier and day, in memory (the limit itself comes from the server configuration).
const days = new Map<string, { day: string; used: number }>();
function spend(carrier: string, count: number, now: Date, perDay: number): number {
  const day = now.toISOString().slice(0, 10);
  const entry = days.get(carrier);
  const state = entry && entry.day === day ? entry : { day, used: 0 };
  const room = Math.max(0, Math.min(count, perDay - state.used));
  state.used += room;
  days.set(carrier, state);
  if (days.size > 5000) for (const key of days.keys()) { if (days.get(key)!.day !== day) days.delete(key); }
  return room;
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
 * - The statement counted is the reporter's: the claimed reporter must be a player of the run, and copies of one reporter's run
 *   sent by several carriers are one source.
 * - The same plausibility checks as other runs, and a per-carrier daily cap from the server configuration.
 */
export async function ingestRelayedRuns(store: PublicRunStore, input: { carrier: string; carrierKeys: ReadonlySet<string>; runs: readonly unknown[]; now?: Date }): Promise<RelayResult> {
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
  const room = spend(input.carrier, candidates.length, now, config.relayedRunsPerDay);
  const allowed = candidates.slice(0, room);
  const byReporter = new Map<string, unknown[]>();
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
    const key = firstNameKey(reporter);
    const list = byReporter.get(key) ?? [];
    list.push({ ...rest, reporterNames: [reporter], reporters: 1 });
    byReporter.set(key, list);
  }
  let published = 0;
  for (const [key, runs] of byReporter) {
    // A hard stop by the public lane's own budget leaves the runs unreceipted: they are sent again later.
    const result = await ingestPublicRuns(store, { uploaderKey: `relay:${key}`, character: null, source: "personal", relayed: true, runs }).catch(() => null);
    if (!result) continue;
    published += result.accepted.length + result.confirmed.length;
    for (const entry of runs) {
      const id = (entry as { id: string }).id;
      // Dealt with unless the hourly budget turned it away (retried later).
      receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`);
    }
  }
  return { receipts: [...new Set(receipts)], published };
}
