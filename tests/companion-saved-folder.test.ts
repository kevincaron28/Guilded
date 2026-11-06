import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NOT_SAVED_YET, createEngine, describeError } from "../companion/engine.mjs";
import { migrateWatchFiles, normalizeSavedPath } from "../companion/saved-folder.mjs";
import { planProfiles } from "../companion/profile-engine.mjs";
import { pruneBlankProfiles } from "../companion/profiles.mjs";

const { pickSavedVariables, rankSavedVariables, hasDatabase } = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");

const folders: string[] = [];

// A member's companion watched WTF\Account\988134169#1\91\Hulke-Hogan\SavedVariables (a CHARACTER folder; on
// WoW Forever the realm folder is a number). GuildedDB lives only in the account's SavedVariables.
const ACCOUNT = "C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF\\Account\\988134169#1";

describe("normalizeSavedPath", () => {
  it("moves a character-level file to the account's SavedVariables, numeric realm folder and #1 account included", () => {
    expect(normalizeSavedPath(`${ACCOUNT}\\91\\Hulke-Hogan\\SavedVariables\\Guilded.lua`)).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
  });
  it("handles a picked character folder, the account folder itself and a bare file in the account folder", () => {
    expect(normalizeSavedPath(`${ACCOUNT}\\91\\Hulke-Hogan\\SavedVariables`, "Guilded.lua")).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect(normalizeSavedPath(`${ACCOUNT}\\91\\Hulke-Hogan`, "Guilded.lua")).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect(normalizeSavedPath(ACCOUNT, "Guilded.lua")).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect(normalizeSavedPath(`${ACCOUNT}\\Guilded.lua`)).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect(normalizeSavedPath(`${ACCOUNT}\\91\\Hulke-Hogan\\SavedVariables\\`, "")).toBe(`${ACCOUNT}\\SavedVariables`);
  });
  it("leaves account-level paths, other folders and forward slashes alone", () => {
    const good = `${ACCOUNT}\\SavedVariables\\Guilded.lua`;
    expect(normalizeSavedPath(good)).toBe(good);
    expect(normalizeSavedPath("D:\\Backups\\Guilded.lua")).toBe("D:\\Backups\\Guilded.lua");
    expect(normalizeSavedPath("")).toBe("");
    expect(normalizeSavedPath("C:/WoW/_forever_/wtf/account/ACCT/91/Name/SavedVariables/Guilded.lua")).toBe("C:/WoW/_forever_/wtf/account/ACCT/SavedVariables/Guilded.lua");
  });
  it("migrates the active settings and every saved profile", () => {
    const bad = `${ACCOUNT}\\91\\Hulke-Hogan\\SavedVariables\\Guilded.lua`;
    const { config, changed } = migrateWatchFiles({ watchFile: bad, profiles: { frumpy: { watchFile: bad }, other: { watchFile: "" } } });
    expect(changed).toBe(true);
    expect(config.watchFile).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect((config.profiles as Record<string, { watchFile: string }>)["frumpy"]!.watchFile).toBe(`${ACCOUNT}\\SavedVariables\\Guilded.lua`);
    expect(migrateWatchFiles(config).changed).toBe(false);
  });
});

describe("account choice", () => {
  const entry = (account: string, modifiedMs: number, hasDatabase: boolean | undefined, game = "_forever_") => ({ path: `C:\\WoW\\${game}\\WTF\\Account\\${account}\\SavedVariables\\Guilded.lua`, exists: true, game, account, modifiedMs, hasDatabase });
  it("prefers the account whose file holds GuildedDB", () => {
    expect(pickSavedVariables([entry("111#1", 5, false), entry("222#2", 1, true)]).account).toBe("222#2");
    expect(rankSavedVariables([entry("111#1", 5, false), entry("222#2", 1, true)])[0].account).toBe("222#2");
  });
  it("takes the clearly newest of several accounts with GuildedDB, and asks when they are too close", () => {
    expect(pickSavedVariables([entry("111#1", 10_000_000, true), entry("222#2", 1_000, true)]).account).toBe("111#1");
    expect(pickSavedVariables([entry("111#1", 1_000_000, true), entry("222#2", 1_000_100, true)])).toBeNull();
  });
  it("keeps asking when nothing tells the accounts apart", () => {
    expect(pickSavedVariables([entry("111#1", 1, false), entry("222#2", 2, false)])).toBeNull();
  });
  it("tells the account file (GuildedDB) from a character file (GuildedPresenceDB) on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "guilded-detect-")); folders.push(dir);
    const character = join(dir, "character.lua"), account = join(dir, "account.lua");
    writeFileSync(character, "GuildedPresenceDB = {}" + String.fromCharCode(10));
    writeFileSync(account, "GuildedDB = {}" + String.fromCharCode(10));
    expect(hasDatabase(character)).toBe(false);
    expect(hasDatabase(account)).toBe(true);
    expect(hasDatabase(join(dir, "missing.lua"))).toBe(false);
  });
});

describe("a blank leftover connection", () => {
  const frumpy = { uploadUrl: "https://bot.test/api/v1/addon-imports", companionCredential: "x".repeat(43), guildDiscordId: "1", watchFile: `${ACCOUNT}\\SavedVariables\\Guilded.lua`, syncEnabled: true };
  it("is not started once another connection is set up", () => {
    const plans = planProfiles({ activeProfile: "frumpy", ...frumpy, profiles: { default: { syncEnabled: true } } });
    expect(plans.find((plan) => plan.id === "default")!.enabled).toBe(false);
    expect(plans.find((plan) => plan.id === "frumpy")!.enabled).toBe(true);
  });
  it("still starts when it is the only connection", () => {
    expect(planProfiles({ activeProfile: "default" }).find((plan) => plan.id === "default")!.enabled).toBe(true);
  });
  it("is dropped from saved profiles at startup, never the active one", () => {
    const { config, changed } = pruneBlankProfiles({ activeProfile: "frumpy", ...frumpy, profiles: { default: { syncEnabled: true }, keep: frumpy } });
    expect(changed).toBe(true);
    expect(Object.keys(config.profiles as object)).toEqual(["keep"]);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function install(accountFile: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "guilded-folder-")); folders.push(dir);
  const account = join(dir, "WTF", "Account", "988134169#1");
  const characterSaved = join(account, "91", "Hulke-Hogan", "SavedVariables");
  const accountSaved = join(account, "SavedVariables");
  mkdirSync(characterSaved, { recursive: true }); mkdirSync(accountSaved, { recursive: true });
  writeFileSync(join(characterSaved, "Guilded.lua"), "GuildedPresenceDB = {}\n");
  if (accountFile !== null) writeFileSync(join(accountSaved, "Guilded.lua"), accountFile);
  return { watchFile: join(characterSaved, "Guilded.lua"), accountFile: join(accountSaved, "Guilded.lua"), uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "123", companionCredential: "x".repeat(43), realm: "R" };
}

describe("engine with a character-level file", () => {
  it("watches the account file instead", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ protocolVersion: 2, updatedAt: "now", standings: [] }) })));
    const config = install('GuildedDB={version=4,addonVersion="8.4.5"}');
    const engine = createEngine(config);
    try { await engine.start(); expect(engine.state().watching).toBe(config.accountFile); } finally { await engine.stop(); }
  });

  it("says plainly that Guilded has not saved yet, once, however many retries follow", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ protocolVersion: 2, updatedAt: "now", standings: [] }) })));
    const config = install("GuildedPresenceDB={}\n");
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine(config, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      await engine.start();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      const problems = logs.filter((entry) => entry.level === "error");
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((entry) => entry.message.includes(NOT_SAVED_YET))).toBe(true);
      expect(new Set(problems.map((entry) => entry.message)).size).toBe(problems.length);
      expect(problems.length).toBeLessThanOrEqual(2); // one for the upload, one for the standings
      expect(logs.some((entry) => /GuildedDB was not found/.test(entry.message))).toBe(false);
    } finally { await engine.stop(); }
  });

  it("describes a missing saved file the same way", () => {
    expect(describeError(new Error("GuildedDB was not found in the SavedVariables file."))).toBe(NOT_SAVED_YET);
    expect(describeError(Object.assign(new Error("ENOENT: no such file or directory, open 'C:\\x\\Guilded.lua'"), { code: "ENOENT" }))).toBe(NOT_SAVED_YET);
    expect(describeError(new Error("Something else"))).toBe("Something else");
  });
});
