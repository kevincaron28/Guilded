import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localTimes, syncDiagnosticPreview, zoneName } from "../companion/sync-status.mjs";

// 9.0 second-PC findings: only the start the installer launched ignored the 8.4.7 settings and
// saved nothing; a normal restart from the Start menu loaded and saved them. Plus four fixes.
const require = createRequire(import.meta.url);
const { loadSavedConfig, otherProcessCount } = require("../companion-app/config-load.cjs");
const { decideAddonInstall } = require("../companion-app/addon-installer.cjs");
const { runRepair } = require("../companion-app/repair.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const busy = (code: string) => Object.assign(new Error(`${code}: resource busy or locked`), { code });

describe("the start the installer launches", () => {
  it("is marked by the installer and waits for the old companion before reading settings", () => {
    const nsis = readFileSync("companion-app/installer.nsh", "utf8");
    const install = nsis.slice(nsis.indexOf("!macro customInstall"), nsis.indexOf("!macroend", nsis.indexOf("!macro customInstall")));
    expect(install).toContain('FileOpen $0 "$INSTDIR\\launched-by-installer" w');
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/INSTALLER_MARKER = [^\n]*path\.join\(path\.dirname\(process\.execPath\), "launched-by-installer"\)/);
    // Read and removed before anything else, then waited on before loadConfig.
    expect(main.indexOf("fs.rmSync(INSTALLER_MARKER")).toBeLessThan(main.indexOf("app.whenReady()"));
    const ready = main.slice(main.indexOf("app.whenReady()"));
    expect(ready.indexOf("if (launchedByInstaller) await waitForOtherCompanions();")).toBeLessThan(ready.indexOf("await loadConfig();"));
    expect(ready).toMatch(/Launch: working folder \{0\}, APPDATA \{1\}, user \{2\}, started by the installer: \{3\}\./);
  });

  it("counts an older companion and its helpers, never itself or its own helpers", () => {
    const rows = "4100,900\r\n4101,4100\r\n4102,4100\r\n7000,900\r\n7001,7000\r\n";
    expect(otherProcessCount(rows, 7000)).toBe(3);
    expect(otherProcessCount("7000,900\r\n7001,7000\r\n", 7000)).toBe(0);
    expect(otherProcessCount("", 7000)).toBe(0);
  });

  function setup() {
    const folder = mkdtempSync(join(tmpdir(), "guilded-installer-start-")); folders.push(folder);
    const file = join(folder, "config.secure");
    writeFileSync(file, "protected");
    const logs: string[] = [];
    const run = (store: object) => loadSavedConfig({ store, file, legacyFile: join(folder, "config.json"), isStore: false, defaults: { wowEnabled: true }, version: "9.0.0", log: (_level: string, key: string) => logs.push(key), sleep: async () => {} });
    return { run, logs };
  }

  it("reads a busy settings file again instead of giving up", async () => {
    const { run, logs } = setup();
    let calls = 0;
    const store = { migrate: vi.fn(async () => { if (++calls < 3) throw busy("EBUSY"); return { companionCredential: "kept" }; }), forgetUnreadable: vi.fn() };
    const { config, source } = await run(store);
    expect(source).toBe("file");
    expect(config.companionCredential).toBe("kept");
    expect(store.migrate).toHaveBeenCalledTimes(3);
    expect(store.forgetUnreadable).toHaveBeenCalledTimes(2);
    expect(logs.filter((key) => key.startsWith("The settings file was busy"))).toHaveLength(2);
  });

  it("does not start blank when the file is there but reads as missing for a moment", async () => {
    const { run } = setup();
    let calls = 0;
    const store = { migrate: vi.fn(async () => (++calls < 2 ? null : { companionCredential: "kept" })) };
    expect((await run(store)).config.companionCredential).toBe("kept");
  });

  it("stops retrying after five tries and keeps the file", async () => {
    const { run } = setup();
    const store = { migrate: vi.fn(async () => { throw busy("EPERM"); }), forgetUnreadable: vi.fn() };
    await expect(run(store)).rejects.toThrow(/could not be read/);
    expect(store.migrate).toHaveBeenCalledTimes(5);
  });

  it("has French for every new line", () => {
    for (const key of ["The settings file was busy ({0}); reading it again (try {1} of {2}).", "The settings file was not readable yet; reading it again (try {0} of {1}).", "Launch: working folder {0}, APPDATA {1}, user {2}, started by the installer: {3}.", "No older companion is running; reading the settings.", "Waiting for the older companion to close ({0} process(es))...", "The older companion is still running after 20 s; reading the settings anyway."]) expect(fr[key], key).toBeTruthy();
  });
});

describe("Repair and the addon", () => {
  const addon = (version: string | null) => ({ status: "ok", expected: "forever", installed: ["forever"], folder: "D:\\WoW\\_forever_\\Interface\\AddOns\\Guilded", version });

  it("offers Reinstall for a matching addon, and an update when the version is unknown", () => {
    expect(decideAddonInstall({ addon: addon("9.0.0"), companionVersion: "9.0.0" })).toEqual({ action: "none", reason: "up-to-date" });
    expect(decideAddonInstall({ addon: addon("9.0.0"), companionVersion: "9.0.0", force: true })).toEqual({ action: "update", reason: "reinstall" });
    expect(decideAddonInstall({ addon: addon(null), companionVersion: "9.0.0" })).toEqual({ action: "update", reason: "unknown-version" });
    expect(decideAddonInstall({ addon: addon("8.4.7"), companionVersion: "9.0.0" })).toEqual({ action: "update", reason: "older" });
  });

  const base = {
    wowEnabled: true, watchFile: () => "C:\\WoW\\_forever_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua", watchedFileExists: async () => true,
    searchWow: () => ({ entries: [], installs: [] }), pick: () => null, setWatchFile: async () => {},
    installAddon: async () => ({ version: "9.0.0", backup: null }), signedIn: () => true,
    me: async () => ({ ok: true, personal: false, account: { username: "pat" } }), syncConfigured: () => true, syncRunning: () => true, restartSync: async () => {}
  };

  it("names the version it compared, and flags settings not saved", async () => {
    const results = await runRepair({ ...base,
      addonDecision: async () => ({ action: "none", reason: "up-to-date", installed: "8.4.7", companion: "8.4.7" }),
      settingsSave: () => ({ lastError: { message: "Windows protected storage did not answer at encrypt.", at: "2026-11-06T22:00:00.000Z" }, lastSavedAt: "2026-11-06T17:02:21.000Z", stuck: null }) });
    const byId = Object.fromEntries(results.map((item: { id: string }) => [item.id, item]));
    expect(byId["addon"]).toEqual({ id: "addon", status: "ok", text: ["The Guilded addon {0} is installed, the version this companion ({1}) uses.", "8.4.7", "8.4.7"] });
    expect(byId["settings"]).toMatchObject({ status: "failed", text: ["Settings not saved since {0}: {1}", "2026-11-06T17:02:21.000Z", "Windows protected storage did not answer at encrypt."] });
    for (const item of results) expect(fr[item.text[0]], item.text[0]).toBeTruthy();
    const ok = await runRepair({ ...base, addonDecision: async () => ({ action: "none", reason: "up-to-date" }), settingsSave: () => ({ lastError: null, lastSavedAt: null, stuck: null }) });
    expect(ok.find((item: { id: string }) => item.id === "settings")).toMatchObject({ status: "ok" });
    expect(fr["Repair: {0} fixed, {1} need you, {2} failed."]).toMatch(/^Réparation/);
  });
});

describe("Home and the support summary", () => {

  it("shows local times with the offset, and names the zone", () => {
    expect(zoneName(-300)).toBe("UTC-05:00");
    expect(zoneName(330)).toBe("UTC+05:30");
    expect(localTimes({ at: "2026-11-06T20:47:08.000Z", list: [{ at: "2026-11-06T20:47:08Z" }], other: "text" }, -300))
      .toEqual({ at: "2026-11-06T15:47:08-05:00", list: [{ at: "2026-11-06T15:47:08-05:00" }], other: "text" });
    const summary = syncDiagnosticPreview({}, { recentErrors: [{ at: "2026-11-06T20:47:08.000Z", operation: "upload", host: "guilded.kcaron.top", status: 504, durationMs: 20000 }] }, { utcOffsetMinutes: -300 });
    expect(summary.timeZone).toBe("UTC-05:00");
    expect(summary.recentErrors[0].at).toBe("2026-11-06T15:47:08-05:00");
    // Without the offset (older callers) nothing changes.
    expect(syncDiagnosticPreview({}, {}, {})).not.toHaveProperty("timeZone");
  });
});
