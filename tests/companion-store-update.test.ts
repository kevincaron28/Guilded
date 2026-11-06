import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const store = createRequire(import.meta.url)("../companion-app/store-update.cjs");
const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-11-06T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("Store update: which Windows path", () => {
  it("prefers the silent install, then the one Store prompt, then the Store page button", () => {
    expect(store.chooseStoreUpdateMethod({ silentPresent: true, requestPresent: true })).toBe("silent"); // Windows 11, Windows 10 2004+
    expect(store.chooseStoreUpdateMethod({ silentPresent: false, requestPresent: true })).toBe("prompt"); // Windows 10 1607-1909
    expect(store.chooseStoreUpdateMethod({ silentPresent: false, requestPresent: false })).toBe("page");
    expect(store.chooseStoreUpdateMethod({})).toBe("page");
  });
});

describe("Store update: when to check", () => {
  const due = { store: true, platform: "win32", now };
  it("checks a Store install on Windows at most once every 6 hours", () => {
    expect(store.decideStoreCheck(due)).toEqual({ action: "check", reason: "due" });
    expect(store.decideStoreCheck({ ...due, lastCheckAt: ago(5 * HOUR) }).reason).toBe("checked-recently");
    expect(store.decideStoreCheck({ ...due, lastCheckAt: ago(6 * HOUR + 1) }).action).toBe("check");
  });
  it("never while WoW is running, while busy, after a recent failure, or outside the Store build", () => {
    expect(store.decideStoreCheck({ ...due, wowRunning: true }).reason).toBe("wow-running");
    expect(store.decideStoreCheck({ ...due, busy: true }).reason).toBe("busy");
    expect(store.decideStoreCheck({ ...due, lastFailedAt: ago(30 * 60 * 1000) }).reason).toBe("failed-recently");
    expect(store.decideStoreCheck({ ...due, lastFailedAt: ago(2 * HOUR) }).action).toBe("check");
    expect(store.decideStoreCheck({ ...due, store: false }).reason).toBe("not-store");
    expect(store.decideStoreCheck({ ...due, platform: "darwin" }).reason).toBe("not-windows");
    expect(store.decideStoreCheck({ ...due, enabled: false }).reason).toBe("disabled");
  });
});

describe("Store update: what to do with the answer", () => {
  const found = { ok: true, silentPresent: true, requestPresent: true, updates: 1, version: "8.5.0" };
  it("installs silently when an update is offered", () => {
    expect(store.decideStoreInstall(found)).toEqual({ action: "install", method: "silent", reason: "update-available" });
  });
  it("uses the prompt only with a visible window, and waits otherwise", () => {
    const older = { ...found, silentPresent: false };
    expect(store.decideStoreInstall(older, { windowVisible: true })).toMatchObject({ action: "install", method: "prompt" });
    expect(store.decideStoreInstall(older, { windowVisible: false })).toMatchObject({ action: "none", reason: "prompt-needs-window" });
  });
  it("falls back to the Store button when the API is missing or the check failed", () => {
    expect(store.decideStoreInstall({ ...found, silentPresent: false, requestPresent: false })).toMatchObject({ action: "button", reason: "api-unavailable" });
    expect(store.decideStoreInstall({ ok: false, error: "0x803F6101" })).toMatchObject({ action: "button", reason: "check-failed" });
    expect(store.decideStoreInstall(null)).toMatchObject({ action: "button" });
  });
  it("does nothing when up to date or when WoW started meanwhile", () => {
    expect(store.decideStoreInstall({ ...found, updates: 0 })).toMatchObject({ action: "none", reason: "up-to-date" });
    expect(store.decideStoreInstall(found, { wowRunning: true })).toMatchObject({ action: "none", reason: "wow-running" });
  });
});

describe("Store update: the PowerShell bridge", () => {
  it("detects the API by presence, not by Windows version", () => {
    const script = store.checkScript();
    expect(script).toContain("IsMethodPresent($store, 'TrySilentDownloadAndInstallStorePackageUpdatesAsync')");
    expect(script).toContain("IsMethodPresent($store, 'RequestDownloadAndInstallStorePackageUpdatesAsync')");
    expect(script).toContain("GetAppAndOptionalStorePackageUpdatesAsync");
    expect(script).not.toMatch(/OSVersion|BuildNumber/);
  });
  it("downloads, registers the restart, then installs (silent)", () => {
    const script = store.installScript({ method: "silent", exe: "Guilded Companion" });
    const order = ["TrySilentDownloadStorePackageUpdatesAsync", "Register-ScheduledTask", "TrySilentDownloadAndInstallStorePackageUpdatesAsync"].map((text) => script.indexOf(text));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(script).toContain("Get-Process -Name 'Guilded Companion'");
    expect(script).toContain(`!${store.APP_ID}`);
    expect(script).not.toContain("RequestDownloadAndInstall");
  });
  it("attaches the window before the Store prompt", () => {
    const script = store.installScript({ method: "prompt", hwnd: "1311330", exe: "Guilded Companion" });
    expect(script).toContain("[GuildedWindow]::Attach($context, 1311330)");
    expect(script.indexOf("Attach($context")).toBeLessThan(script.indexOf("RequestDownloadAndInstallStorePackageUpdatesAsync"));
  });
  it("refuses anything it would have to quote", () => {
    expect(() => store.installScript({ method: "page" })).toThrow();
    expect(() => store.installScript({ method: "prompt", hwnd: "1; Remove-Item" })).toThrow();
    expect(() => store.installScript({ method: "silent", exe: "x'; evil" })).toThrow();
  });
  it("reads the last JSON line PowerShell printed", () => {
    expect(store.parseScriptOutput('noise\r\n{"ok":true,"state":"Downloaded"}\r\n{"ok":true,"state":"Completed"}\r\n')).toEqual({ ok: true, state: "Completed" });
    expect(store.parseScriptOutput("")).toMatchObject({ ok: false });
  });
  it("runs hidden Windows PowerShell from a temporary file and always cleans up", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
    const spawn = vi.fn(() => child);
    const fs = { writeFileSync: vi.fn(), rmSync: vi.fn() };
    const pending = store.runScript(spawn, "Say 1", { fs, directory: "C:/temp" });
    child.stdout.emit("data", '{"ok":true,"updates":0}\n');
    child.emit("close", 0);
    await expect(pending).resolves.toEqual({ ok: true, updates: 0 });
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { windowsHide: boolean }];
    expect(command).toBe("powershell.exe");
    expect(args).toContain("-File");
    expect(options.windowsHide).toBe(true);
    expect(String(fs.writeFileSync.mock.calls[0]?.[1]).startsWith("\uFEFF")).toBe(true);
    expect(fs.rmSync).toHaveBeenCalledOnce();
  });
  it("never rejects when PowerShell cannot start", async () => {
    const spawn = vi.fn(() => { throw new Error("ENOENT"); });
    await expect(store.runScript(spawn, "x", { fs: { writeFileSync: vi.fn(), rmSync: vi.fn() } })).resolves.toMatchObject({ ok: false, error: "ENOENT" });
  });
});

describe("Store update: quiet restart and WoW", () => {
  it("starts in the tray only right after an update", () => {
    expect(store.restartedAfterUpdate({ at: ago(3 * 60 * 1000) }, now)).toBe(true);
    expect(store.restartedAfterUpdate({ at: ago(20 * 60 * 1000) }, now)).toBe(false);
    expect(store.restartedAfterUpdate(null, now)).toBe(false);
  });
  it("sees a WoW client in tasklist output", () => {
    expect(store.wowRunningFrom('"WowClassic.exe","1","Console","1","1 K"')).toBe(true);
    expect(store.wowRunningFrom('"WowVoiceProxy.exe","1","Console","1","1 K"')).toBe(false);
    expect(store.wowRunningFrom("INFO: No tasks are running which match the specified criteria.")).toBe(false);
  });
});
