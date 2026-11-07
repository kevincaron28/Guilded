import { fileURLToPath } from "node:url";
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
  const frame = { url: new URL("../companion-app/renderer/index.html", import.meta.url).href };
  const contents = { mainFrame: frame, send: vi.fn() };
  const event = { sender: contents, senderFrame: frame };
  const context = {
    ipcTestContents: contents,
    require: (id: string) => id === "electron" ? {
      app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: vi.fn(), getVersion: () => "7.2.0", getLocale: () => locale, getPath: () => "C:/fake", setPath: vi.fn(), quit },
      ipcMain: { handle: (name: string, callback: () => Promise<{ ok: boolean }>) => handlers.set(name, () => (callback as (...args: unknown[]) => Promise<{ ok: boolean }>)(event)) },
      shell: { openExternal }, Notification: { isSupported: () => false }
    } : id === "./ipc-security.cjs" ? require("../companion-app/ipc-security.cjs") : id === "./store-config.cjs" ? require("../companion-app/store-config.cjs") : id === "./i18n.cjs" ? i18n : id === "./update-check.cjs" ? updates : id === "./detect-wow.cjs" ? {} : id === "./link-identity.cjs" ? require("../companion-app/link-identity.cjs") : id === "./disk-space.cjs" ? require("../companion-app/disk-space.cjs") : id === "node:fs" ? { mkdirSync: vi.fn(), writeFileSync: vi.fn() } : require(id),
    process: { argv: [], windowsStore }, __dirname: fileURLToPath(new URL("../companion-app/", import.meta.url)), setTimeout: timers, setInterval: vi.fn(), console
  };
  runInNewContext(readFileSync("companion-app/main.cjs", "utf8") + `
    win = { webContents: ipcTestContents };
    storeConfig = { write: async () => {}, flush: async () => {} };
    engineModules = { validateConfig: () => [] };
    engine = { state: () => ({ botVersion: "7.3.0", running: true }) };
    refreshUpdate();
  `, context);
  return { handlers, updates, openExternal, timers };
}

describe("companion updater handoff", () => {
  it('keeps the updater action intact in French', async () => {
    const h = harness({ version: "7.3.0", url: realUpdates.RELEASES_PAGE }, 'fr-CA');
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
    const h = harness({ version: "7.3.0", url: realUpdates.RELEASES_PAGE });
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
  it("does not offer an unavailable client just because the backend is newer", async () => {
    const h = harness(null);
    expect(await h.handlers.get("install-update")!()).toMatchObject({ ok: false });
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(h.updates.downloadInstaller).not.toHaveBeenCalled();
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
  // Update now lives in Home's version panel (#511); the old hidden banner button is gone (redesign PR 5).
  it.each([["download-page", "The download page opened."], ["installing", "Installing Guilded Companion 9.1.0."]])("shows the actual %s outcome in the version panel", async (action, message) => {
    const source = readFileSync("companion-app/renderer/app.js", "utf8");
    const block = source.slice(source.indexOf("bind('btnVersionAction'"), source.indexOf("bind('btnVersionCheck'"));
    const nodes: Record<string, { textContent: string; className: string; dataset: Record<string, string> }> = {};
    const node = (id: string) => (nodes[id] ??= { textContent: "", className: "", dataset: {} });
    let click: () => Promise<void> = async () => {};
    let seenWhileWaiting = "";
    runInNewContext(block, {
      T: (key: string, ...values: unknown[]) => i18n.translate('en', key, ...values), M: (value: string) => value,
      bind: (_id: string, fn: () => Promise<void>) => { click = fn; }, $: node, versionInfo: { action: "update-now" }, refreshVersion: async () => {},
      api: { installUpdate: async () => { seenWhileWaiting = node("btnVersionAction").textContent; return { ok: true, action, message }; } }
    });
    await click();
    expect(seenWhileWaiting).toBe("Checking update…");
    expect(node("versionResult")).toMatchObject({ textContent: message, className: "result ok" });
    expect(node("btnVersionAction").dataset["busy"]).toBeUndefined();
  });
});


it("keeps MSIX updates in Microsoft Store even when GitHub advertises an EXE", async () => {
  const h = harness({ version: "7.3.0", installer }, "en", true);
  expect(await h.handlers.get("install-update")!()).toMatchObject({ ok: true, action: "store" });
  // (9.0.x) Straight to the Guilded Companion listing, not the Store's general Downloads page.
  expect(h.openExternal).toHaveBeenCalledWith("ms-windows-store://pdp/?ProductId=9N680XX3QFL9");
  expect(h.updates.fetchLatestRelease).not.toHaveBeenCalled();
  expect(h.updates.downloadInstaller).not.toHaveBeenCalled();
  expect(h.updates.launchInstaller).not.toHaveBeenCalled();
  expect(h.timers).not.toHaveBeenCalled();
});
