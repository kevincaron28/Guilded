import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { mainStatus, retryClock } from "../companion/main-status.mjs";

const require = createRequire(import.meta.url);
const updates = require("../companion-app/update-check.cjs");

const latest = (rolloutPercent?: unknown) => ({ version: "9.4.0", url: "u", installer: { name: "Guilded.Companion.Setup.9.4.0.exe", url: "x", size: 1, sha256: "a".repeat(64) }, ...(rolloutPercent === undefined ? {} : { rolloutPercent }) });
const base = { store: false, packaged: true, platform: "win32", enabled: true, current: "9.3.11", pending: null };

function keyOutside(percent: number) { for (let i = 0; i < 1000; i++) if (!updates.inRollout(`o${i}`, percent)) return `o${i}`; throw new Error("none"); }
function keyInside(percent: number) { for (let i = 0; i < 1000; i++) if (updates.inRollout(`i${i}`, percent)) return `i${i}`; throw new Error("none"); }

describe("9.4 T2: staged rollout", () => {
  it("a missing or invalid percent means everyone", () => {
    for (const value of [undefined, null, "", "abc", -5, 101, NaN]) expect(updates.rolloutPercent(value)).toBe(100);
    expect(updates.rolloutPercent(25)).toBe(25);
    expect(updates.rolloutPercent("40")).toBe(40);
    expect(updates.rolloutPercent(0)).toBe(0);
  });
  it("the bucket is stable and spread over 0-99", () => {
    expect(updates.rolloutBucket("key-1")).toBe(updates.rolloutBucket("key-1"));
    const buckets = Array.from({ length: 2000 }, (_, i) => updates.rolloutBucket(`device-${i}`));
    expect(Math.min(...buckets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...buckets)).toBeLessThan(100);
    const inside = buckets.filter((bucket) => bucket < 25).length;
    expect(inside).toBeGreaterThan(400);
    expect(inside).toBeLessThan(600);
  });
  it("raising the percent only adds installs", () => {
    const keys = Array.from({ length: 300 }, (_, i) => `k${i}`);
    const at = (percent: number) => new Set(keys.filter((key) => updates.inRollout(key, percent)));
    const a = at(10), b = at(50);
    for (const key of a) expect(b.has(key)).toBe(true);
    expect(at(100).size).toBe(300);
    expect(at(0).size).toBe(0);
  });
  it("decideAutoUpdate holds an install outside the percent, but not a staged download or a full rollout", () => {
    const out = keyOutside(10), inside = keyInside(10);
    expect(updates.decideAutoUpdate({ ...base, latest: latest(10), deviceKey: out })).toMatchObject({ action: "skip", reason: "rollout" });
    expect(updates.decideAutoUpdate({ ...base, latest: latest(10), deviceKey: inside }).action).toBe("download");
    expect(updates.decideAutoUpdate({ ...base, latest: latest(), deviceKey: out }).action).toBe("download");
    expect(updates.decideAutoUpdate({ ...base, latest: latest(10), deviceKey: out, pending: { version: "9.4.0", sha256: "a".repeat(64) } }).action).toBe("staged");
    expect(updates.describeDecision(updates.decideAutoUpdate({ ...base, latest: latest(10), deviceKey: out }))).toContain("staged rollout");
  });
  it("reads rolloutPercent from the site feed's companion entry", () => {
    const feed = { github: { version: "9.4.0", url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.4.0" }, companionDirect: { version: "9.4.0", sha256: "b".repeat(64), size: 5, rolloutPercent: 30 } };
    expect(updates.siteRelease(feed).rolloutPercent).toBe(30);
    expect(updates.siteRelease({ ...feed, companionDirect: { ...feed.companionDirect, rolloutPercent: undefined } })).not.toHaveProperty("rolloutPercent");
  });
});

describe("9.4 T2: the update failure line", () => {
  const now = new Date(2026, 10, 20, 10, 0).getTime();
  it("a failed download shows the next try", () => {
    const notice = updates.updateNotice({ trouble: { retryAt: new Date(2026, 10, 20, 14, 5).toISOString() }, now });
    expect(notice).toMatchObject({ kind: "failed" });
    const status = mainStatus({ config: { watchFile: "C:\\WoW\\WTF\\Account\\A\\SavedVariables\\Guilded.lua", companionCredential: "x" }, updateNotice: notice, now });
    expect(status.needsYou).toMatchObject({ id: "update-failed", tone: "warn", text: ["Update failed — retrying at {0}", "14:05"] });
    expect(status.needsYou?.buttons).toEqual([{ action: "install-update", label: "Try again" }]);
  });
  it("an install in back-off shows its next time; one that has passed shows nothing", () => {
    const failure = { version: "9.4.0", nextAt: new Date(now + 3_600_000).toISOString() };
    expect(updates.updateNotice({ failure, version: "9.4.0", now })).toMatchObject({ kind: "failed", retryAt: failure.nextAt });
    expect(updates.updateNotice({ failure: { ...failure, nextAt: new Date(now - 1).toISOString() }, version: "9.4.0", now })).toBeNull();
    expect(updates.updateNotice({ failure, version: "9.5.0", now })).toBeNull();
  });
  it("a checked update waits for WoW: said once, with no button", () => {
    const notice = updates.updateNotice({ pendingReady: true, wowRunning: true });
    expect(notice).toEqual({ kind: "ready" });
    expect(mainStatus({ config: {}, updateNotice: notice }).needsYou).toMatchObject({ id: "update-ready", text: ["Update ready — installs when WoW closes"], buttons: [] });
    expect(updates.updateNotice({ pendingReady: true, wowRunning: false })).toBeNull();
    expect(updates.updateNotice({})).toBeNull();
  });
  it("retryClock shows a date when the retry is not today", () => {
    expect(retryClock(new Date(2026, 10, 20, 9, 3).toISOString(), now)).toBe("09:03");
    expect(retryClock(new Date(2026, 10, 22, 9, 3).toISOString(), now)).toBe("2026-11-22 09:03");
    expect(retryClock("nonsense", now)).toBe("");
  });
});
