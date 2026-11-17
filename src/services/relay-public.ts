import { firstNameKey } from "./dungeon-import.js";
import { checkPublicRun, findSameRun, ingestPublicRuns, PUBLIC_LIMITS, sameDetails, summarize, type PublicRunStore } from "./public-runs.js";
import { dungeonRunSchema } from "./dungeon-rules.js";
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

/** The note the addon shows next to a guild-lane run the bot sent to the public boards because no player of the guild was in it. */
export const STRANGER_NOTE = "No player of this guild in it: sent to the public boards";

/**
 * (16 November 2026) The plain-id receipts for runs the guild lane handed to this lane because no player of the guild was in them
 * (splitStrangerRuns). Those runs sit in the addon's own run list, not its carried list, and the addon only takes a "group:" receipt
 * for a carried run: with the "group:" receipt alone such a run stayed "not reached Discord" for ever and was sent at every upload.
 * Only a run this lane dealt with (its "group:" receipt came back) gets one; one left for later (the public lane's own budget) is
 * sent again. A plain receipt never blocks the guild lane (only a "copy" receipt does, dungeon-import.ts knownRuns).
 */
export function strangerReceipts(strangerIds: Iterable<string>, groupReceipts: readonly string[]): string[] {
  const dealt = new Set(groupReceipts);
  return [...new Set(strangerIds)].filter((id) => dealt.has(`${GROUP_RECEIPT_PREFIX}${id}`));
}

/** The ids of runs (strings only), for strangerReceipts. */
export const runIds = (runs: readonly unknown[]): string[] => runs.flatMap((run) => { const id = (run as { id?: unknown } | null)?.id; return typeof id === "string" ? [id] : []; });

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
  /** Runs dealt with as another recorder's copy of a run already on the boards (a confirmation: no second row). */
  known: number;
  /** Runs the public lane refused (too old, impossible time, other edition, a different result...) or this lane held: receipted, with the reason. */
  rejected: { id: string; reason: string }[];
  /** Receipt ref -> a short reason, for the receipts that are a refusal (the addon shows it as the run's note). Duplicates and copies have none. */
  notes: Record<string, string>;
}

/** The plausibility flags of a relayed run (what decides whether it is held). */
function relayFlags(run: Record<string, unknown>, id: string, config: ReturnType<typeof integrityConfig>) {
  const data = run as { instanceId?: unknown; startedAt?: unknown; endedAt?: unknown; players?: { character?: unknown; level?: unknown }[]; encounters?: { id?: unknown; at?: unknown; success?: unknown; kind?: unknown }[] };
  return typeof data.instanceId === "number" ? plausibilityFlags({
    instanceId: data.instanceId, startedAt: typeof data.startedAt === "number" ? data.startedAt : null, endedAt: typeof data.endedAt === "number" ? data.endedAt : null,
    players: (data.players ?? []).flatMap((player) => typeof player.character === "string" ? [{ character: player.character, level: typeof player.level === "number" ? player.level : null }] : []),
    kills: (data.encounters ?? []).flatMap((boss) => boss.success === true && boss.kind !== "npc" && typeof boss.id === "number" ? [{ id: boss.id, at: typeof boss.at === "number" ? boss.at : null }] : [])
  }, { runRef: id, ...(config.limits ? { limits: config.limits } : {}), fastest: { seconds: null, count: 0 } }) : [];
}

/**
 * Would this lane place the run now? Null when yes; otherwise why not (the carrier's daily room, a plausibility hold, the public lane's own
 * check). Nothing is changed: used before something is removed to make room for the run.
 */
export async function relayWouldPlace(store: PublicRunStore, input: { carrier: string; run: Record<string, unknown>; now?: Date }): Promise<string | null> {
  const now = input.now ?? new Date();
  const config = integrityConfig();
  const id = typeof input.run["id"] === "string" ? input.run["id"] : "?";
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (Math.max(0, config.relayedRunsPerDay - await store.uploadsSince(`relay:${input.carrier}`, dayStart)) < 1) return "carrier's daily limit";
  if (holdsRun(relayFlags(input.run, id, config).map((flag) => flag.code), config, 0)) return "held by a plausibility check";
  const parsed = dungeonRunSchema.safeParse(input.run);
  if (!parsed.success) return "not a valid run";
  const check = checkPublicRun(parsed.data, null, now);
  return check.ok ? null : check.reason ?? "refused by the public lane";
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
  /** (9.3.2) Called with the runs this call placed on the public boards (the guilds with a member in them get a copy). */ onPlaced?: (runs: unknown[]) => void;
  /** (9.3.3) The caller deals with copies of a placed run itself (the carried lane). */ skipNearMatch?: boolean }): Promise<RelayResult> {
  const now = input.now ?? new Date();
  const config = integrityConfig();
  const receipts: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const notes: Record<string, string> = {};
  const refuseNote = (id: string, reason: string) => { rejected.push({ id, reason }); notes[`${GROUP_RECEIPT_PREFIX}${id}`] = reason.slice(0, 80); };
  let duplicates = 0, held = 0;
  const candidates: { id: string; run: Record<string, unknown>; reporter: string }[] = [];
  for (const raw of input.runs) {
    const run = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const id = typeof run?.["id"] === "string" && run["id"].length >= 3 && run["id"].length <= 100 ? run["id"] : null;
    // Nothing to receipt a run by: said in the journal so a run that keeps coming back is never silent.
    if (!run || !id) { console.info(`Relayed run via ${input.carrier}: skipped (${run ? "no usable id" : "not a run"})`); continue; }
    const standing = voucherOf(run, input.carrierKeys);
    // Dealt with, not published: not a run this lane can place (no reporter in the run, or the carrier played it itself).
    if (standing?.kind !== "relay") { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); console.info(`Relayed run ${id.slice(0, 40)} via ${input.carrier}: not placed (${standing ? "carrier played it itself" : "no reporter in the run"})`); continue; }
    const players = (Array.isArray(run["players"]) ? run["players"] : []).flatMap((player) => typeof (player as { character?: unknown } | null)?.character === "string" ? [(player as { character: string }).character] : []);
    const reporter = players.find((name) => firstNameKey(name) === standing.voucher) ?? null;
    if (!reporter) { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); console.info(`Relayed run ${id.slice(0, 40)} via ${input.carrier}: not placed (reporter not in the party)`); continue; }
    candidates.push({ id, run, reporter });
  }
  const carrierKey = `relay:${input.carrier}`;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const room = Math.max(0, config.relayedRunsPerDay - await store.uploadsSince(carrierKey, dayStart));
  const allowed = candidates.slice(0, room);
  // Over the day's limit: dropped, but told as handled so they are not sent again at every sync.
  for (const over of candidates.slice(room)) { receipts.push(`${GROUP_RECEIPT_PREFIX}${over.id}`); refuseNote(over.id, "Over the sender's daily limit"); console.info(`Relayed run ${over.id.slice(0, 40)} via ${input.carrier}: not placed (carrier's daily limit)`); }
  const accepted: unknown[] = [];
  let known = 0;
  for (const { id, run, reporter } of allowed) {
    const flags = relayFlags(run, id, config);
    // A held run is not published; the carrier is told it was dealt with.
    if (holdsRun(flags.map((flag) => flag.code), config, 0)) { receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); held++; refuseNote(id, `Held by a check: ${flags.map((flag) => flag.code).join(", ")}`); console.info(`Relayed run ${id.slice(0, 40)} via ${input.carrier}: held (${flags.map((flag) => flag.code).join(",")})`); continue; }
    // Another recorder's copy of a run already on the boards (two addons in one party name the run after themselves): a confirmation, no second row.
    const parsed = dungeonRunSchema.safeParse(run);
    if (parsed.success && !input.skipNearMatch) {
      const summary = summarize(parsed.data, now);
      const near = !await store.findRun(summary.runKey) ? await findSameRun(store, summary).catch(() => null) : null;
      if (near) {
        // Only a statement that says the same is a confirmation; a different one never changes the placed run (logged for review).
        receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`); known++;
        console.info(`Relayed run ${id.slice(0, 40)} via ${input.carrier}: ${sameDetails(near, summary) ? "a copy of a run already placed" : "differs from the run already placed, which stays (for review)"}`);
        continue;
      }
    }
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
    if (!result) { console.error(`Relayed runs via ${input.carrier}: public lane refused a batch of ${batch.length}; they are sent again later`); continue; }
    published += result.accepted.length + result.confirmed.length;
    const placed = new Set([...result.accepted, ...result.confirmed]);
    if (placed.size) input.onPlaced?.(batch.filter((entry) => placed.has((entry as { id: string }).id)));
    const refused = new Map(result.rejected.map((row) => [row.id, row.reason] as const));
    const dup = new Set(result.duplicates);
    for (const entry of batch) {
      const id = (entry as { id: string }).id;
      receipts.push(`${GROUP_RECEIPT_PREFIX}${id}`);
      const why = refused.get(id);
      if (why) { refuseNote(id, why); if (/held for review/.test(why)) held++; console.info(`Relayed run ${id.slice(0, 40)} via ${input.carrier}: refused (${why})`); }
      else if (dup.has(id)) duplicates++;
    }
  }
  const unique = [...new Set(receipts)];
  // One line per call, whatever happened, so the journal always shows what this lane did with what it was given.
  if (input.runs.length) console.info(`Relayed runs via ${input.carrier}: received ${input.runs.length}, placed ${published}, copies ${known}, receipted ${unique.length}, duplicates ${duplicates}, rejected ${rejected.length}, held ${held}`);
  return { receipts: unique, published, known, rejected, notes };
}

/**
 * The signed upload's share of the relay: takes the group-carried runs out of the snapshot (so no guild import can see them), places them
 * on the public boards and records the "group:" receipts. Never throws: the upload's own work goes on whatever happens here.
 */
export async function carrySignedGroupRuns(snapshot: { dungeonRuns: unknown[]; character?: { name: string } | null | undefined; alts: { name: string }[]; characters: { name: string }[] },
  /** `ownKeys`: the uploader's own characters (lower case), see ownCarrierKeys. Without it only the exported character and alts count: never snapshot.characters, which is every guildmate heard (peer digests). */
  /** `strangerIds`: runs the guild lane handed over (no player of the guild in them): they also get a plain-id receipt, see strangerReceipts. */
  options: { carrier: string; ownKeys?: ReadonlySet<string>; strangerIds?: ReadonlySet<string>; store: PublicRunStore; saveReceipts: (receipts: { runRef: string; reason: string | null }[]) => Promise<void>; onPlaced?: (runs: unknown[]) => void }): Promise<RelayResult | null> {
  const { group, rest } = splitGroupCarried(snapshot.dungeonRuns ?? []);
  if (!group.length) return null;
  snapshot.dungeonRuns = rest;
  const carrierKeys = new Set([...(options.ownKeys ?? []), ...[snapshot.character, ...snapshot.alts].flatMap((entry) => entry ? [entry.name] : []).map((name) => name.trim().toLowerCase())]);
  const carried = await ingestRelayedRuns(options.store, { carrier: options.carrier, carrierKeys, runs: group.slice(0, RUN_TRUST.relayedPerUpload), ...(options.onPlaced ? { onPlaced: options.onPlaced } : {}) }).catch((error: unknown) => { console.error(`Relayed runs via ${options.carrier} failed: ${error instanceof Error ? error.message : String(error)}`); return null; });
  if (carried?.receipts.length) {
    const plain = strangerReceipts(options.strangerIds ?? [], carried.receipts);
    // A refused run is receipted (so it is not sent again for ever) with its reason, which the addon shows as the run's note.
    const rows = [...carried.receipts.map((runRef) => ({ runRef, reason: carried.notes[runRef] ?? null })), ...plain.map((runRef) => ({ runRef, reason: STRANGER_NOTE }))];
    await options.saveReceipts(rows).catch((error: unknown) => { console.error(`Relayed runs via ${options.carrier}: receipts not saved (${rows.length}): ${error instanceof Error ? error.message : String(error)}`); });
  }
  return carried;
}
