import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkInstalledAddon } from "../companion/addon-install.mjs";
import { createEngine } from "../companion/engine.mjs";
import { linkSteps, linkSummary } from "../companion/link-everything.mjs";
import { autoStep, linkWizard } from "../companion/link-wizard.mjs";
import { companionProblems } from "../companion/problems.mjs";
import { syncStatus } from "../companion/sync-status.mjs";

// 9.1.3: what real tests of 9.1.2 on two PCs (one French client) found.
const require = createRequire(import.meta.url);
const installer = require("../companion-app/addon-installer.cjs");
const i18n = require("../companion-app/i18n.cjs");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const folders: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function game() {
  const root = mkdtempSync(join(tmpdir(), "guilded-913-"));
  folders.push(root);
  const addOns = join(root, "World of Warcraft", "_forever_", "Interface", "AddOns");
  mkdirSync(addOns, { recursive: true });
  return { addOns, saved: join(root, "World of Warcraft", "_forever_", "WTF", "Account", "A", "SavedVariables", "Guilded.lua") };
}
const putAddon = (addOns: string, name: string, version: string) => {
  mkdirSync(join(addOns, name), { recursive: true });
  writeFileSync(join(addOns, name, `${name}.toc`), `## Interface: 16001\n## Version: ${version}\n`);
  writeFileSync(join(addOns, name, "Old.lua"), `old ${version}`);
};

// A tiny stored-only zip, enough for readZip.
function zip(entries: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), raw = Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, raw); centrals.push(central, name);
    offset += 30 + name.length + raw.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const addonZip = (name: string, version: string) => zip([{ name: `${name}/${name}.toc`, data: `## Version: ${version}\n` }, { name: `${name}/Main.lua`, data: `new ${version}` }]);
const fetchFrom = (files: Record<string, Buffer | string>) => async (url: string) => {
  const body = files[url.split("/").pop() as string];
  return body === undefined
    ? { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }
    : { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
};

describe("addons update by themselves, every installed Guilded addon", () => {
  it("reads the version of GuildedDungeons next to Guilded", async () => {
    const { addOns, saved } = game();
    putAddon(addOns, "Guilded", "9.1.0"); putAddon(addOns, "GuildedDungeons", "9.1.0");
    const addon = await checkInstalledAddon(saved);
    expect(addon).toMatchObject({ status: "ok", version: "9.1.0", extras: [{ name: "GuildedDungeons", version: "9.1.0" }] });
    expect((await checkInstalledAddon(saved)).extras).toHaveLength(1);
  });

  it("offers the update when only GuildedDungeons is older, and nothing when both match", () => {
    const folder = "C:\\WoW\\_forever_\\Interface\\AddOns\\Guilded";
    const decide = (extras: object[], version = "9.1.2") => installer.decideAddonInstall({ addon: { folder, expected: "forever", status: "ok", version, extras }, companionVersion: "9.1.2" });
    expect(decide([{ name: "GuildedDungeons", version: "9.1.0" }])).toEqual({ action: "update", reason: "older", only: "extras", stale: ["GuildedDungeons"] });
    expect(decide([{ name: "GuildedDungeons", version: "9.1.2" }]).action).toBe("none");
    expect(decide([{ name: "GuildedDungeons", version: null }]).action).toBe("update");
    expect(decide([], "9.1.0")).toEqual({ action: "update", reason: "older" });
  });

  it("updates Guilded and GuildedDungeons, each with its own zip and its own backup", async () => {
    const { addOns, saved } = game();
    putAddon(addOns, "Guilded", "9.1.0"); putAddon(addOns, "GuildedDungeons", "9.1.0");
    const guilded = addonZip("Guilded", "9.1.2"), dungeons = addonZip("GuildedDungeons", "9.1.2");
    const fetchImpl = fetchFrom({
      "SHA256SUMS-v9.1.2.txt": `${sha(guilded)}  Guilded-v9.1.2-forever.zip\n${sha(dungeons)}  GuildedDungeons-v9.1.2-forever.zip\n`,
      "Guilded-v9.1.2-forever.zip": guilded, "GuildedDungeons-v9.1.2-forever.zip": dungeons
    });
    const addon = await checkInstalledAddon(saved);
    const result = await installer.installAddon({ addon, companionVersion: "9.1.2", fetchImpl, now: new Date("2026-11-09T12:00:00Z") });
    expect(result.updated.map((entry: { name: string }) => entry.name)).toEqual(["Guilded", "GuildedDungeons"]);
    expect(result.failed).toEqual([]);
    expect(readFileSync(join(addOns, "Guilded", "Guilded.toc"), "utf8")).toContain("9.1.2");
    expect(readFileSync(join(addOns, "GuildedDungeons", "GuildedDungeons.toc"), "utf8")).toContain("9.1.2");
    expect(readFileSync(join(addOns, "..", "Guilded backups", "GuildedDungeons-2026-11-09T12-00-00Z", "Old.lua"), "utf8")).toBe("old 9.1.0");
    expect(readFileSync(join(addOns, "..", "Guilded backups", "Guilded-2026-11-09T12-00-00Z", "Old.lua"), "utf8")).toBe("old 9.1.0");
    // No leftover staging folders inside AddOns (WoW would see a second copy).
    expect(existsSync(join(addOns, "Guilded-installing"))).toBe(false);
  });

  it("updates only GuildedDungeons when Guilded is already current, and leaves Guilded alone", async () => {
    const { addOns, saved } = game();
    putAddon(addOns, "Guilded", "9.1.2"); putAddon(addOns, "GuildedDungeons", "9.1.0");
    const dungeons = addonZip("GuildedDungeons", "9.1.2");
    const fetchImpl = fetchFrom({ "SHA256SUMS-v9.1.2.txt": `${sha(dungeons)}  GuildedDungeons-v9.1.2-forever.zip\n`, "GuildedDungeons-v9.1.2-forever.zip": dungeons });
    const result = await installer.installAddon({ addon: await checkInstalledAddon(saved), companionVersion: "9.1.2", fetchImpl });
    expect(result.updated.map((entry: { name: string }) => entry.name)).toEqual(["GuildedDungeons"]);
    expect(readFileSync(join(addOns, "Guilded", "Old.lua"), "utf8")).toBe("old 9.1.2");
  });

  it("a failing GuildedDungeons download never undoes Guilded's own update", async () => {
    const { addOns, saved } = game();
    putAddon(addOns, "Guilded", "9.1.0"); putAddon(addOns, "GuildedDungeons", "9.1.0");
    const guilded = addonZip("Guilded", "9.1.2");
    const fetchImpl = fetchFrom({ "SHA256SUMS-v9.1.2.txt": `${sha(guilded)}  Guilded-v9.1.2-forever.zip\n`, "Guilded-v9.1.2-forever.zip": guilded });
    const result = await installer.installAddon({ addon: await checkInstalledAddon(saved), companionVersion: "9.1.2", fetchImpl });
    expect(result.updated.map((entry: { name: string }) => entry.name)).toEqual(["Guilded"]);
    expect(result.failed).toHaveLength(1);
    expect(readFileSync(join(addOns, "GuildedDungeons", "Old.lua"), "utf8")).toBe("old 9.1.0");
  });

  it("refuses a GuildedDungeons zip that holds another addon's files", () => {
    expect(() => installer.readZip(addonZip("Guilded", "9.1.2"), "GuildedDungeons")).toThrow(/unexpected path/);
    expect(installer.readZip(addonZip("GuildedDungeons", "9.1.2"), "GuildedDungeons")).toHaveLength(2);
  });
});

describe("an outdated addon is not a problem while the companion updates it by itself", () => {
  const input = (extra: object = {}) => ({
    config: { wowEnabled: true, watchFile: "C:/WoW/Guilded.lua" }, version: "9.1.2", autoUpdate: true,
    savedFile: { changedAt: new Date().toISOString(), addon: { status: "ok", expected: "forever", version: "9.1.0", extras: [{ name: "GuildedDungeons", version: "9.1.0" }] } },
    ...extra
  });
  const ids = (extra?: object) => companionProblems(input(extra)).map((problem) => problem.id);
  it("shows no badge while automatic updates are on, also while WoW runs", () => {
    expect(ids()).not.toContain("addon-outdated");
    expect(ids({ wowRunning: true })).not.toContain("addon-outdated");
  });
  it("shows the problem (with the manual button) when the update failed or automatic updates are off", () => {
    expect(ids({ addonUpdateFailed: true })).toContain("addon-outdated");
    expect(ids({ autoUpdate: false })).toContain("addon-outdated");
  });
  it("also sees a GuildedDungeons that is the only old one", () => {
    const only = input({ autoUpdate: false });
    only.savedFile.addon.version = "9.1.2";
    expect(companionProblems(only).map((problem) => problem.id)).toContain("addon-outdated");
    only.savedFile.addon.extras = [{ name: "GuildedDungeons", version: "9.1.2" }];
    expect(companionProblems(only).map((problem) => problem.id)).not.toContain("addon-outdated");
  });
});

describe("the main process wires the update to WoW's exit", () => {
  const source = readFileSync(new URL("../companion-app/main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("looks for WoW's exit every 20 seconds and retries the update, with a notice after it", () => {
    expect(source).toMatch(/setInterval\(checkWowRunning, 20 \* 1000\)/);
    expect(source).toMatch(/const exited = wowRunning && !running;[\s\S]*if \(exited\) setTimeout\(\(\) => void refreshSavedFile\(\), 3000\)/);
    expect(source).toMatch(/if \(process\.platform === "win32" && await wowIsRunning\(\)\) return;\n[\s\S]*installAddonNow\(\{ refresh: false \}\)/);
    expect(source).toContain('T("Guilded addon updated to {0}"');
    expect(source).toContain("addonUpdateFailed");
  });
});

describe("home and setup match the zero-setup state", () => {
  const device = { wowEnabled: true, watchFile: "C:/WoW/Guilded.lua", device: true, deviceSecret: "set" };
  it("lists Discord as optional and characters as reported, not 'sign in first'", () => {
    const waiting = linkSteps(device, { running: true, device: { status: "synced", server: "Quebec Gold", characters: 0 } }, null);
    expect(waiting.steps.find((step) => step.id === "discord")).toMatchObject({ required: false, state: "optional", label: "Discord sign-in (optional)" });
    expect(waiting.steps.find((step) => step.id === "characters")).toMatchObject({ state: "todo", label: "Characters not reported yet", next: "Log in to WoW and type /reload once: your characters are reported by themselves." });
    expect(JSON.stringify(waiting)).not.toContain("Sign in with Discord first");
    expect(waiting.firstRun).toBe(false);
    const done = linkSteps(device, { running: true, device: { status: "synced", characters: 2 } }, null);
    expect(done.steps.find((step) => step.id === "characters")).toMatchObject({ state: "done", label: "{0} character(s) reported", args: [2] });
    expect(done.complete).toBe(true);
    expect(linkSummary(done)).toContain("Discord –");
  });
  it("keeps the old steps for an unsigned install without a device key", () => {
    expect(linkSteps({ wowEnabled: true }, {}, null).steps[0]).toMatchObject({ state: "todo", label: "Discord not linked yet" });
  });
  it("the wizard has three steps and no numbered Discord sign-in", () => {
    const wizard = linkWizard({ config: device, state: { device: { status: "synced", characters: 0, guild: { name: "Quebec Gold" } } }, savedFile: { addon: { status: "ok" } } });
    expect(wizard.steps.map((step) => step.id)).toEqual(["wow", "server", "characters"]);
    expect(wizard.current).toBe("characters");
    expect(wizard.optional).toMatchObject({ id: "discord", label: "Sign in with Discord (optional)" });
    expect(wizard.charactersHelp?.text).toContain("/reload once");
    const waiting = linkWizard({ config: device, state: {}, savedFile: { addon: { status: "ok" } } });
    expect(waiting.current).toBe("server");
    expect(waiting.join?.text[0]).toContain("Waiting for your character's guild");
    expect(waiting.join?.kind).toBe("info");
  });
  it("never opens the Discord sign-in by itself while zero-setup applies", () => {
    const old = linkWizard({ config: { wowEnabled: true, watchFile: "C:/x.lua" }, state: {}, savedFile: { addon: { status: "ok" } } });
    expect(old.current).toBe("discord");
    expect(autoStep(old, {})).toBe("sign-in");
    expect(autoStep(old, { zeroSetup: true })).toBeNull();
  });
});

describe("the Sync page after an unsigned sync", () => {
  it("shows Sent and Received instead of Unknown (one revision for saved, sent and received)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guilded-913-engine-"));
    folders.push(dir);
    const file = join(dir, "Guilded.lua");
    writeFileSync(file, 'GuildedDB = { version = 3, guildKey = "Quebec Gold-CAMWOW", character = { name = "Blunt Cruising", class = "ROGUE", level = 12 }, epgp = {} }');
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "synced", server: { discordId: "1", name: "Quebec Gold" }, guild: { name: "Quebec Gold", realm: "CAMWOW" }, characters: 1 })));
    const engine = createEngine({ watchFile: file, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: "k".repeat(43) });
    try {
      await engine.start();
      await vi.waitFor(() => expect(engine.state().device?.status).toBe("synced"));
      const status = syncStatus({ watchFile: file }, engine.state(), engine.state().syncEvidence);
      expect(status.uploaded.status).toBe("confirmed");
      expect(status.uploaded.at).toBeTruthy();
      expect(status.accepted.status).toBe("confirmed");
    } finally { await engine.stop(); }
  });
});

describe("English text on the French client", () => {
  const fr = (text: string) => i18n.message("fr", text);
  it("says the missing first save as a calm waiting note, in French", async () => {
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: "k".repeat(43) }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try { await engine.start(); } finally { await engine.stop(); }
    const note = logs.find((entry) => /first \/reload/.test(entry.message));
    expect(note).toMatchObject({ level: "info", message: "Waiting for your first /reload in WoW: the saved-data file does not exist yet." });
    expect(logs.some((entry) => entry.level === "warn" && /Not started/.test(entry.message))).toBe(false);
    expect(fr(note!.message)).toBe("En attente de votre premier /reload dans WoW : le fichier de données n’existe pas encore.");
  });
  it("translates the reason inside 'Not started'", () => {
    expect(fr("Not started: The saved-data file (Guilded.lua) is not set.")).toBe("Non démarré : Le fichier de données Guilded.lua n’est pas défini.");
  });
  it("translates the start-up, device key and addon install lines", () => {
    expect(fr("Start-up update step: nothing to install.")).toBe("Étape de mise à jour au démarrage : rien à installer.");
    expect(fr("This companion got its own device key: it syncs without Discord sign-in.")).toMatch(/clé d’appareil/);
    expect(fr("Guilded addon 9.1.2 installed in C:\\WoW\\AddOns\\Guilded.")).toBe("Addon Guilded 9.1.2 installé dans C:\\WoW\\AddOns\\Guilded.");
    expect(fr("Guilded addon 9.1.2 installed in C:\\a\\Guilded. The previous Guilded folder was moved to C:\\b.")).toBe("Addon Guilded 9.1.2 installé dans C:\\a\\Guilded. L’ancien dossier Guilded a été déplacé vers C:\\b.");
    expect(fr("Also installed GuildedDungeons 9.1.2 in C:\\c.")).toBe("GuildedDungeons 9.1.2 installé aussi dans C:\\c.");
    expect(fr("Guilded addons updated to 9.1.2 (Guilded, GuildedDungeons). Type /reload in WoW, or start it, to use them.")).toMatch(/^Addons Guilded mis à jour vers 9\.1\.2/);
  });
  it("has French for every new home and setup text", () => {
    for (const key of ["Discord sign-in (optional)", "Sign in with Discord (optional)", "Characters not reported yet", "{0} character(s) reported",
      "Log in to WoW and type /reload once: your characters are reported by themselves.",
      "Optional: sign in with Discord to confirm your characters as yours. Syncing works without it.",
      "Waiting for your character's guild: log in to WoW with the Guilded addon enabled, then type /reload once."]) {
      expect(i18n.translate("fr", key, 2)).not.toBe(key.replace("{0}", "2"));
    }
  });
});
