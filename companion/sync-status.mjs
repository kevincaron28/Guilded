import { GAME_EDITIONS } from "./game-edition.mjs";

const phases = new Set(["waiting-save", "uploading", "synced", "officer-review", "apply-error", "retry", "needs-attention"]);
const iso = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const label = value => typeof value === "string" ? [...value].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").slice(0, 500) : null;
const version = value => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z]+\.\d{1,3})?$/.test(value) ? value : null;

/** Local display only: never attach this object to a report. The adapter must
 * provide saved/upload/acceptance evidence for the SAME snapshot. Legacy
 * syncPhase/lastUpload are operational hints, not evidence of backend acceptance. */
export function syncStatus(config = {}, state = {}, evidence = {}) {
  const savedAt = iso(evidence.savedAt);
  const uploadedAt = iso(evidence.uploadedAt);
  const acceptedAt = iso(evidence.acceptedAt);
  const sameUpload = !!savedAt && typeof evidence.savedRevision === "string" && evidence.savedRevision.length > 0
    && evidence.savedRevision === evidence.uploadedRevision && !!uploadedAt && uploadedAt >= savedAt;
  const sameAcceptance = sameUpload && evidence.uploadedRevision === evidence.acceptedRevision && !!acceptedAt && acceptedAt >= uploadedAt;
  const phase = phases.has(state.syncPhase) ? state.syncPhase : "unknown";
  const action = phase === "officer-review" ? "officer-review" : phase === "apply-error" ? "review-application-error"
    : phase === "retry" ? "wait-for-retry" : phase === "needs-attention" ? "check-connection"
      : !savedAt ? "save-in-game" : !sameUpload ? "wait-for-upload" : !sameAcceptance ? "wait-for-acceptance" : "reload-in-game";
  const watchedFile = label(config.watchFile);
  const separator = watchedFile ? Math.max(watchedFile.lastIndexOf("/"), watchedFile.lastIndexOf("\\")) : -1;
  return {
    edition: GAME_EDITIONS.includes(evidence.edition) ? evidence.edition : GAME_EDITIONS.includes(config.gameEdition) ? config.gameEdition : "unknown",
    character: label(evidence.character), watchedFile, folder: separator < 0 ? null : watchedFile.slice(0, separator),
    saved: { status: savedAt ? "observed" : "unknown", at: savedAt },
    uploaded: { status: sameUpload ? "confirmed" : "unknown", at: sameUpload ? uploadedAt : null },
    accepted: { status: sameAcceptance ? "confirmed" : "unknown", at: sameAcceptance ? acceptedAt : null },
    phase, action, running: state.running === true,
    // This is an engine operation time; it can include dedup/no-new-data responses.
    lastOperationAt: iso(state.lastUpload?.at)
  };
}

// The last few failures (companion/error-detail.mjs), re-checked field by field: time, operation,
// host, HTTP status, cause code/name, timed out, duration. Nothing else from an error leaves the PC.
const OPERATIONS = new Set(["upload", "standings"]);
function recentErrors(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-5).map((item) => ({
    at: iso(item?.at),
    operation: OPERATIONS.has(item?.operation) ? item.operation : null,
    host: typeof item?.host === "string" && /^[a-z0-9.-]{1,253}$/.test(item.host) ? item.host : null,
    status: Number.isInteger(item?.status) && item.status >= 100 && item.status <= 599 ? item.status : null,
    code: typeof item?.code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(item.code) ? item.code : null,
    name: typeof item?.name === "string" && /^[A-Za-z][A-Za-z0-9]{1,40}$/.test(item.name) ? item.name : null,
    timedOut: item?.timedOut === true,
    durationMs: Number.isInteger(item?.durationMs) && item.durationMs >= 0 && item.durationMs < 86_400_000 ? item.durationMs : null
  })).filter((item) => item.at && item.operation);
}

/** Exact allowlist for a user-reviewed report preview. No paths, character/account
 * names, credentials, snapshot IDs, arbitrary error text or logs leave it. Since 8.5 the recent
 * failures add the bot address's host name only (never its path or query), with codes and timings.
 * Operational states are safe diagnostics; credentials are never needed here. */
export function syncDiagnosticPreview(config = {}, state = {}, evidence = {}) {
  const status = syncStatus(config, state, evidence);
  const summary = { schemaVersion: 1, edition: status.edition, phase: status.phase, action: status.action,
    running: status.running, saved: status.saved, uploaded: status.uploaded, accepted: status.accepted,
    lastOperationAt: status.lastOperationAt, companionVersion: version(evidence.companionVersion),
    addonVersion: version(state.addonVersion), botVersion: version(state.botVersion),
    recentErrors: recentErrors(state.recentErrors),
    ...(gameSync(state.gameSync) ? { gameSync: gameSync(state.gameSync) } : {}) };
  // (9.0) The window shows local times; with the PC's UTC offset the summary does too, and says which.
  const offset = evidence.utcOffsetMinutes;
  return Number.isInteger(offset) && Math.abs(offset) <= 14 * 60 ? { ...localTimes(summary, offset), timeZone: zoneName(offset) } : summary;
}

/** "UTC-05:00" for an offset of -300 minutes (east of UTC is positive). */
export function zoneName(offset) {
  const sign = offset < 0 ? "-" : "+", abs = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
/** Every UTC time in the summary, written as local time with its offset: 2026-11-06T15:47:08-05:00. */
export function localTimes(value, offset) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
    const local = new Date(Date.parse(value) + offset * 60_000).toISOString().slice(0, 19);
    return local + zoneName(offset).slice(3);
  }
  if (Array.isArray(value)) return value.map((item) => localTimes(item, offset));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localTimes(item, offset)]));
  return value;
}

/** (9.0) The addon's guild sync counters (/guilded sync stats): whole numbers and two dates. */
function gameSync(value) {
  if (!value || typeof value !== "object") return null;
  const fields = ["sent", "bytes", "received", "receivedBytes", "held", "relayedIn", "relayedOut", "rounds", "acksSent", "acksHeard"];
  const out = {};
  for (const field of fields) out[field] = Number.isSafeInteger(value[field]) && value[field] >= 0 ? value[field] : 0;
  for (const field of ["since", "lastCatchUpAt"]) {
    if (typeof value[field] === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value[field])) out[field] = value[field];
  }
  return out;
}
