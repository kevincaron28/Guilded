// Client probes (/guilded probe ...): what the WoW client exposes, written by the addon to the saved variables as `probes.*`.
// The companion sends a sanitized copy so the bot owner can read it (/guilded-probes). The probes are built to hold only shapes,
// yes/no, ids and counts; this is the second guard: it drops long strings and any field that could carry an amount or a name.
// The bot runs the same function again on what it receives. Browser-safe (no file system).

export const MAX_PROBE_KINDS = 8;
export const MAX_PROBE_ARRAY = 5000;
export const MAX_PROBE_BYTES = 200_000;
export const MAX_PROBE_STRING = 120;
const MAX_DEPTH = 6;
const FORBIDDEN_KEY = /amount|money|copper|name|subject|link/i;
const KIND = /^[a-z][A-Za-z0-9]{0,23}$/;
// Blizzard globals (ERR_AUCTION_SOLD_S) are format templates, and a yes/no cannot hold an amount or a name (fn.GetMoney = false): both are exempt from the key rule.
const isGlobalName = (key) => /^[A-Z][A-Z0-9_]*$/.test(key);

function clean(value, depth) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length > MAX_PROBE_STRING ? undefined : value;
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_PROBE_ARRAY).map((item) => clean(item, depth + 1)).filter((item) => item !== undefined);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 60 || (FORBIDDEN_KEY.test(key) && !isGlobalName(key) && typeof item !== "boolean")) continue;
    const kept = clean(item, depth + 1);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** A sanitized copy of a `probes` table (kind -> result), or {} when nothing is left. A probe over the size cap is left out. */
export function sanitizeProbes(probes) {
  if (!probes || typeof probes !== "object" || Array.isArray(probes)) return {};
  const out = {};
  for (const [kind, probe] of Object.entries(probes)) {
    if (Object.keys(out).length >= MAX_PROBE_KINDS) break;
    if (!KIND.test(kind) || !probe || typeof probe !== "object" || Array.isArray(probe)) continue;
    const kept = clean(probe, 0);
    if (!kept || !Object.keys(kept).length) continue;
    let size = Infinity;
    try { size = JSON.stringify(kept).length; } catch { /* left out */ }
    if (size <= MAX_PROBE_BYTES) out[kind] = kept;
  }
  return out;
}

/** The `probes` section of an export, or undefined when the saved file holds none. */
export function exportProbes(database) {
  const cleaned = sanitizeProbes(database?.probes);
  return Object.keys(cleaned).length ? cleaned : undefined;
}
