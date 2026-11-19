// Upload only what the bot does not have yet.
//
// The addon never trims its ledger or loot list, and each export used to carry all of it, so a
// busy guild's upload kept growing toward the bot's size limit. The bot tells the companion
// which entries it has stored (acceptedLedgerRefs / acceptedLootRefs, in the standings answer);
// those are left out of the next upload, and so are finished raids older than 90 days.
// Everything else is still sent every time, so an entry held back (unlinked character, missing
// core) is looked at again on each upload, exactly as before. Nothing here can lose data: a ref missing from the bot's lists is simply sent again
// and the bot skips duplicates.

// ack: { ledger?: Iterable<string>, loot?: Iterable<string> } from the last standings answer.
import { CARRY_FEATURE, carryId } from "./carry-content.mjs";
import { GROUP_RELAY_FEATURE, isGroupRun, leaveOut } from "./group-relay.mjs";

export function acknowledgements(body) {
  return {
    ledger: new Set(Array.isArray(body?.acceptedLedgerRefs) ? body.acceptedLedgerRefs : []),
    loot: new Set(Array.isArray(body?.acceptedLootRefs) ? body.acceptedLootRefs : []),
    // The runs the bot already holds (only the "group:" receipts matter here: runs carried for other players are sent once).
    runs: new Set(Array.isArray(body?.personal?.acceptedRunRefs) ? body.personal.acceptedRunRefs : []),
    // Runs the bot received but gave a note (refused or earned nothing): they are kept in uploads, so a changed verdict is still looked at.
    runNotes: new Set(body?.personal?.runNotes && typeof body.personal.runNotes === "object" ? Object.keys(body.personal.runNotes) : [])
  };
}

// A full resend of the dungeon runs (nothing held back) at least this often, and always when the bot's list was never read.
export const RUN_FULL_RESEND_DAYS = 7;
export const runResendDue = (lastFullAt, now = Date.now()) => !Number.isFinite(lastFullAt) || now - lastFullAt >= RUN_FULL_RESEND_DAYS * 86_400_000;

// (9.3.8) A finished run the bot already holds (it is in the answer's acceptedRunRefs, so the addon shows it as synced) and gave no note is
// not sent again: 263 of a PC's 291 runs were 79% of its upload. Unfinished runs, runs with a note and runs the bot does not list go every time.
// An older bot that lists nothing leaves every run in, exactly as before.
// (Data-loss audit, 13) A run this PC recorded in full (death map, affixes, trace, diagnostic) is not pruned on the bot's receipt alone: the receipt can come
// from a guildmate's thinner chat copy of the same run. It is pruned once this companion has itself sent that full copy (options.fullSent, ids of runs
// sent in an upload the bot accepted). The weekly full resend still repeats it.
export const isFullRun = (run) => Boolean(run && (run.challenge || run.diagnostic || (Array.isArray(run.deathPoints) && run.deathPoints.length) || run.trace));

function pruneKnownRuns(runs, ack, features, resend, fullSent) {
  let omitted = 0;
  const kept = runs.filter((run) => {
    if (!run) return true;
    if (isGroupRun(run)) return !leaveOut(run, { enabled: features.has(GROUP_RELAY_FEATURE), acknowledged: ack?.runs ?? new Set() });
    if (resend || !ack?.runs?.size || run.state !== "COMPLETED" || typeof run.id !== "string") return true;
    if (!ack.runs.has(run.id) || ack.runNotes?.has(run.id)) return true;
    if (isFullRun(run) && !(fullSent instanceof Set && fullSent.has(run.id))) return true;
    omitted++;
    return false;
  });
  return { kept, omitted };
}

// Finished raids older than this are not sent again: the bot matched them to Discord raids long
// ago (it matches within hours of a raid), so they only made every upload bigger.
export const RAID_UPLOAD_DAYS = 90;

// WoW saves seconds; a JSON export may carry milliseconds or an ISO date.
function raidEndMs(raid) {
  const value = raid?.endedAt ?? raid?.startedAt;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function pruneOldRaids(exported, now = Date.now()) {
  if (!Array.isArray(exported?.raids)) return { exported, omitted: 0 };
  const cutoff = now - RAID_UPLOAD_DAYS * 86_400_000;
  const raids = exported.raids.filter((raid) => { const end = raidEndMs(raid); return end === null || end >= cutoff; });
  const omitted = exported.raids.length - raids.length;
  return omitted ? { exported: { ...exported, raids }, omitted } : { exported, omitted };
}

export function pruneAcknowledged(full, ack, features = new Set(["ledger-delta", "loot-delta"]), now = Date.now(), options = {}) {
  // Kills and deaths with their place go only to a bot that announced the feature; an older bot gets exactly what it always did.
  if (full && full.pvpEvents !== undefined && !features.has("pvp-events")) { full = { ...full }; delete full.pvpEvents; }
  // (9.3.2) Records carried for nearby players go only to a bot that announced the feature.
  if (full && full.carriedRecords !== undefined && !features.has(CARRY_FEATURE)) { full = { ...full }; delete full.carriedRecords; }
  // Records the addon still lists but the bot already holds (Carry.lua, read by the engine) are not sent again.
  if (full && Array.isArray(full.carriedRecords) && ack?.carry?.size) {
    const rest = full.carriedRecords.filter((record) => !ack.carry.has(carryId(record)));
    full = { ...full, carriedRecords: rest };
    if (!rest.length) delete full.carriedRecords;
  }
  const pruned = pruneOldRaids(full, now);
  const raidsOmitted = pruned.omitted;
  // (9.3.1) Runs carried for players near this PC go only to a bot that announced the feature, and only once.
  let runsOmitted = 0;
  let exported = pruned.exported;
  if (exported && Array.isArray(exported.dungeonRuns) && exported.dungeonRuns.length) {
    const { kept, omitted } = pruneKnownRuns(exported.dungeonRuns, ack, features, options.resendRuns === true, options.fullSent);
    runsOmitted = omitted;
    if (kept.length !== exported.dungeonRuns.length) exported = { ...exported, dungeonRuns: kept };
  }
  if (!ack || !exported) return { exported, omitted: { ledger: 0, loot: 0, raids: raidsOmitted, ...(runsOmitted ? { runs: runsOmitted } : {}) } };
  const ledger = features.has("ledger-delta") ? ack.ledger ?? new Set() : new Set();
  const loot = features.has("loot-delta") ? ack.loot ?? new Set() : new Set();
  let ledgerOmitted = 0;
  let lootOmitted = 0;
  const epgpTransactions = (exported.epgpTransactions ?? []).filter((entry) => {
    if (!entry.sourceRef) return true;
    const ref = `addon:${entry.sourceRef}`;
    if (!ledger.has(ref)) return true;
    // Voided after Discord stored it: keep sending until the reversal is acknowledged too.
    if (entry.voided && !ledger.has(`void:${ref}`)) return true;
    ledgerOmitted++;
    return false;
  });
  const lootRows = (exported.loot ?? []).filter((row) => {
    if (!row.ref || !loot.has(row.ref)) return true;
    lootOmitted++;
    return false;
  });
  return {
    exported: { ...exported, epgpTransactions, loot: lootRows },
    omitted: { ledger: ledgerOmitted, loot: lootOmitted, raids: raidsOmitted, ...(runsOmitted ? { runs: runsOmitted } : {}) }
  };
}
