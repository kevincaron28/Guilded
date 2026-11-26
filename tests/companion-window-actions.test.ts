// What the companion window's buttons do: Choose folder saves, accounts can be switched, Repair and
// All problems explain themselves, and a leaderboards-only sign-in does not end a guild's sync.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainStatus, problemHelp } from "../companion/main-status.mjs";
import { companionProblems } from "../companion/problems.mjs";
import { isOtherEditionFolder } from "../companion/wow-folder.mjs";

const require = createRequire(import.meta.url);
const fr: Record<string, string> = require("../companion-app/locales/fr.json");
const mainUrl = new URL("../companion-app/main.cjs", import.meta.url);

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function temp() {
  const folder = mkdtempSync(path.join(tmpdir(), "guilded-window-"));
  folders.push(folder);
  return folder;
}

/** main.cjs with Electron, child processes and the drive search replaced; the picked folder is read for real. */
function loadMain(config: Record<string, unknown>, engineState: Record<string, unknown> = {}) {
  const userData = temp();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const frame = { url: new URL("../companion-app/renderer/main.html", import.meta.url).href };
  const contents = { mainFrame: frame, send: vi.fn() };
  const dialog = { showOpenDialog: vi.fn() };
  const engine = { configure: vi.fn(async () => true), uploadNow: vi.fn(), state: () => engineState };
  const storeConfig = { write: vi.fn<(file: string, config: Record<string, unknown>) => Promise<void>>(async () => {}), status: () => ({}) };
  const engineModules = {
    isOtherEditionFolder,
    revokeSavedConnections: vi.fn(async () => {}),
    deviceSync: { hasDeviceKey: (c: Record<string, unknown>) => Boolean(c["deviceSecret"]), claimDevice: vi.fn(async () => ({ ok: true })) },
    HOSTED_UPLOAD_URL: "https://example.test/api/v1/addon-imports"
  };
  const appRequire = createRequire(mainUrl);
  const hooks: { setup?: (...args: unknown[]) => void; applyPairing?: (next: object, result: object) => Promise<{ ok: boolean; message: string }>; config?: () => Record<string, unknown> } = {};
  runInNewContext(readFileSync(mainUrl, "utf8") + `
hooks.setup = (c, w, e, m, s) => { config = c; win = { webContents: w }; engine = e; engineModules = m; storeConfig = s; onState = () => {}; refreshSavedFile = async () => {}; zeroSetupStep = async () => false; };
hooks.applyPairing = applyPairing;
hooks.config = () => config;`, {
    hooks,
    require: (id: string) => id === "electron" ? {
      app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: vi.fn(), getPath: () => userData, getLocale: () => "en-US" },
      ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
      dialog
    } : id === "node:child_process" ? { spawn: vi.fn(), execFile: vi.fn() }
      : id === "./detect-wow.cjs" ? { ...appRequire(id), searchWow: () => ({ entries: [], installs: [] }), pickerStart: () => undefined }
        : appRequire(id),
    process: { argv: [], platform: "win32", env: {} }, __dirname: fileURLToPath(new URL("../companion-app/", import.meta.url))
  });
  hooks.setup!(config, contents, engine, engineModules, storeConfig);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: contents, senderFrame: frame }, ...args) as Promise<{ canceled?: boolean; ok?: boolean; message?: string; accounts: { path: string; account: string; chosen: boolean }[] }>;
  return { invoke, dialog, engine, engineModules, storeConfig, applyPairing: hooks.applyPairing!, config: hooks.config! };
}

/** A World of Warcraft folder with these accounts; true means the account has Guilded's saved file. */
function install(accounts: Record<string, boolean>) {
  const root = path.join(temp(), "World of Warcraft");
  const files: Record<string, string> = {};
  for (const [account, saved] of Object.entries(accounts)) {
    const dir = path.join(root, "_forever_", "WTF", "Account", account, "SavedVariables");
    mkdirSync(dir, { recursive: true });
    files[account] = path.join(dir, "Guilded.lua");
    if (saved) writeFileSync(files[account]!, "GuildedDB = {}\n");
  }
  mkdirSync(root, { recursive: true });
  return { root, files };
}
const signedIn = { companionCredential: "c".repeat(43), guildDiscordId: "111", uploadUrl: "https://example.test/api/v1/addon-imports" };

describe("Choose folder", () => {
  it("saves the account's file, starts syncing it and says so", async () => {
    const wow = install({ ONE: true });
    const main = loadMain({ ...signedIn, wowEnabled: false, accountsDeclined: [wow.files["ONE"]] });
    main.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [wow.root] });
    const answer = await main.invoke("pick-wow-folder");
    expect(answer).toMatchObject({ canceled: false, ok: true, message: "WoW folder saved. Watching the account ONE.", accounts: [] });
    expect(main.storeConfig.write.mock.calls.at(-1)![1]).toMatchObject({ watchFile: wow.files["ONE"], wowEnabled: true, accountsDeclined: [] });
    expect(main.engine.configure).toHaveBeenCalledWith(expect.objectContaining({ watchFile: wow.files["ONE"] }));
    expect(main.engine.uploadNow).toHaveBeenCalled();
  });

  it("lists several accounts and takes the member's choice, only from the picked folder", async () => {
    const wow = install({ ONE: true, TWO: true });
    const main = loadMain({ ...signedIn, watchFile: wow.files["ONE"] });
    main.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [wow.root] });
    const answer = await main.invoke("pick-wow-folder");
    expect(answer.accounts.map((entry) => [entry.account, entry.chosen]).sort()).toEqual([["ONE", true], ["TWO", false]]);
    const other = await main.invoke("use-wow-account", wow.files["TWO"]);
    expect(other.ok).toBe(true);
    expect(main.config()["watchFile"]).toBe(wow.files["TWO"]);
    const refused = await main.invoke("use-wow-account", "C:/elsewhere/Guilded.lua");
    expect(refused).toMatchObject({ ok: false, message: "Press Choose folder again." });
    expect(main.config()["watchFile"]).toBe(wow.files["TWO"]);
  });

  it("changes nothing when cancelled or when the folder holds no account", async () => {
    const main = loadMain({ ...signedIn, watchFile: "C:/old/Guilded.lua" });
    main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] }).mockResolvedValueOnce({ canceled: false, filePaths: [temp()] });
    expect(await main.invoke("pick-wow-folder")).toMatchObject({ canceled: true });
    expect(await main.invoke("pick-wow-folder")).toMatchObject({ ok: false });
    expect(main.storeConfig.write).not.toHaveBeenCalled();
    expect(main.config()["watchFile"]).toBe("C:/old/Guilded.lua");
  });
});

describe("a leaderboards-only sign-in", () => {
  const personal = { ok: true, personal: true, companionCredential: "p".repeat(43), guildDiscordId: "", message: "Leaderboards account connected." };
  const device = { device: true, deviceSecret: "dk", watchFile: "x" };

  it.each([
    ["a synced device key", device, { device: { status: "synced" } }],
    ["a device key that synced before this start", { ...device, deviceSynced: true }, {}],
    ["a guild sign-in", signedIn, {}]
  ])("does not replace %s", async (_name, config, state) => {
    const main = loadMain({ ...config }, state);
    const answer = await main.applyPairing({}, personal);
    expect(answer.ok).toBe(false);
    expect(answer.message).toContain("Nothing changed");
    expect(main.config()).toEqual(config);
    expect(main.storeConfig.write).not.toHaveBeenCalled();
    expect(main.engineModules.revokeSavedConnections).toHaveBeenCalledWith(expect.objectContaining({ companionCredential: personal.companionCredential }));
  });

  it("applies when the member chose it on the page, or when no guild was syncing", async () => {
    const chosen = loadMain({ ...device }, { device: { status: "synced" } });
    expect((await chosen.applyPairing({}, { ...personal, personalChosen: true })).ok).toBe(true);
    expect(chosen.config()).toMatchObject({ personal: true, device: false });
    const waiting = loadMain({ ...device }, { device: { status: "no-guild" } });
    expect((await waiting.applyPairing({}, personal)).ok).toBe(true);
    expect(waiting.config()).toMatchObject({ personal: true, companionCredential: personal.companionCredential });
  });

  it("is amber on the main window, with the way back", () => {
    const status = mainStatus({ config: { companionCredential: "p".repeat(43), personal: true, watchFile: "x" } });
    const account = status.lines.find((entry) => entry.id === "account")!;
    expect(account.tone).toBe("warn");
    expect(account.button).toEqual({ action: "sign-in-switch", label: "Switch account" });
    for (const key of [account.text![0], account.detail![0], (account.button as unknown as { label: string }).label]) expect(fr[key as string], String(key)).toBeTypeOf("string");
  });
});

describe("All problems", () => {
  const ids = ["settings-not-saved", "disk-space-low", "sign-in-expired", "bot-unreachable", "addon-missing", "addon-wrong-edition", "addon-outdated", "saved-file-missing", "saved-file-not-updated", "saved-file-unreadable", "upload-rejected", "parked-record-damaged", "wow-running-update", "companion-outdated"];
  const variants = [{}, { offline: true, chosen: false, moved: true, tooBig: true, stuck: true, unfinished: true, store: true, applyError: true, freeMb: 5 }, { status: 403 }, { status: 413, reason: "Too big" }, { status: 400 }];

  it("gives every problem a title and a fix, in both languages", () => {
    const source = readFileSync(new URL("../companion/problems.mjs", import.meta.url), "utf8");
    expect([...new Set([...source.matchAll(/add\("([a-z-]+)"/g)].map((match) => match[1]!))].sort()).toEqual([...ids].sort());
    for (const id of ids) for (const data of variants) {
      const help = problemHelp({ id, data });
      expect(help.fix, id).not.toBeNull();
      for (const entry of [help.title, help.fix!]) expect(fr[entry[0] as string], `${id}: ${entry[0]}`).toBeTypeOf("string");
    }
  });

  it("shows why the server refused", () => {
    expect(problemHelp({ id: "upload-rejected", data: { status: 400, reason: "Unknown character" } }).reason).toBe("Unknown character");
    const found = companionProblems({ config: signedIn, state: { syncPhase: "apply-error", lastUpload: { at: "2026-11-26T10:00:00Z", message: "Uploaded, but applying it failed." } } });
    expect(found.find((problem) => problem.id === "upload-rejected")?.data?.["reason"]).toBe("Uploaded, but applying it failed.");
  });
});

describe("the window shows what it is given", () => {
  const script = readFileSync("companion-app/renderer/main.js", "utf8");
  const page = readFileSync("companion-app/renderer/main.html", "utf8");

  it("has every element the script fills", () => {
    for (const [, id] of script.matchAll(/\$\('([A-Za-z]+)'\)/g)) expect(page, id).toContain(`id="${id}"`);
  });

  it("switches WoW accounts, lists Repair results and explains problems", () => {
    expect(script).toContain("api.setAccount(row.file, box.checked)");
    expect(script).toContain("$('accountsSection').hidden = !rows.length");
    expect(script).toContain("answer.results.map(repairItem)");
    expect(script).toContain("window.guildedProblemHelp(problem)");
    expect(readFileSync("companion-app/renderer/ui-entry.js", "utf8")).toContain("window.guildedProblemHelp = problemHelp");
  });
});
