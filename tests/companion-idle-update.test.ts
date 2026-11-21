import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const idle = require("../companion-app/idle-update.cjs");
const updates = require("../companion-app/update-check.cjs");

const DAY = 24 * 60 * 60 * 1000;
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "idle-update-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

// A downloaded installer in the updates folder, as stageUpdate leaves it.
function staged(version = "9.3.2") {
  const bytes = Buffer.from(`installer ${version}`);
  const file = join(directory, `Guilded.Companion.Setup.${version}.exe`);
  writeFileSync(file, bytes);
  return { file, pending: { version, file, sha256: createHash("sha256").update(bytes).digest("hex"), attempts: 0, downloadedAt: "2026-11-14T12:00:00.000Z" } };
}

class FakeInstaller extends EventEmitter { unref = vi.fn(); }

function setup(overrides: Record<string, unknown> = {}) {
  const { pending, file } = staged();
  const config: { pendingUpdate: unknown; autoUpdate: boolean; updateFailure?: { version: string; count: number; nextAt: string } } = { pendingUpdate: pending, autoUpdate: true };
  const spawned: FakeInstaller[] = [];
  const calls: string[] = [];
  const state = { visible: false, minimized: false, minimizedAt: null as number | null, wow: false, sync: false, disk: { ok: true }, clock: Date.parse("2026-11-14T12:00:00Z") };
  const deps = {
    updates, currentVersion: "9.3.1", directory,
    now: () => state.clock,
    eligible: () => true,
    getConfig: () => config,
    saveConfig: vi.fn(async () => { calls.push("save"); }),
    window: () => ({ visible: state.visible, minimized: state.minimized, minimizedAt: state.minimizedAt }),
    wowRunning: () => state.wow,
    syncBusy: () => state.sync,
    checkDisk: () => state.disk,
    writeMarker: vi.fn(() => { calls.push("marker"); }),
    clearMarker: vi.fn(() => { calls.push("clear-marker"); }),
    spawn: vi.fn((target: string) => {
      calls.push(`spawn ${target.split(/[\\/]/).pop()}`);
      const child = new FakeInstaller();
      spawned.push(child);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }),
    log: vi.fn(),
    ...overrides
  };
  return { installer: idle.createIdleInstaller(deps), deps, config, spawned, calls, state, file };
}

describe("the idle install runs the whole flow", () => {
  it("starts the silent installer, with the restart marker written first, and does not quit the companion", async () => {
    const { installer, deps, calls, spawned } = setup();
    const result = await installer.run();
    expect(result).toMatchObject({ started: true, version: "9.3.2" });
    // Order: the attempt is saved, the marker is written, then the installer starts.
    expect(calls).toEqual(["save", "marker", "spawn Guilded.Companion.Setup.9.3.2.exe"]);
    expect(deps.writeMarker).toHaveBeenCalledWith("9.3.2");
    expect(deps.spawn).toHaveBeenCalledWith(expect.stringContaining("9.3.2.exe"), ["/S", "--updated", "--force-run"], expect.objectContaining({ detached: true, windowsHide: true }));
    expect(spawned[0]!.unref).toHaveBeenCalled();
  });

  it("runs one installer even when two callers look at the same moment", async () => {
    const { installer, deps } = setup();
    const [first, second] = await Promise.all([installer.run(), installer.run()]);
    expect([first.started, second.started].sort()).toEqual([false, true]);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    // And later, while that installer still runs.
    expect((await installer.run()).reason).toBe("busy");
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });

  it("leaves the companion running and waits a day when the installer cannot start", async () => {
    const failing = vi.fn(() => { const child = new FakeInstaller(); queueMicrotask(() => child.emit("error", new Error("EACCES"))); return child; });
    const { installer, deps, config, state } = setup({ spawn: failing });
    expect((await installer.run()).reason).toBe("spawn-failed");
    expect(deps.clearMarker).toHaveBeenCalled();
    expect(config.updateFailure).toMatchObject({ version: "9.3.2", count: 1 });
    expect(Date.parse(config.updateFailure?.nextAt ?? "")).toBe(state.clock + DAY);
    // The next looks wait for the backoff and do not start anything.
    state.clock += 3 * 60 * 60 * 1000;
    expect((await installer.run()).reason).toBe("backoff");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("records a failed install when the installer exits with an error, and backs off longer each time", async () => {
    const { installer, deps, config, spawned, state } = setup();
    await installer.run();
    spawned[0]!.emit("exit", 2);
    await vi.waitFor(() => expect(config.updateFailure).toMatchObject({ version: "9.3.2", count: 1 }));
    expect(deps.clearMarker).toHaveBeenCalled();
    expect(installer.isActive()).toBe(false);
    // After a day it may try again; a second failure waits two days, then four, never more than a week.
    state.clock += DAY + 1;
    expect((await installer.run()).started).toBe(true);
    spawned[1]!.emit("exit", 2);
    await vi.waitFor(() => expect(config.updateFailure).toMatchObject({ count: 2 }));
    expect(idle.backoffMs(2)).toBe(2 * DAY);
    expect(idle.backoffMs(3)).toBe(4 * DAY);
    expect(idle.backoffMs(9)).toBe(7 * DAY);
  });

  it("an installer that exits 0 while the companion is still alive did not update: marker cleared, backoff recorded", async () => {
    const { installer, deps, config, spawned } = setup();
    await installer.run();
    spawned[0]!.emit("exit", 0);
    await vi.waitFor(() => expect(config.updateFailure).toMatchObject({ version: "9.3.2", count: 1 }));
    expect(deps.clearMarker).toHaveBeenCalled();
    expect(installer.isActive()).toBe(false);
    // The next look waits for the backoff instead of retrying in ten minutes.
    expect((await installer.run()).reason).toBe("backoff");
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });

  it("waits while a sync is running, WoW runs, or the window is open", async () => {
    const a = setup(); a.state.sync = true;
    expect((await a.installer.run()).reason).toBe("sync-running");
    const b = setup(); b.state.wow = true;
    expect((await b.installer.run()).reason).toBe("wow-running");
    const c = setup(); c.state.visible = true;
    expect((await c.installer.run()).reason).toBe("window-open");
    for (const t of [a, b, c]) expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it("stops waiting for WoW once the update has waited two hours (WoW open all day, 21 Nov 2026)", async () => {
    const t = setup(); t.state.wow = true;
    t.state.clock += 60 * 60 * 1000;
    expect((await t.installer.run()).reason).toBe("wow-running");
    t.state.clock += 61 * 60 * 1000;
    expect((await t.installer.run()).started).toBe(true);
    expect(t.deps.spawn).toHaveBeenCalledTimes(1);
    // Still never during a sync or with the window open.
    expect(idle.decideIdle({ verdict: { action: "install", version: "9.3.2" }, wowRunning: true, syncBusy: true, waitingSince: 0, now: 3 * 60 * 60 * 1000 }).reason).toBe("sync-running");
    expect(idle.decideIdle({ verdict: { action: "install", version: "9.3.2" }, wowRunning: true, window: { visible: true }, waitingSince: 0, now: 3 * 60 * 60 * 1000 }).reason).toBe("window-open");
  });

  it("treats a minimized window as in use for 30 minutes, then as idle", async () => {
    const t = setup();
    t.state.minimized = true; t.state.minimizedAt = t.state.clock - 5 * 60 * 1000;
    expect((await t.installer.run()).reason).toBe("window-minimized");
    t.state.clock += 26 * 60 * 1000;
    expect((await t.installer.run()).started).toBe(true);
  });

  it("does not start with automatic updates off, with low disk, or for the Store build", async () => {
    const off = setup(); off.config.autoUpdate = false;
    expect((await off.installer.run()).reason).toBe("disabled");
    const low = setup(); low.state.disk = { ok: false, freeMb: 20, neededMb: 600, drive: "C:\\" } as never;
    expect((await low.installer.run()).reason).toBe("low-disk");
    const store = setup({ eligible: () => false });
    expect((await store.installer.run()).reason).toBe("not-eligible");
    for (const t of [off, low, store]) expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it("logs a waiting reason once, not at every look", async () => {
    const t = setup(); t.state.wow = true;
    for (let i = 0; i < 6; i += 1) await t.installer.run();
    expect(t.deps.log).toHaveBeenCalledTimes(1);
    t.state.wow = false; t.state.sync = true;
    await t.installer.run();
    expect(t.deps.log).toHaveBeenCalledTimes(2);
  });

  it("hashes the downloaded file once while it is unchanged", async () => {
    const hashFile = vi.fn(async (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex"));
    const t = setup({ hashFile }); t.state.wow = true;
    for (let i = 0; i < 5; i += 1) await t.installer.run();
    expect(hashFile).toHaveBeenCalledTimes(1);
    // A changed file is read again, and a wrong checksum is refused.
    writeFileSync(t.file, "tampered bytes");
    expect((await t.installer.run()).reason).toBe("clear-checksum");
    expect(hashFile).toHaveBeenCalledTimes(2);
  });
});

describe("hardening: slow installs, unfinished updates, unknown WoW and busy syncs", () => {
  it("the marker stays fresh for five minutes and the live companion refreshes it while the installer runs", async () => {
    expect(idle.MARKER_FRESH_MS).toBe(5 * 60 * 1000);
    let tick: (() => void) | null = null;
    const cleared = vi.fn();
    const t = setup({ setInterval: (fn: () => void) => { tick = fn; return { unref: vi.fn() }; }, clearInterval: cleared });
    await t.installer.run();
    expect(t.deps.writeMarker).toHaveBeenCalledTimes(1);
    tick!(); tick!();
    expect(t.deps.writeMarker).toHaveBeenCalledTimes(3);
    t.spawned[0]!.emit("exit", 2);
    await vi.waitFor(() => expect(cleared).toHaveBeenCalled());
  });

  it("an old marker of a newer version is read as an update that did not finish", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const file = join(directory, idle.MARKER_NAME);
    writeFileSync(file, JSON.stringify({ at: "2026-11-14T11:00:00Z", version: "9.3.3" }));
    expect(idle.readMarker(file, now)).toEqual({ quiet: false, unfinished: "9.3.3" });
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, JSON.stringify({ at: "2026-11-14T11:59:00Z", version: "9.3.3" }));
    expect(idle.readMarker(file, now)).toEqual({ quiet: true, unfinished: null });
    expect(idle.readMarker(file, now)).toEqual({ quiet: false, unfinished: null });
  });

  it("the window says so and offers the update again (problem, status item, French)", () => {
    return Promise.all([import("../companion/problems.mjs"), import("../companion/main-status.mjs")]).then(([p, status]) => {
      const list = p.companionProblems({ config: { companionCredential: "x" }, version: "9.3.2", updateUnfinished: "9.3.3" });
      expect(list.find((x: { id: string }) => x.id === "companion-outdated")).toMatchObject({ data: { latest: "9.3.3", current: "9.3.2", unfinished: true } });
      // A version that is already running is not offered.
      expect(p.companionProblems({ config: { companionCredential: "x" }, version: "9.3.3", updateUnfinished: "9.3.3" }).some((x: { id: string }) => x.id === "companion-outdated")).toBe(false);
      const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
      expect(fr["The update did not finish."]).toBeTruthy();
      expect(fr["The update to Guilded Companion {0} did not finish. Use Update to try again."]).toBeTruthy();
      expect(status).toBeDefined();
    });
  });

  it("unknown WoW state counts as running, and a retry or addon update counts as a sync", () => {
    expect(idle.wowBlocks({ running: false, checkFailed: false, checked: true })).toBe(false);
    expect(idle.wowBlocks({ running: false, checkFailed: true, checked: true })).toBe(true);
    expect(idle.wowBlocks({ running: false, checkFailed: false, checked: false })).toBe(true);
    expect(idle.wowBlocks({ running: true, checkFailed: false, checked: true })).toBe(true);
    expect(idle.syncBlocks({ phase: "synced" })).toBe(false);
    for (const phase of ["uploading", "retry"]) expect(idle.syncBlocks({ phase })).toBe(true);
    expect(idle.syncBlocks({ phase: "synced", addonAutoUpdating: true })).toBe(true);
    expect(idle.syncBlocks({ unreadable: true })).toBe(true);
  });

  it("the flow waits when WoW state is unknown or a sync is retrying", async () => {
    const unknown = setup({ wowRunning: () => idle.wowBlocks({ running: false, checkFailed: true }) });
    expect((await unknown.installer.run()).reason).toBe("wow-running");
    const retry = setup({ syncBusy: () => idle.syncBlocks({ phase: "retry" }) });
    expect((await retry.installer.run()).reason).toBe("sync-running");
  });

  it("main.cjs wires the unknown-state rules and the unfinished-update notice", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/wowRunning: \(\) => idleUpdate\.wowBlocks\(\{ running: wowRunning, checkFailed: wowCheckFailed, checked: wowChecked \}\)/);
    expect(main).toMatch(/idleUpdate\.syncBlocks\(\{ phase: engine\?\.state\?\.\(\)\?\.syncPhase, addonAutoUpdating: addonUpdater\(\)\.state\(\)\.busy \}\)/);
    expect(main).toMatch(/wowChecked = true; wowCheckFailed = !!error;/);
    expect(main).toMatch(/idleUpdate\.readMarker\(idleUpdateMarkerFile\(\)\)/);
    expect(main).toMatch(/updateUnfinished = unfinished;/);
    expect(main).toMatch(/addonUpdateFailed: addonUpdater\(\)\.failed\(\), updateUnfinished/);
  });
});

describe("the restart marker and the backoff helpers", () => {
  it("keeps the restarted companion in the tray only for a fresh marker", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(idle.markerIsFresh({ at: "2026-11-14T11:56:00Z" }, now)).toBe(true);
    expect(idle.markerIsFresh({ at: "2026-11-14T11:50:00Z" }, now)).toBe(false);
    expect(idle.markerIsFresh({ at: "nonsense" }, now)).toBe(false);
    expect(idle.markerIsFresh(null, now)).toBe(false);
  });

  it("a marker of about three minutes or less keeps the start quiet; an older leftover or no marker shows the window", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const file = join(directory, idle.MARKER_NAME);
    const write = (at: string) => writeFileSync(file, JSON.stringify({ at, version: "9.3.2" }));
    write("2026-11-14T11:56:00Z");
    expect(idle.consumeMarker(file, now)).toBe(true);
    expect(existsSync(file)).toBe(false); // read once, then gone
    write("2026-11-14T11:50:00Z"); // left by a failed install: a manual start must show the window
    expect(idle.consumeMarker(file, now)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(idle.consumeMarker(file, now)).toBe(false); // no marker at all
    writeFileSync(file, "not json");
    expect(idle.consumeMarker(file, now)).toBe(false);
  });

  it("main.cjs reads that marker at start so the window stays hidden, and tracks a minimized window", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/idleUpdate\.readMarker\(idleUpdateMarkerFile\(\)\)/);
    expect(main).toMatch(/restartedQuietly = readRestartMarker\(\);\s+pushLog/);
    expect(main).toMatch(/restartedQuietly = readRestartMarker\(\)/);
    expect(main).toMatch(/!startHidden && !restartedQuietly/);
    expect(main).toMatch(/win\.on\("minimize"/);
    expect(JSON.parse(readFileSync("companion-app/package.json", "utf8")).build.files).toContain("idle-update.cjs");
  });

  it("a version that failed to install is not downloaded again before its waiting time is over", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/idleUpdate\.inBackoff\(config\.updateFailure, decision\.update\.version, Date\.now\(\)\)/);
  });
});
