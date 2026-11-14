import { describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ fetchBounded: vi.fn(), readTextBounded: vi.fn() }));
import { checkForNewApk, isNewer, latestApk, parseCache, versionFromTag, CHECK_INTERVAL_MS } from "./apkUpdate";

const base = "https://github.com/kevincaron28/Guilded/releases/download";
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, draft: false, html_url: `https://github.com/kevincaron28/Guilded/releases/tag/${tag}`,
  assets: [{ name: "guilded.apk", browser_download_url: `${base}/${tag}/guilded.apk` }], ...extra
});

describe("APK update check", () => {
  it("reads only mobile tags and compares numerically", () => {
    expect(versionFromTag("mobile-v0.2.0-preview")).toEqual([0, 2, 0]);
    expect(versionFromTag("v8.4.3")).toBeNull();
    expect(versionFromTag("mobile-v1.10.0")).toEqual([1, 10, 0]);
    expect(isNewer([0, 10, 0], [0, 9, 9])).toBe(true);
    expect(isNewer([0, 2, 0], [0, 2, 0])).toBe(false);
  });
  it("chooses the highest mobile release with an APK on this repository and skips drafts", () => {
    const body = [
      release("v8.4.3"), release("mobile-v0.2.0-preview"), release("mobile-v0.3.0", { draft: true }),
      release("mobile-v0.2.5"), { ...release("mobile-v0.9.0"), assets: [{ name: "x.apk", browser_download_url: "https://evil.example/x.apk" }] },
      { ...release("mobile-v0.8.0"), assets: [{ name: "notes.txt", browser_download_url: `${base}/mobile-v0.8.0/notes.txt` }] }
    ];
    expect(latestApk(body)).toMatchObject({ version: "0.2.5", url: `${base}/mobile-v0.2.5/guilded.apk` });
    expect(latestApk("nope")).toBeNull();
  });
  it("reports a newer release and caches the answer for six hours", async () => {
    const store = new Map<string, string>();
    const fetchReleases = vi.fn().mockResolvedValue([release("mobile-v0.3.0")]);
    const deps = { now: 1_000, installedVersion: "0.2.0", readCache: async () => store.get("c") ?? null, writeCache: async (value: string) => { store.set("c", value); }, fetchReleases };
    expect((await checkForNewApk(deps))?.version).toBe("0.3.0");
    expect((await checkForNewApk({ ...deps, now: 2_000 }))?.version).toBe("0.3.0");
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    await checkForNewApk({ ...deps, now: 1_000 + CHECK_INTERVAL_MS });
    expect(fetchReleases).toHaveBeenCalledTimes(2);
  });
  it("shows nothing when current, offline, rate limited or the installed version is unknown", async () => {
    const quiet = { now: 5, readCache: async () => null, writeCache: async () => { throw new Error("full"); } };
    expect(await checkForNewApk({ ...quiet, installedVersion: "0.3.0", fetchReleases: async () => [release("mobile-v0.3.0")] })).toBeNull();
    expect(await checkForNewApk({ ...quiet, installedVersion: "0.2.0", fetchReleases: async () => { throw new Error("releases 403"); } })).toBeNull();
    expect(await checkForNewApk({ ...quiet, installedVersion: undefined, fetchReleases: async () => [release("mobile-v0.3.0")] })).toBeNull();
  });
  it("keeps the last known release when a refresh fails, and rejects tampered caches", async () => {
    const stale = JSON.stringify({ checkedAt: 0, latest: { version: "0.3.0", url: `${base}/mobile-v0.3.0/g.apk`, page: "p" } });
    const result = await checkForNewApk({ now: CHECK_INTERVAL_MS + 1, installedVersion: "0.2.0", readCache: async () => stale, writeCache: async () => {}, fetchReleases: async () => { throw new Error("offline"); } });
    expect(result?.version).toBe("0.3.0");
    expect(parseCache(JSON.stringify({ checkedAt: 1, latest: { version: "9.9.9", url: "https://evil.example/a.apk", page: "p" } }))).toBeNull();
    expect(parseCache("{")).toBeNull();
  });
});
