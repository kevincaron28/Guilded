// (9.3.2) The browser-safe half of the carry lane (no file system): what a saved database's carried records look like to the bot.
// The file half (receipts written for the addon) is carry.mjs.

export const CARRY_FEATURE = "carry-records";
export const CARRY_RECEIPT_PREFIX = "carry:";
export const MAX_CARRIED = 200;
const MAX_RECORD_BYTES = 2048;

/** The id a record is acknowledged by: "kind:key". */
export const carryId = (record) => `${record.kind}:${record.key}`;

/**
 * The records in a saved database's carry table, newest first, each checked to the shape the bot reads. Records over 2 KB, with a
 * malformed name or a table that cannot be serialised are left out here (the addon bounds them too; the bot validates again).
 */
export function exportCarriedRecords(database, { acknowledged = new Set() } = {}) {
  const records = database?.carry?.records;
  if (!records || typeof records !== "object") return [];
  const out = [];
  for (const record of Object.values(records)) {
    if (!record || typeof record.kind !== "string" || typeof record.key !== "string" || typeof record.author !== "string" || !record.data || typeof record.data !== "object") continue;
    if (!/^[A-Za-z]{2,24}$/.test(record.kind) || record.key.length < 4 || record.key.length > 120 || !record.author.trim() || record.author.length > 80) continue;
    const row = { kind: record.kind, key: record.key, author: record.author, data: record.data, ...(Number.isSafeInteger(record.at) ? { at: record.at } : {}) };
    if (acknowledged.has(carryId(row))) continue;
    let size = Infinity;
    try { size = JSON.stringify(row).length; } catch { /* a cyclic table: left out */ }
    if (size > MAX_RECORD_BYTES) continue;
    out.push(row);
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, MAX_CARRIED);
}
