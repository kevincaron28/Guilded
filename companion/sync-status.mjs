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

/** Exact allowlist for a user-reviewed report preview. No paths, character/account
 * names, credentials, snapshot IDs, endpoints, arbitrary errors or logs leave it.
 * Operational states are safe diagnostics; credentials are never needed here. */
export function syncDiagnosticPreview(config = {}, state = {}, evidence = {}) {
  const status = syncStatus(config, state, evidence);
  return { schemaVersion: 1, edition: status.edition, phase: status.phase, action: status.action,
    running: status.running, saved: status.saved, uploaded: status.uploaded, accepted: status.accepted,
    lastOperationAt: status.lastOperationAt, companionVersion: version(evidence.companionVersion),
    addonVersion: version(state.addonVersion), botVersion: version(state.botVersion) };
}
