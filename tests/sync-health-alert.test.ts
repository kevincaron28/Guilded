import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({ config: { ERROR_LOG_CHANNEL_ID: undefined } }));
const { sendSyncHealthAlert, resetSyncAlertDay } = await import("../src/services/sync-health-alert.js");

describe("sync health alert", () => {
  beforeEach(() => resetSyncAlertDay());
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
