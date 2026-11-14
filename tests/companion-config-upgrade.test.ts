import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateWatchFiles } from "../companion/saved-folder.mjs";
import { pruneBlankProfiles, savedProfiles } from "../companion/profiles.mjs";

// Release blocker (9.0): installing the 9.0 companion over a working 8.4.7 must keep the Discord
// sign-in, the WoW folder and every connection. This writes a settings file the way 8.4.7 does
// (its store-config.cjs format, its config shape with profiles) and loads it with 9.0's code.
const require = createRequire(import.meta.url);
const { createStoreConfig } = require("../companion-app/store-config.cjs");
const { loadSavedConfig, isUnset, configSummary, KEEP_VERSION_BACKUPS } = require("../companion-app/config-load.cjs");

// Windows protected storage stand-in: reversible, and refuses bytes it did not write.
const safeStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text: string) => Buffer.from("DPAPI:" + Buffer.from(text).toString("base64")),
  decryptStringAsync: async (data: Buffer) => {
    const text = data.toString();
    if (!text.startsWith("DPAPI:")) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
    return { result: Buffer.from(text.slice(6), "base64").toString(), shouldReEncrypt: false };
  }
};
// 8.4.7 writes config.secure as the protected JSON of the whole config object.
const write847 = (file: string, config: unknown) => writeFileSync(file, Buffer.from("DPAPI:" + Buffer.from(JSON.stringify(config)).toString("base64")));

const DEFAULTS = { watchFile: "", wowEnabled: true, poeEnabled: false, poeLogFile: "", poeCharacter: "", poeLeague: "", poeMode: "STANDARD", realm: "WoW Forever", wowGuild: "", uploadUrl: "", guildDiscordId: "", uploadToken: "", pairingCode: "", companionCredential: "", standingsIntervalMinutes: 2, autoUpdate: true };
const ACCOUNT = "D:\\Jeux\\World of Warcraft\\_forever_\\WTF\\Account\\PAT#1\\SavedVariables\\Guilded.lua";
// A real-world 8.4.7 file: the active connection at the top level, another one and a blank one saved.
const CONFIG_847 = {
  ...DEFAULTS,
  watchFile: ACCOUNT,
  wowGuild: "Les Gardiens",
  uploadUrl: "https://guilded.kcaron.top",
  guildDiscordId: "111111111111111111",
  companionCredential: "gcc_live_credential_value",
  profileName: "Les Gardiens",
  gameEdition: "forever",
  syncEnabled: true,
  poeJournalFile: "C:\\Users\\Pat\\AppData\\Roaming\\Guilded Companion\\poe-journal-connection-1.json",
  autostartAsked: true,
  lastRunVersion: "8.4.7",
  updateNotifiedVersion: "8.4.7",
  liveFolderNotified: ACCOUNT,
  activeProfile: "connection-1",
  profiles: {
    default: { ...DEFAULTS, uploadUrl: "https://guilded.kcaron.top", companionCredential: "gcc_other_credential", watchFile: "C:\\WoW\\_forever_\\WTF\\Account\\PAT#2\\SavedVariables\\Guilded.lua", personal: true, syncEnabled: true, pairingCode: "" },
    "connection-2": { profileName: "Empty", wowEnabled: true, poeEnabled: false, personal: false, uploadUrl: "", guildDiscordId: "", companionCredential: "", pairingCode: "", watchFile: "", wowGuild: "", realm: "", standingsIntervalMinutes: 2 }
  }
};

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function setup() {
  const folder = mkdtempSync(join(tmpdir(), "guilded-upgrade-")); folders.push(folder);
  const file = join(folder, "config.secure");
  const logs: { level: string; key: string; values: unknown[] }[] = [];
  const store = createStoreConfig(safeStorage);
  const load = (version = "9.0.0", isStore = false) => loadSavedConfig({ store, file, legacyFile: join(folder, "config.json"), isStore, defaults: DEFAULTS, version, log: (level: string, key: string, ...values: unknown[]) => logs.push({ level, key, values }) });
  return { folder, file, logs, store, load };
}

describe("upgrading 8.4.7 to 9.0 keeps the settings", () => {
  it("loads an 8.4.7 file with its sign-in, folder and every connection", async () => {
    const { file, load } = setup();
    write847(file, CONFIG_847);
    const { config, source } = await load();
    expect(source).toBe("file");
    expect(config.companionCredential).toBe("gcc_live_credential_value");
    expect(config.watchFile).toBe(ACCOUNT);
    expect(config.activeProfile).toBe("connection-1");
    expect(Object.keys(savedProfiles(config)).sort()).toEqual(["connection-1", "connection-2", "default"]);
    expect(savedProfiles(config).default.companionCredential).toBe("gcc_other_credential");
  });

  it("keeps them through 9.0's start-up repairs", async () => {
    const { file, load } = setup();
    write847(file, CONFIG_847);
    let { config } = await load();
    const paths = migrateWatchFiles(config); if (paths.changed) config = paths.config;
    const pruned = pruneBlankProfiles(config); if (pruned.changed) config = pruned.config;
    expect(config.companionCredential).toBe("gcc_live_credential_value");
    expect(config.watchFile).toBe(ACCOUNT);
    expect(config.activeProfile).toBe("connection-1");
    // Only the blank saved connection goes; the other signed-in one stays.
    expect(Object.keys(config.profiles)).toEqual(["default"]);
    expect(config.profiles.default.companionCredential).toBe("gcc_other_credential");
  });

  it("keeps the 8.4.7 file byte for byte before anything rewrites it", async () => {
    const { file, folder, load } = setup();
    write847(file, CONFIG_847);
    const original = readFileSync(file);
    await load("9.0.0");
    expect(readFileSync(join(folder, "config.secure.before-9.0.0.bak"))).toEqual(original);
    expect(readFileSync(join(folder, "config.secure.bak"))).toEqual(original);
    // The next start of the same version does not replace that copy.
    write847(file, { ...CONFIG_847, wowGuild: "Changed" });
    await load("9.0.0");
    expect(readFileSync(join(folder, "config.secure.before-9.0.0.bak"))).toEqual(original);
  });

  it("keeps only the last few version backups", async () => {
    const { file, folder, load } = setup();
    write847(file, CONFIG_847);
    const versions = ["8.5.0", "8.6.0", "8.7.0", "8.8.0", "9.0.0"];
    for (const [index, version] of versions.entries()) {
      await load(version);
      const made = join(folder, `config.secure.before-${version}.bak`);
      if (existsSync(made)) utimesSync(made, new Date(2026, 0, index + 1), new Date(2026, 0, index + 1));
    }
    const kept = readdirSync(folder).filter((name) => name.includes(".before-")).sort();
    expect(kept).toHaveLength(KEEP_VERSION_BACKUPS);
    expect(kept).toContain("config.secure.before-9.0.0.bak");
  });

  it("says where it looked and what it found, without the credential", async () => {
    const { file, logs, load } = setup();
    write847(file, CONFIG_847);
    await load();
    const line = logs.find((entry) => entry.key.startsWith("Settings loaded from"));
    expect(line?.values).toEqual([file, statSync(file).size, expect.any(String), 3, "yes", "yes"]);
    expect(JSON.stringify(logs)).not.toContain("gcc_");
  });

  it("puts the settings back from a backup when the file is gone", async () => {
    const { file, folder, logs, load } = setup();
    write847(file, CONFIG_847);
    await load("9.0.0");
    rmSync(file);
    const { config, source } = await load("9.0.0");
    expect(source).toBe("backup");
    expect(config.companionCredential).toBe("gcc_live_credential_value");
    expect(existsSync(file)).toBe(true);
    expect(logs.some((entry) => entry.level === "warn" && entry.key.includes("restored from"))).toBe(true);
    // A plain first start (no file, no backup) starts blank and says so.
    rmSync(folder, { recursive: true, force: true });
    const fresh = setup();
    expect((await fresh.load()).source).toBe("none");
    expect(fresh.logs.at(-1)?.key).toContain("starting with a new setup");
  });

  it("does not undo a sign-out: a file that exists is used as it is", async () => {
    const { file, load } = setup();
    write847(file, CONFIG_847);
    await load("9.0.0");
    write847(file, { ...DEFAULTS, autostartAsked: true });
    const { config, source } = await load("9.0.0");
    expect(source).toBe("file");
    expect(config.companionCredential).toBe("");
  });

  it("never overwrites a file it could not read, and says why", async () => {
    const { file, logs, store, load } = setup();
    writeFileSync(file, "not protected by this Windows account");
    const before = readFileSync(file);
    await expect(load()).rejects.toThrow(/could not be read .*kept/);
    expect(logs.at(-1)).toMatchObject({ level: "error" });
    await expect(store.write(file, { ...DEFAULTS, autostartAsked: true })).rejects.toThrow(/kept as they are/);
    await store.flush().catch(() => {});
    expect(readFileSync(file)).toEqual(before);
  });

  it("reads the Microsoft Store build's file the same way", async () => {
    const { file, load } = setup();
    write847(file, CONFIG_847);
    expect((await load("9.0.0", true)).config.companionCredential).toBe("gcc_live_credential_value");
  });
});

describe("what counts as set up", () => {
  it("tells a new setup from a real one", () => {
    expect(isUnset({ ...DEFAULTS, autostartAsked: true })).toBe(true);
    expect(isUnset(CONFIG_847)).toBe(false);
    expect(isUnset({ ...DEFAULTS, profiles: { other: { companionCredential: "x" } } })).toBe(false);
    expect(configSummary(CONFIG_847)).toEqual({ connections: 3, active: "connection-1", signedIn: true, wowFolder: true });
  });

  it("is shipped with the app and used at start", () => {
    const pkg = JSON.parse(readFileSync("companion-app/package.json", "utf8"));
    expect(pkg.build.files).toContain("config-load.cjs");
    expect(readFileSync("companion-app/main.cjs", "utf8")).toContain("configLoadModule().loadSavedConfig");
  });
});

describe("the installer closes the old companion before replacing files", () => {
  const nsis = readFileSync("companion-app/installer.nsh", "utf8");
  const check = nsis.slice(nsis.indexOf("!macro customCheckAppRunning"));
  // The closer only (the store replacement and uninstall parts below and above have their own commands).
  const closer = nsis.slice(nsis.indexOf("; Before any file is replaced"), nsis.indexOf("; Replace a Microsoft Store"));

  it("asks a running companion to quit with a request file, never by starting it a second time", () => {
    // Starting the exe again made an older companion flash its window.
    expect(check).not.toMatch(/ExecWait|Exec '"\$INSTDIR/);
    expect(check).toMatch(/FileOpen \$R3 "\$APPDATA\\\$\{PRODUCT_NAME\}\\quit-for-update" w/);
    // Only while a companion runs: the request is written after the first find.
    expect(check.indexOf("!insertmacro GUILDED_FIND")).toBeLessThan(check.indexOf("quit-for-update"));
    // And removed afterwards, also when the install is cancelled or a silent run stops.
    expect(check.match(/Delete "\$APPDATA\\\$\{PRODUCT_NAME\}\\quit-for-update"/g)).toHaveLength(3);
  });

  it("ends the companion by exe name only: no process tree, never the installer", () => {
    // The companion's own update starts this installer as a child of the app: a tree kill would end it too.
    expect(closer).not.toMatch(/taskkill[^\n]*\/T/);
    expect(closer).toContain('taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"');
    // The path-based close skips its own PowerShell and its parent (the installer), by process id.
    expect(closer).toContain("$$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$me");
    expect(closer).toContain("ParentProcessId");
    expect(closer).toContain("Stop-Process -Id $$_.ProcessId -Force");
    expect(check).not.toMatch(/RMDir[^\n]*[^L]\$APPDATA/);
  });

  it("matches by path with a trailing backslash, never on an empty folder, and quote-safe", () => {
    // "...\Guilded Companion" must not match "...\Guilded Companion Beta".
    expect(closer).toContain("$$d.TrimEnd('\\') + '\\'");
    expect(closer).toContain("StartsWith($$d, [System.StringComparison]::OrdinalIgnoreCase)");
    // An empty folder matches nothing.
    expect(closer).toContain("if ($$d) {");
    expect(check).toMatch(/\$\{if\} \$INSTDIR != ""\s+System::Call 'kernel32::SetEnvironmentVariable\(t "GUILDED_INSTDIR", t "\$INSTDIR"\)/);
    // The folder reaches PowerShell through the environment, never inside the command text (a name like O'Brien).
    expect(closer).toContain("$$env:GUILDED_INSTDIR");
    expect(closer).not.toContain("StartsWith('$INSTDIR'");
  });

  it("is bounded by the clock and never hangs, and a silent run stops with exit code 2 instead of half-replacing", () => {
    // 6 s for a clean quit, 25 s of closing in all, one path-based round after 10 s.
    expect(check).toMatch(/\$\{if\} \$R6 < 6000\s+Sleep 500\s+Goto guilded_wait_graceful/);
    expect(check).toMatch(/\$\{if\} \$R6 > 10000\s+\$\{andIf\} \$R9 == "no"[\s\S]*GUILDED_PATHKILL/);
    expect(check).toMatch(/\$\{if\} \$R6 < 25000\s+Sleep 500\s+Goto guilded_kill/);
    // Every external command has a time limit.
    expect(nsis.match(/nsExec::ExecToStack \/TIMEOUT=\d+/g)).toHaveLength(3);
    expect(closer).not.toMatch(/nsExec::Exec `/);
    // Still locked: a silent run exits with code 2 (the old install stays), otherwise the member decides.
    expect(check).toMatch(/\$\{if\} \$\{Silent\}\s+Delete "[^\n]*quit-for-update"\s+SetErrorLevel 2\s+Quit\s+\$\{endIf\}\s+MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$\(appCannotBeClosed\)" \/SD IDCANCEL IDRETRY guilded_close_round/);
    // The test for "closed" is the exe: it cannot be opened for writing while it runs.
    expect(closer).toContain('FileOpen $R3 "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" a');
  });

  it("a manual run does not depend on the old uninstaller and starts the companion again", () => {
    // 13 November: a manual run closed the companion and still ended with exit code 2 (the old uninstaller's own check).
    expect(check).toMatch(/\$\{ifNot\} \$\{isUpdated\}[\s\S]{0,900}DeleteRegValue SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString/);
    // Only once the companion is closed, and only in the installer: the app's own update (--updated) keeps the usual path.
    expect(check.indexOf('GUILDED_LOG "closed; going on"')).toBeLessThan(check.indexOf("DeleteRegValue SHELL_CONTEXT"));
    expect(check).toMatch(/!ifndef BUILD_UNINSTALLER\s+StrCpy \$guildedWasRunning "1"/);
    // A silent run that closed a companion starts it again; the app's own update does that with --force-run, an interactive run at the end.
    expect(nsis).toMatch(/\$\{if\} \$guildedWasRunning == "1"\s+\$\{andIf\} \$\{Silent\}\s+\$\{andIfNot\} \$\{isForceRun\}\s+(?:;[^\r\n]*\s+)?\$\{StdUtils\.ExecShellAsUser\} \$0 "\$launchLink" "open" ""/);
    expect(nsis.indexOf("launched-by-installer")).toBeLessThan(nsis.indexOf("StdUtils.ExecShellAsUser"));
  });

  it("sets the uninstall entry aside instead of losing it, and puts it back when the install does not finish", () => {
    // Saved before it is deleted, in both uninstall keys.
    expect(check).toMatch(/WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" GuildedUninstallStringBackup "\$R0"\s+DeleteRegValue SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString/);
    expect(check).toMatch(/WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY_2\}" GuildedUninstallStringBackup "\$R0"/);
    // Written back when the install fails, and at the start of the next run (a cancelled or killed install).
    expect(nsis).toMatch(/Function \.onInstFailed\s+!insertmacro GUILDED_RESTORE_UNINSTALL\s+FunctionEnd/);
    expect(check).toMatch(/StrCpy \$guildedWasRunning "0"[\s\S]{0,200}!insertmacro GUILDED_RESTORE_UNINSTALL/);
    // Only when the entry is missing: a new one is never overwritten. A finished install drops the copy.
    expect(nsis).toMatch(/\$\{if\} \$R0 != ""\s+\$\{andIf\} \$R1 == ""\s+WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString "\$R0"/);
    expect(nsis).toMatch(/launched-by-installer[\s\S]*DeleteRegValue SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" GuildedUninstallStringBackup/);
  });

  it("clears the installer copy folder on the manual path, never the data folder", () => {
    expect(check).toMatch(/!insertmacro GUILDED_LOG "old uninstaller skipped"/);
    expect(check).toMatch(/RMDir \/r "\$LOCALAPPDATA\\guilded-companion-updater"\s+!insertmacro GUILDED_LOG "old uninstaller skipped"/);
    expect(check).not.toMatch(/RMDir[^\n]*[^L]\$APPDATA/);
  });

  it("keeps the installer's log lines when the old uninstaller adds its own (tagged, truncated only by the installer)", () => {
    expect(check).toMatch(/!ifndef BUILD_UNINSTALLER\s+ClearErrors\s+FileOpen \$R4 "\$TEMP\\guilded-companion-installer\.log" w/);
    expect(nsis).toContain('"[uninstaller] ${TEXT}');
    expect(nsis).toContain('"[installer] ${TEXT}');
  });

  it("logs what it did in one place, without paths or user names", () => {
    expect(nsis).toContain("guilded-companion-installer.log");
    expect(nsis).not.toMatch(/USERNAME|\$\{USERNAME\}|whoami/);
    // The log is rewritten on every run, so it stays small.
    expect(check).toMatch(/FileOpen \$R4 "\$TEMP\\guilded-companion-installer\.log" w/);
    // The "running" lines come from tasklist (image name and ids only).
    expect(nsis).toContain("tasklist /FI");
  });

  it("is the companion's answer: save and quit on the request file or a second launch, never start one", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/if \(args\.includes\(QUIT_FOR_UPDATE\)\) \{ app\.exit\(0\);/);
    expect(main).toContain('const QUIT_REQUEST_FILE = "quit-for-update";');
    expect(main).toMatch(/function quitForUpdate\(source\) \{[\s\S]{0,700}installerHandedOff = true[\s\S]{0,200}app\.quit\(\);/);
    expect(main).toMatch(/function checkQuitRequest\(\) \{[\s\S]{0,200}fs\.rmSync\(quitRequestPath\(\)[\s\S]{0,80}quitForUpdate\("installer request"\)/);
    expect(main).toMatch(/second-instance", \(event, argv\) => \{\s*if \(Array\.isArray\(argv\) && argv\.includes\(QUIT_FOR_UPDATE\)\) \{ quitForUpdate\("second launch"\); return; \}/);
    // A stale request is dropped at start, then the file is checked every second.
    const ready = main.slice(main.indexOf("app.whenReady()"));
    expect(ready.indexOf("fs.rmSync(quitRequestPath()")).toBeLessThan(ready.indexOf("setInterval(checkQuitRequest, 1000)"));
  });

  it("keeps startup.log across starts", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).not.toMatch(/writeFileSync\(path\.join\(app\.getPath\("userData"\), "startup\.log"\), ""\)/);
    expect(main).toMatch(/size > 256 \* 1024\) fs\.renameSync\(log, log \+ "\.1"\)/);
    expect(main).toMatch(/fs\.appendFileSync\(log, `----- \$\{new Date\(\)\.toISOString\(\)\} start, pid/);
  });
});
