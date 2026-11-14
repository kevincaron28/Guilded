import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ota = vi.hoisted(() => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-updates", () => ota);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("__DEV__", false);
  ota.isEnabled = true;
  ota.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
  ota.fetchUpdateAsync.mockResolvedValue({ isNew: true });
  ota.reloadAsync.mockResolvedValue(undefined);
});

describe("launch updates", () => {
  it("fetches and reloads a new compatible update once across repeated calls", async () => {
    const { prepareLaunchUpdate } = await import("./updates");
    expect(await prepareLaunchUpdate()).toBe("downloaded");
    expect(await prepareLaunchUpdate()).toBe("downloaded");
    expect(ota.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(ota.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(ota.reloadAsync).toHaveBeenCalledTimes(1);
  });
  it("does not reload a cached/non-new result", async () => {
    ota.fetchUpdateAsync.mockResolvedValue({ isNew: false });
    const { prepareLaunchUpdate } = await import("./updates");
    expect(await prepareLaunchUpdate()).toBe("current");
    expect(ota.reloadAsync).not.toHaveBeenCalled();
  });
  it("keeps an offline app usable", async () => {
    ota.checkForUpdateAsync.mockRejectedValue(new Error("offline"));
    const { prepareLaunchUpdate } = await import("./updates");
    expect(await prepareLaunchUpdate()).toBe("unavailable");
    expect(ota.reloadAsync).not.toHaveBeenCalled();
  });
  it("releases startup after eight seconds and never reloads a late download", async () => {
    vi.useFakeTimers();
    let complete: (value: { isNew: boolean }) => void = () => {};
    ota.fetchUpdateAsync.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const { prepareLaunchUpdate } = await import("./updates");
    const launch = prepareLaunchUpdate();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await launch).toBe("unavailable");
    complete({ isNew: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ota.reloadAsync).not.toHaveBeenCalled();
  });
  it.each(["development", "unconfigured"])("skips %s launches", async (mode) => {
    if (mode === "development") vi.stubGlobal("__DEV__", true);
    else ota.isEnabled = false;
    const { prepareLaunchUpdate } = await import("./updates");
    expect(await prepareLaunchUpdate()).toBe("disabled");
    expect(ota.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});
