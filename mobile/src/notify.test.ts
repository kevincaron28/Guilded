import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ permission: vi.fn(), cancel: vi.fn(), schedule: vi.fn(), existing: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-constants", () => ({ default: { easConfig: { projectId: "test-project" } } }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(), getAllScheduledNotificationsAsync: fixture.existing,
  cancelScheduledNotificationAsync: fixture.cancel, scheduleNotificationAsync: fixture.schedule,
  getPermissionsAsync: fixture.permission, requestPermissionsAsync: fixture.permission,
  SchedulableTriggerInputTypes: { DATE: "date" }
}));
import { syncRaidReminders } from "./notify";
const reminder = { id: "raid-1", title: "Raid", startsAt: "2099-01-01T20:00:00Z", fireAt: "2099-01-01T19:00:00Z", body: "One hour" };
beforeEach(() => { vi.clearAllMocks(); fixture.permission.mockResolvedValue({ granted: true }); fixture.existing.mockResolvedValue([{ identifier: "guilded-raid-old" }, { identifier: "other-feature" }]); });
describe("native reminder mutations", () => {
  it("keeps unrelated notifications and includes a safe in-app destination", async () => {
    const result = await syncRaidReminders(true, [reminder], "123456");
    expect(result.scheduled).toBe(1);
    expect(fixture.cancel.mock.calls).toEqual([["guilded-raid-old"]]);
    expect(fixture.schedule.mock.calls[0]?.[0].content.data).toEqual({ type: "raid", guildDiscordId: "123456", raidId: "raid-1" });
  });
  it("supersedes a pending enable with logout and never schedules afterward", async () => {
    let finish!: (value: { granted: boolean }) => void;
    const entered = new Promise<void>((resolve) => fixture.permission.mockImplementationOnce(() => { resolve(); return new Promise<{ granted: boolean }>((done) => { finish = done; }); }));
    const enable = syncRaidReminders(true, [reminder], "123456");
    await entered;
    const disable = syncRaidReminders(false, []);
    finish({ granted: true });
    await Promise.all([enable, disable]);
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledWith("guilded-raid-old");
  });
  it("reports native failures distinctly and preserves the previous calendar on permission lookup errors", async () => {
    fixture.permission.mockRejectedValueOnce(new Error("OS unavailable"));
    expect((await syncRaidReminders(true, [reminder])).error).toMatch(/could not be updated/);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });
});
