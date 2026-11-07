import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileEngine, planProfiles } from "../companion/profile-engine.mjs";
import { accountFiles, accountName, accountRows, answerAccount, MAX_ACCOUNTS, newAccounts, switchAccount } from "../companion/wow-accounts.mjs";

// docs/plans/MULTI_ACCOUNT.md, step 1 (owner decisions, 7 November 2026): sync every WoW account
// folder found, but add a second one only after the member says once that it is theirs too.
const require = createRequire(import.meta.url);
const detect = require("../companion-app/detect-wow.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

const install = "D:/Games/World of Warcraft/_forever_/WTF/Account";
const file = (account: string) => `${install}/${account}/SavedVariables/Guilded.lua`;
const wow1 = file("WOW1"), wow2 = file("WOW2"), wow3 = file("WOW3");
const entry = (path: string, more = {}) => ({ path, exists: true, hasDatabase: true, ...more });
const guild = { uploadUrl: "https://bot.example/api/v1/companion/upload", guildDiscordId: "g", companionCredential: "c", wowGuildId: "w", watchFile: wow1 };

describe("which accounts sync", () => {
  it("a single-account setup is exactly as before", () => {
    expect(accountFiles({ watchFile: wow1 })).toEqual([wow1]);
    const plans = planProfiles(guild);
    expect(plans.map((p) => [p.id, p.config.watchFile, p.enabled])).toEqual([["default", wow1, true]]);
    expect(plans[0]).toMatchObject({ account: "WOW1" });
  });

  it("each account the member said yes to runs as its own engine; only the first writes the shared standings", () => {
    const plans = planProfiles({ ...guild, watchFiles: [wow2] });
    expect(plans.map((p) => [p.id, p.config.watchFile, p.enabled, p.writesStandings])).toEqual([["default", wow1, true, true], ["default~2", wow2, true, false]]);
    expect(plans[1]).toMatchObject({ accountOf: "default", account: "WOW2", name: "default", error: null });
    expect(plans[1]!.config.poeEnabled).toBe(false);
  });

  it("drops repeats, accounts of another install, and stops at the limit", () => {
    expect(accountFiles({ watchFile: wow1, watchFiles: [wow2, wow2.toUpperCase(), "C:/Other/WTF/Account/X/SavedVariables/Guilded.lua"] })).toEqual([wow1, wow2]);
    const many = Array.from({ length: 12 }, (_, index) => file(`WOW${index + 2}`));
    expect(accountFiles({ watchFile: wow1, watchFiles: many })).toHaveLength(MAX_ACCOUNTS);
    expect(accountName(wow2)).toBe("WOW2");
  });

  it("a paused connection pauses all its accounts", () => {
    const plans = planProfiles({ ...guild, activeProfile: "a", profiles: { b: { ...guild, watchFile: file("B1"), watchFiles: [file("B2")], syncEnabled: false } } });
    expect(plans.filter((p) => p.id.startsWith("b")).map((p) => p.enabled)).toEqual([false, false]);
  });
});

describe("asking once", () => {
  it("asks about another account of the same install that holds Guilded's data", () => {
    const entries = [entry(wow1), entry(wow2), entry(wow3, { hasDatabase: false }), entry(file("WOW4"), { exists: false }), entry("C:/Other/WTF/Account/X/SavedVariables/Guilded.lua")];
    expect(newAccounts({ watchFile: wow1 }, entries)).toEqual([{ path: wow2, account: "WOW2" }]);
    expect(newAccounts({ watchFile: wow1, wowEnabled: false }, entries)).toEqual([]);
    expect(newAccounts({}, entries)).toEqual([]);
  });

  it("yes adds it; no is remembered and never asked again", () => {
    const yes = answerAccount({ watchFile: wow1 }, wow2, true);
    expect(yes["watchFiles"]).toEqual([wow2]);
    expect(newAccounts(yes, [entry(wow1), entry(wow2)])).toEqual([]);
    const no = answerAccount({ watchFile: wow1 }, wow2, false);
    expect(no["accountsDeclined"]).toEqual([wow2]);
    expect(no["watchFiles"]).toBeUndefined();
    expect(newAccounts(no, [entry(wow1), entry(wow2)])).toEqual([]);
    // Answering about the first account again changes nothing.
    expect(answerAccount({ watchFile: wow1 }, wow1, false)).toEqual({ watchFile: wow1 });
  });
});

describe("the engine runs every account", () => {
  it("starts one engine per account, shows each, and Sync now uploads them all", async () => {
    const started: string[] = [], uploaded: string[] = [];
    const factory = (p: { watchFile: string }) => ({
      start: async () => { started.push(p.watchFile); return true; }, stop: async () => {},
      state: () => ({ running: true, lastUpload: null, syncPhase: "synced" }), uploadNow: () => uploaded.push(p.watchFile), refreshStandings: async () => {}
    });
    const manager = createProfileEngine({ ...guild, watchFiles: [wow2] }, {}, factory as never);
    await manager.start();
    expect(started.sort()).toEqual([wow1, wow2]);
    const state = manager.state();
    expect(state.accounts.map((a: { account: string, running: boolean }) => [a.account, a.running])).toEqual([["WOW1", true], ["WOW2", true]]);
    // The connection list still shows one connection.
    expect(state.profiles.map((p: { id: string }) => p.id)).toEqual(["default"]);
    manager.uploadNow();
    expect(uploaded.sort()).toEqual([wow1, wow2]);
    await manager.stop();
  });
});

describe("setup and Repair no longer stop at several accounts", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("start with the newest account; the others are asked about", () => {
    const root = mkdtempSync(join(tmpdir(), "qg-multi-")); dirs.push(root);
    for (const name of ["WOW1", "WOW2"]) {
      const folder = join(root, "World of Warcraft", "_forever_", "WTF", "Account", name, "SavedVariables");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "Guilded.lua"), "GuildedDB = {}\n");
    }
    const accounts = detect.accountsUnder(join(root, "World of Warcraft"));
    expect(detect.pickSavedVariables(accounts.filter((a: { exists: boolean }) => a.exists))).toBeNull();
    const first = detect.pickPrimaryAccount(accounts.filter((a: { exists: boolean }) => a.exists));
    expect(first).toBeTruthy();
    const others = newAccounts({ watchFile: first.path }, accounts);
    expect(others).toHaveLength(1);
    expect(others[0]!.account).not.toBe(first.account);
  });

  it("the main process asks, answers from its own found file, and packages the module", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toContain('registerIpc("account-yes", () => answerOtherAccount(true));');
    expect(main).toContain('registerIpc("account-no", () => answerOtherAccount(false));');
    expect(main).toContain("otherAccount: otherAccount ? { account: otherAccount.account } : null");
    expect(main).toContain("pick: (entries) => pickPrimaryAccount(");
    expect(readFileSync("companion-app/ipc-security.cjs", "utf8")).toContain('"account-yes", "account-no"');
    expect(readFileSync("companion-app/package.json", "utf8")).toContain('"wow-accounts.mjs"');
    const html = readFileSync("companion-app/renderer/index.html", "utf8");
    expect(html).toContain('<article id="accountAsk" class="panel account-ask" hidden>');
  });

  it("is worded in French", () => {
    for (const key of ["Another WoW account on this PC has Guilded data: {0}. Is it yours too?", "Say no if someone else plays on this PC with their own Discord account. You are asked only once.",
      "Yes, sync it too", "No, not mine", "{0} syncs too from now on.", "{0} was added, but the sync did not start. Open Problems to see why.", "{0} will not sync. You will not be asked again."]) expect(fr[key], key).toBeTruthy();
  });
});

describe("per-account status and switches (step 2)", () => {
  const two = { watchFile: wow1, watchFiles: [wow2] };

  it("switches a further account off and on; never the first, never an unknown file", () => {
    const off = switchAccount(two, wow2, false);
    expect(accountFiles(off)).toEqual([wow1]);
    expect(off["accountsDeclined"]).toEqual([wow2]);
    expect(newAccounts(off, [entry(wow1), entry(wow2)])).toEqual([]);
    expect(accountFiles(switchAccount(off, wow2, true))).toEqual([wow1, wow2]);
    expect(switchAccount(two, wow1, false)).toBe(two);
    expect(switchAccount(two, wow3, true)).toBe(two);
    expect(switchAccount(two, "C:/Other/WTF/Account/X/SavedVariables/Guilded.lua", true)).toBe(two);
  });

  it("one line per account with what it is doing; switched-off accounts last", () => {
    const rows = accountRows({ ...two, accountsDeclined: [wow3] }, [
      { file: wow1, running: true, lastUpload: { at: "2026-11-07T17:00:00Z" } },
      { file: wow2, running: true, lastUpload: null }
    ]);
    expect(rows.map((row) => [row.account, row.on, row.first])).toEqual([["WOW1", true, true], ["WOW2", true, false], ["WOW3", false, false]]);
    expect(rows[0]!.text).toEqual(["{0}: synced {1}", "WOW1", { ago: "2026-11-07T17:00:00Z" }]);
    expect(rows[1]!.text[0]).toBe("{0}: waiting for WoW to save Guilded's data. Log in on that account and type /reload once.");
    expect(accountRows({ ...two, wowEnabled: false })).toEqual([]);
    expect(accountRows(two, [{ file: wow2, error: "Missing folder" }])[1]!.text).toEqual(["{0}: {1}", "WOW2", "Missing folder"]);
  });

  it("is wired, validated and worded in French", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toContain('registerIpc("set-account", async (_event, { file, on }) => {');
    expect(main).toContain("accountRows: accountRowsFor(state)");
    const security = require("../companion-app/ipc-security.cjs");
    expect(() => security.validateIpc("set-account", [{ file: wow2, on: true }])).not.toThrow();
    expect(() => security.validateIpc("set-account", [{ file: wow2, on: "yes" }])).toThrow();
    expect(() => security.validateIpc("set-account", [{ file: wow2, on: true, extra: 1 }])).toThrow();
    const html = readFileSync("companion-app/renderer/index.html", "utf8");
    expect(html).toContain('<ul id="accountList" class="account-list" hidden></ul>');
    expect(html).toContain('<ul id="statusAccounts" class="account-lines" hidden></ul>');
    for (const text of [...accountRows({ ...two, accountsDeclined: [wow3] }, [{ file: wow1, lastUpload: { at: "x" } }, { file: wow2, running: true }]).map((row) => String(row.text[0])), "{0}: not syncing yet", "{0}: {1}",
      "The first account syncs while World of Warcraft is on.", "Sync this account"]) expect(fr[text], text).toBeTruthy();
  });
});
