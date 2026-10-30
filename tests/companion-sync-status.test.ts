import { describe, expect, it } from "vitest";
import { syncDiagnosticPreview, syncStatus } from "../companion/sync-status.mjs";

const config = { gameEdition: "forever", watchFile: "C:\\Users\\Private\\WTF\\Account\\SavedVariables\\Guilded.lua", companionCredential: "very-private-credential" };
const state = { running: true, syncPhase: "synced", lastUpload: { at: "2026-10-30T12:01:00Z", message: "private arbitrary logs" }, addonVersion: "8.1.0", botVersion: "8.1.0" };
const evidence = { savedAt: "2026-10-30T12:00:00Z", uploadedAt: "2026-10-30T12:01:00Z", acceptedAt: "2026-10-30T12:02:00Z",
  savedRevision: "private-snapshot", uploadedRevision: "private-snapshot", acceptedRevision: "private-snapshot", character: "PrivateCharacter", companionVersion: "8.1.0" };

describe("sync clarity and diagnostic minimization", () => {
  it("never interprets synced/lastUpload as saved or accepted evidence", () => {
    expect(syncStatus(config, state)).toMatchObject({ saved: { status: "unknown" }, uploaded: { status: "unknown" }, accepted: { status: "unknown" }, action: "save-in-game" });
  });
  it("requires matching snapshot revisions and correctly ordered stage timestamps", () => {
    expect(syncStatus(config, state, evidence)).toMatchObject({ saved: { status: "observed" }, uploaded: { status: "confirmed" }, accepted: { status: "confirmed" } });
    for (const change of [{ acceptedRevision: "older" }, { acceptedAt: "2026-10-30T11:59:00Z" }]) expect(syncStatus(config, state, { ...evidence, ...change }).accepted.status).toBe("unknown");
    expect(syncStatus(config, state, { ...evidence, savedRevision: "new-save" }).uploaded.status).toBe("unknown");
    expect(syncStatus(config, state, { ...evidence, uploadedAt: "bad" }).accepted.status).toBe("unknown");
  });
  it("keeps local context on screen while exposing only allowlisted operational diagnostics", () => {
    expect(syncStatus(config, state, evidence)).toMatchObject({ character: "PrivateCharacter", watchedFile: config.watchFile, folder: "C:\\Users\\Private\\WTF\\Account\\SavedVariables" });
    const preview = syncDiagnosticPreview(config, { ...state, uploadError: "Bearer secret", botVersion: "8.1.0 token=secret" }, evidence);
    const text = JSON.stringify(preview);
    for (const privateText of ["Private", "credential", "snapshot", "Bearer", "token", "arbitrary"]) expect(text).not.toContain(privateText);
    expect(preview).toMatchObject({ schemaVersion: 1, edition: "forever", addonVersion: "8.1.0", botVersion: null, accepted: { status: "confirmed" } });
  });
  it("uses enumerated next actions and never echoes arbitrary server error strings", () => {
    expect(syncStatus({}, { syncPhase: "officer-review" }).action).toBe("officer-review");
    expect(syncStatus({}, { syncPhase: "apply-error" }).action).toBe("review-application-error");
    expect(syncStatus({}, { syncPhase: "retry" }).action).toBe("wait-for-retry");
    expect(syncDiagnosticPreview({ gameEdition: "secret-edition" }, { syncPhase: "secret-phase" })).toMatchObject({ edition: "unknown", phase: "unknown" });
  });
});
