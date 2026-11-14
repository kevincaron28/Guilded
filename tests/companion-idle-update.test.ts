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
  return { file, pending: { version, file, sha256: createHash("sha256").update(bytes).digest("hex"), attempts: 0 } };
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

describe("the restart marker and the backoff helpers", () => {
  it("keeps the restarted companion in the tray only for a fresh marker", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(idle.markerIsFresh({ at: "2026-11-14T11:58:30Z" }, now)).toBe(true);
    expect(idle.markerIsFresh({ at: "2026-11-14T11:50:00Z" }, now)).toBe(false);
    expect(idle.markerIsFresh({ at: "nonsense" }, now)).toBe(false);
    expect(idle.markerIsFresh(null, now)).toBe(false);
  });

  it("a marker of about three minutes or less keeps the start quiet; an older leftover or no marker shows the window", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const file = join(directory, idle.MARKER_NAME);
    const write = (at: string) => writeFileSync(file, JSON.stringify({ at, version: "9.3.2" }));
    write("2026-11-14T11:58:30Z");
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
    expect(main).toMatch(/idleUpdate\.consumeMarker\(idleUpdateMarkerFile\(\)\)/);
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
