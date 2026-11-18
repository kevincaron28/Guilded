import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ permission: vi.fn(), request: vi.fn(), cancel: vi.fn(), schedule: vi.fn(), existing: vi.fn(), token: vi.fn(), channel: vi.fn(), os: "ios" }));
vi.mock("react-native", () => ({ Platform: { get OS() { return fixture.os; } } }));
vi.mock("expo-constants", () => ({ default: { easConfig: { projectId: "test-project" } } }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(), getAllScheduledNotificationsAsync: fixture.existing,
  cancelScheduledNotificationAsync: fixture.cancel, scheduleNotificationAsync: fixture.schedule,
  getPermissionsAsync: fixture.permission, requestPermissionsAsync: fixture.request, getExpoPushTokenAsync: fixture.token, setNotificationChannelAsync: fixture.channel, AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" }
}));
import { PushSetupError, pushToken, syncRaidReminders } from "./notify";
const reminder = { id: "raid-1", title: "Raid", startsAt: "2099-01-01T20:00:00Z", fireAt: "2099-01-01T19:00:00Z", body: "One hour" };
beforeEach(() => { vi.clearAllMocks(); fixture.os = "ios"; fixture.request.mockResolvedValue({ granted: true }); fixture.permission.mockResolvedValue({ granted: true }); fixture.existing.mockResolvedValue([{ identifier: "guilded-raid-old" }, { identifier: "other-feature" }]); });
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

describe("push token and the Android 13 permission prompt", () => {
  it("creates the channel first on Android, asks once, and returns the Expo token", async () => {
    fixture.os = "android";
    fixture.permission.mockResolvedValue({ granted: false, canAskAgain: true });
    fixture.request.mockResolvedValue({ granted: true });
    fixture.token.mockResolvedValue({ data: "ExpoPushToken[abcdefghijk]" });
    expect(await pushToken()).toBe("ExpoPushToken[abcdefghijk]");
    expect(fixture.channel).toHaveBeenCalledWith("raids", expect.objectContaining({ importance: 3 }));
    expect(fixture.channel.mock.invocationCallOrder[0]).toBeLessThan(fixture.request.mock.invocationCallOrder[0]!);
    expect(fixture.token).toHaveBeenCalledWith({ projectId: "test-project" });
  });
  it("does not ask again when the permission is already granted", async () => {
    fixture.permission.mockResolvedValue({ granted: true });
    fixture.token.mockResolvedValue({ data: "ExpoPushToken[abcdefghijk]" });
    await pushToken();
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it("sends the person to phone settings once Android will not ask again", async () => {
    fixture.permission.mockResolvedValue({ granted: false, canAskAgain: false });
    const error = await pushToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PushSetupError);
    expect((error as PushSetupError).needsSettings).toBe(true);
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.token).not.toHaveBeenCalled();
  });
  it("says so when the prompt is refused and when this build has no push setup", async () => {
    fixture.permission.mockResolvedValue({ granted: false, canAskAgain: true });
    fixture.request.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await pushToken().catch((caught: unknown) => caught)).toMatchObject({ needsSettings: false, message: expect.stringMatching(/off for Guilded/) });
    fixture.permission.mockResolvedValue({ granted: true });
    fixture.token.mockRejectedValue(new Error("no firebase"));
    expect(await pushToken().catch((caught: unknown) => caught)).toMatchObject({ message: expect.stringMatching(/not set up in this build/) });
  });
});
