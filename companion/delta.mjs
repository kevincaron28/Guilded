// Upload only what the bot does not have yet.
//
// The addon never trims its ledger or loot list, and each export used to carry all of it, so a
// busy guild's upload kept growing toward the bot's size limit. The bot tells the companion
// which entries it has stored (acceptedLedgerRefs / acceptedLootRefs, in the standings answer);
// those are left out of the next upload. Everything else is still sent every time, so an entry
// held back (unlinked character, missing core) is looked at again on each upload, exactly as
// before. Nothing here can lose data: a ref missing from the bot's lists is simply sent again
// and the bot skips duplicates.

// ack: { ledger?: Iterable<string>, loot?: Iterable<string> } from the last standings answer.
export function acknowledgements(body) {
  return {
    ledger: new Set(Array.isArray(body?.acceptedLedgerRefs) ? body.acceptedLedgerRefs : []),
    loot: new Set(Array.isArray(body?.acceptedLootRefs) ? body.acceptedLootRefs : [])
  };
}

export function pruneAcknowledged(exported, ack) {
  if (!ack || !exported) return { exported, omitted: { ledger: 0, loot: 0 } };
  const ledger = ack.ledger ?? new Set();
  const loot = ack.loot ?? new Set();
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
    omitted: { ledger: ledgerOmitted, loot: lootOmitted }
  };
}
