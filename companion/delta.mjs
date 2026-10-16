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
export function acknowledgements(body) {
  return {
    ledger: new Set(Array.isArray(body?.acceptedLedgerRefs) ? body.acceptedLedgerRefs : []),
    loot: new Set(Array.isArray(body?.acceptedLootRefs) ? body.acceptedLootRefs : [])
  };
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

export function pruneAcknowledged(full, ack, features = new Set(["ledger-delta", "loot-delta"]), now = Date.now()) {
  const { exported, omitted: raidsOmitted } = pruneOldRaids(full, now);
  if (!ack || !exported) return { exported, omitted: { ledger: 0, loot: 0, raids: raidsOmitted } };
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
    omitted: { ledger: ledgerOmitted, loot: lootOmitted, raids: raidsOmitted }
  };
}
