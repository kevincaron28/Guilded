import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({ config: { ERROR_LOG_CHANNEL_ID: undefined } }));
const target = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../src/services/diagnostic-target.js", () => ({ diagnosticTarget: async () => target.value }));
vi.mock("../src/services/sync-health.js", () => ({
  SUMMARY_PREFIX: "Sync health",
  syncHealth: async () => [{ kind: "stuck" }],
  developerSummary: () => "Sync health: 1 stuck"
}));
const { sendSyncHealthAlert, resetSyncAlertDay } = await import("../src/services/sync-health-alert.js");

describe("sync health alert", () => {
  beforeEach(() => { resetSyncAlertDay(); target.value = null; });
  it("tries again on the next tick when the post failed, and stops after a successful one", async () => {
    const db = { syncHealthReport: { deleteMany: async () => ({ count: 0 }) }, guild: { findMany: async () => [{ id: "g1", name: "G" }] } } as never;
    const send = vi.fn().mockRejectedValueOnce(new Error("Discord down")).mockResolvedValue(undefined);
    target.value = { channel: { messages: { fetch: async () => null }, send } };
    const at = new Date("2026-11-15T10:00:00Z");
    await expect(sendSyncHealthAlert(null, db, at)).rejects.toThrow("Discord down");
    expect(await sendSyncHealthAlert(null, db, new Date("2026-11-15T11:00:00Z"))).toBe(true);
    expect(await sendSyncHealthAlert(null, db, new Date("2026-11-15T12:00:00Z"))).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("purges old reports even when no log channel is set", async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const posted = await sendSyncHealthAlert(null, { syncHealthReport: { deleteMany } } as never, new Date("2026-11-15T10:00:00Z"));
    expect(posted).toBe(false);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
  it("waits for the morning tick", async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    expect(await sendSyncHealthAlert(null, { syncHealthReport: { deleteMany } } as never, new Date("2026-11-15T03:00:00Z"))).toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
