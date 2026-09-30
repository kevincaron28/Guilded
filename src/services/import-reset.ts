import type { AddonSnapshot } from "../integrations/addon.js";

// A newly paired companion still has its whole old local ledger. Unknown dates
// cannot establish that an entry was made after a destructive reset.
export function excludeHistoryBeforeReset(snapshot: AddonSnapshot, resetAt: Date | null): AddonSnapshot {
  if (!resetAt) return snapshot;
  const after = (value: unknown): boolean => {
    if (value === undefined || value === null || value === "") return false;
    const stamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(stamp) && stamp >= resetAt.getTime();
  };
  return {
    ...snapshot,
    transactions: snapshot.transactions.filter(row => after(row.createdAt)),
    epgpTransactions: snapshot.epgpTransactions.filter(row => after(row.createdAt)),
    raids: snapshot.raids.filter(row => after(row.startedAt)),
    loot: snapshot.loot.filter(row => after(row.awardedAt)),
    dungeonRuns: snapshot.dungeonRuns.filter(row => row && typeof row === "object" && "endedAt" in row && after(row.endedAt))
  };
}
