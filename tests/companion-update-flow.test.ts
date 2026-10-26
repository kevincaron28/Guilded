import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const realUpdates = require("../companion-app/update-check.cjs");
const i18n = require("../companion-app/i18n.cjs");
const installer = { name: "setup.exe", url: "https://github.com/kevincaron28/Guilded/releases/download/v7.3.0/setup.exe" };
function harness(latest: unknown, locale = 'en', windowsStore = false) {
  const handlers = new Map<string, () => Promise<{ ok: boolean; action?: string }>>();
  const openExternal = vi.fn();
  const updates = { ...realUpdates, fetchLatestRelease: vi.fn(async () => latest), downloadInstaller: vi.fn(), launchInstaller: vi.fn() };
  const quit = vi.fn();
  const timers = vi.fn();
  const context = {
    require: (id: string) => id === "electron" ? {
      app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: vi.fn(), getVersion: () => "7.2.0", getLocale: () => locale, getPath: () => "C:/fake", quit },
      ipcMain: { handle: (name: string, callback: () => Promise<{ ok: boolean }>) => handlers.set(name, callback) },
      shell: { openExternal }, Notification: { isSupported: () => false }
    } : id === "./i18n.cjs" ? i18n : id === "./update-check.cjs" ? updates : id === "./detect-wow.cjs" ? {} : id === "node:fs" ? { mkdirSync: vi.fn(), writeFileSync: vi.fn() } : require(id),
    process: { argv: [], windowsStore }, __dirname: "C:/fake", setTimeout: timers, setInterval: vi.fn(), console
  };
  runInNewContext(readFileSync("companion-app/main.cjs", "utf8") + `
    engineModules = { validateConfig: () => [] };
    engine = { state: () => ({ botVersion: "7.3.0", running: true }) };
    refreshUpdate();
  `, context);
  return { handlers, updates, openExternal, timers };
}

describe("companion updater handoff", () => {
  it('keeps the updater action intact in French', async () => {
    const h = harness(null, 'fr-CA');
    expect(await h.handlers.get('install-update')!()).toMatchObject({ ok: true, action: 'download-page', message: i18n.translate('fr', 'The download page opened. Download and run the installer to finish updating.') });
    expect(h.openExternal).toHaveBeenCalledOnce();
  });
  it("uses installer metadata that arrives after the bot announces the same version", async () => {
    const h = harness({ version: "7.3.0", url: realUpdates.RELEASES_PAGE, installer });
    const result = await h.handlers.get("install-update")!();
    expect(result).toMatchObject({ ok: true, action: "installing" });
    expect(h.updates.downloadInstaller).toHaveBeenCalledWith(installer, expect.any(String), expect.any(Object));
    expect(h.updates.launchInstaller).toHaveBeenCalledOnce();
    expect(h.openExternal).not.toHaveBeenCalled();
    expect((await h.handlers.get("install-update")!()).ok).toBe(false);
  });
  it("does not report installing or quit when it only opens a download page", async () => {
    const h = harness(null);
    expect(await h.handlers.get("install-update")!()).toMatchObject({ ok: true, action: "download-page" });
    expect(h.openExternal).toHaveBeenCalledOnce();
    expect(h.updates.downloadInstaller).not.toHaveBeenCalled();
    expect(h.timers).not.toHaveBeenCalled();
  });
  it("allows retry and keeps the app open if Windows refuses the installer", async () => {
    const h = harness({ version: "7.3.0", installer });
    h.updates.launchInstaller.mockRejectedValueOnce(new Error("Access denied"));
    expect((await h.handlers.get("install-update")!()).ok).toBe(false);
    expect(h.timers).not.toHaveBeenCalled();
    expect((await h.handlers.get("install-update")!()).action).toBe("installing");
  });
  it("awaits spawn and catches asynchronous launch errors", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const pending = realUpdates.launchInstaller("setup.exe", spawn);
    child.emit("error", new Error("ENOENT"));
    await expect(pending).rejects.toThrow("ENOENT");
    expect(child.unref).not.toHaveBeenCalled();
    const nextChild = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawn.mockReturnValueOnce(nextChild);
    const success = realUpdates.launchInstaller("setup.exe", spawn);
    nextChild.emit("spawn");
    await success;
    expect(nextChild.unref).toHaveBeenCalledOnce();
  });
  it.each(["download-page", "installing"])("shows the actual %s outcome in the button", async action => {
    const source = readFileSync("companion-app/renderer/app.js", "utf8");
    const block = source.slice(source.indexOf("bind('btnUpdate'"), source.indexOf("api.onUpdateProgress"));
    const button = { textContent: "Update now" };
    let click: () => Promise<void> = async () => {};
    runInNewContext(block, { T: (key: string, ...values: unknown[]) => i18n.translate('en', key, ...values), bind: (_id: string, fn: () => Promise<void>) => { click = fn; }, $: () => button, toast: vi.fn(), api: { installUpdate: async () => ({ ok: true, action }) } });
    await click();
    expect(button.textContent).toBe(action === "installing" ? "Installing…" : "Update now");
  });
});


it("keeps MSIX updates in Microsoft Store even when GitHub advertises an EXE", async () => {
  const h = harness({ version: "7.3.0", installer }, "en", true);
  expect(await h.handlers.get("install-update")!()).toMatchObject({ ok: true, action: "store" });
  expect(h.openExternal).toHaveBeenCalledWith("ms-windows-store://downloadsandupdates");
  expect(h.updates.fetchLatestRelease).not.toHaveBeenCalled();
  expect(h.updates.downloadInstaller).not.toHaveBeenCalled();
  expect(h.updates.launchInstaller).not.toHaveBeenCalled();
  expect(h.timers).not.toHaveBeenCalled();
});
