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

  it("asks a running companion to save and quit, then closes any left by name and waits", () => {
    expect(check).toContain("--quit-for-update");
    expect(nsis).toMatch(/IMAGENAME eq \$\{APP_EXECUTABLE_FILENAME\}/);
    expect(check).toMatch(/taskkill \/F \/T \/IM "\$\{APP_EXECUTABLE_FILENAME\}" \/FI "USERNAME eq %USERNAME%"/);
    // It loops until nothing is running, and asks the member only after ten seconds of trying.
    expect(check).toMatch(/Goto guilded_kill/);
    expect(check).toMatch(/\$R1 > 20/);
    // The quit request is sent only while a companion runs, so it never starts one.
    expect(check.indexOf("${GUILDED_FIND_RUNNING}")).toBeLessThan(check.indexOf("--quit-for-update"));
  });

  it("is the companion's answer to that request: save and quit, or exit at once when alone", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/if \(args\.includes\(QUIT_FOR_UPDATE\)\) \{ app\.exit\(0\);/);
    expect(main).toMatch(/second-instance", \(event, argv\) => \{[\s\S]{0,200}QUIT_FOR_UPDATE[\s\S]{0,300}installerHandedOff = true[\s\S]{0,120}app\.quit\(\)/);
  });
});
