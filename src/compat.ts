// Compatibility constants and the per-version client counter (docs/COMPAT_POLICY.md).
// One place for the sync protocol and the support window, so a release changes a number here
// instead of hunting literals in companion-api.ts.

/** The sync protocol this bot speaks. Raise it only for a deliberate, announced break. */
export const PROTOCOL_VERSION = 2;
/** The oldest sync protocol this bot still answers. Moves together with PROTOCOL_VERSION, never alone. */
export const MIN_PROTOCOL = 2;
/**
 * The oldest companion release still inside the support window (N-2 minor releases: 9.3.x supports
 * 9.1.0 and up; 9.1.0 is the zero-setup companion). Raise it only when a release leaves the window.
 */
export const MIN_COMPANION = "9.1.0";

const VERSION = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})/;
function parts(value: unknown): [number, number, number] | null {
  const match = VERSION.exec(typeof value === "string" ? value.trim() : "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** A clean "x.y.z" from an untrusted header value, or null. */
export function cleanVersion(value: unknown): string | null {
  const p = parts(value);
  return p ? p.join(".") : null;
}

/** True when `version` is older than `minimum`. Unreadable versions are never "older". */
export function versionBelow(version: unknown, minimum: string = MIN_COMPANION): boolean {
  const left = parts(version), right = parts(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index]! < right[index]!;
  return false;
}

/** The optional fields an old companion ignores and a new one surfaces as "companion-outdated". */
export function compatFields(clientVersion: string | null): { minProtocol: number; minCompanionVersion: string; updateRequired?: true } {
  return { minProtocol: MIN_PROTOCOL, minCompanionVersion: MIN_COMPANION, ...(clientVersion && versionBelow(clientVersion) ? { updateRequired: true as const } : {}) };
}

const seen = new Map<string, number>();
const MAX_VERSIONS = 64;

/** Count one request from a companion version (in memory; resets on restart). */
export function noteClientVersion(raw: unknown): string | null {
  const version = cleanVersion(raw);
  if (!version) return null;
  if (seen.has(version) || seen.size < MAX_VERSIONS) seen.set(version, (seen.get(version) ?? 0) + 1);
  return version;
}

/** "9.3.5 x12, 9.1.3 x2 (1 version below 9.1.0)" or null when nothing was seen; clears the counter when `reset`. */
export function clientVersionSummary(reset = false): string | null {
  if (seen.size === 0) return null;
  const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  const below = rows.filter(([version]) => versionBelow(version)).length;
  const line = rows.map(([version, count]) => `${version} x${count}`).join(", ") + (below ? ` (${below} version${below === 1 ? "" : "s"} below ${MIN_COMPANION})` : "");
  if (reset) seen.clear();
  return line;
}

/** Test hook. */
export function resetClientVersions(): void { seen.clear(); }
