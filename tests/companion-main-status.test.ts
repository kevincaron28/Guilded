import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mainStatus, shortGamePath } from "../companion/main-status.mjs";

const fr = JSON.parse(readFileSync("companion-app/locales/fr.json", "utf8")) as Record<string, string>;
const FILE = "D:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\ABC\\SavedVariables\\Guilded.lua";
const signedIn = { companionCredential: "c", watchFile: FILE };
const okAddon = { addon: { status: "ok", expected: "forever", version: "9.1.6" }, changedAt: "2026-11-13T10:00:00.000Z" };
const byId = (status: ReturnType<typeof mainStatus>, id: string) => status.lines.find((entry) => entry.id === id)!;

describe("shortGamePath", () => {
  it("shows the game folder, not the saved file", () => {
    expect(shortGamePath(FILE)).toBe("D:\\…\\World of Warcraft\\_forever_");
    expect(shortGamePath("")).toBeNull();
    expect(shortGamePath(undefined as never)).toBeNull();
  });
});

describe("mainStatus: four lines and one needs-you line", () => {
  it("is all green when everything works", () => {
    const status = mainStatus({ config: signedIn, savedFile: okAddon, state: { running: true, lastUpload: { at: "2026-11-13T10:00:00.000Z" } }, me: { account: { displayName: "Marie" } } });
    expect(status.lines.map((entry) => entry.id)).toEqual(["wow", "addon", "sync", "account"]);
    expect(status.lines.map((entry) => entry.tone)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(byId(status, "wow").detail).toEqual(["{0}", "D:\\…\\World of Warcraft\\_forever_"]);
    expect(byId(status, "addon").detail).toEqual(["Version {0}", "9.1.6"]);
    expect(byId(status, "sync").text).toEqual([{ ago: "2026-11-13T10:00:00.000Z" }]);
    expect(byId(status, "account").text).toEqual(["{0} (Discord)", "Marie"]);
    expect(status.needsYou).toBeNull();
    expect(status.openWindow).toBe(false);
    expect(status.tone).toBe("ok");
    expect(status.syncNow).toEqual({ enabled: true, busy: false });
  });

  it("says WoW is not found with a Choose folder button, and opens the window", () => {
    const status = mainStatus({ config: { companionCredential: "c" }, problems: [{ id: "saved-file-missing", data: { chosen: false } }] });
    expect(byId(status, "wow")).toMatchObject({ tone: "bad", text: ["WoW not found"], button: { action: "pick-wow-folder" } });
    expect(status.openWindow).toBe(true);
    expect(status.syncNow.enabled).toBe(false);
  });

  it("words the addon states: missing, wrong, outdated, waiting for WoW to close", () => {
    expect(byId(mainStatus({ config: signedIn, problems: [{ id: "addon-missing" }] }), "addon")).toMatchObject({ tone: "bad", text: ["Not installed"], button: { action: "install-addon" } });
    expect(byId(mainStatus({ config: signedIn, problems: [{ id: "addon-wrong-edition" }] }), "addon").tone).toBe("bad");
    expect(byId(mainStatus({ config: signedIn, problems: [{ id: "addon-outdated" }] }), "addon").tone).toBe("warn");
    expect(byId(mainStatus({ config: signedIn, savedFile: okAddon, addonAction: { action: "update" }, wowRunning: true }), "addon")).toMatchObject({ tone: "warn", text: ["Update ready, installs when WoW closes"] });
    expect(byId(mainStatus({ config: signedIn }), "addon")).toMatchObject({ tone: "busy", text: ["Checking…"] });
  });

  it("words the sync states: waiting for a save, server down, offline, rejected, sending", () => {
    const sync = (problems: { id: string; data?: object }[], state = {}) => byId(mainStatus({ config: signedIn, savedFile: okAddon, problems, state }), "sync");
    expect(sync([{ id: "saved-file-not-updated", data: { moved: false } }])).toMatchObject({ tone: "warn", text: ["Waiting: the game has not saved yet"] });
    expect(sync([{ id: "bot-unreachable", data: { offline: false } }])).toMatchObject({ tone: "warn", button: { action: "retry" } });
    expect(sync([{ id: "bot-unreachable", data: { offline: true } }]).text).toEqual(["This PC is offline"]);
    expect(sync([{ id: "upload-rejected" }]).tone).toBe("bad");
    expect(sync([], { syncPhase: "uploading" })).toMatchObject({ tone: "busy" });
    expect(sync([]).text).toEqual(["Ready. Waiting for your first /reload in WoW."]);
  });

  it("words who the PC syncs as: Discord name, zero-setup device, setting up, signed out", () => {
    const account = (config: object, extra: object = {}) => byId(mainStatus({ savedFile: okAddon, ...extra, config: { watchFile: FILE, ...config } }), "account");
    expect(account({ companionCredential: "c" }).text).toEqual(["Signed in with Discord"]);
    expect(account({ device: true, deviceSecret: "s" }, { state: { device: { status: "synced", server: "Québec Gold" } } })).toMatchObject({ tone: "ok", text: ["This PC, not signed in"], detail: ["Syncing to {0}.", "Québec Gold"], button: { action: "sign-in" } });
    expect(account({})).toMatchObject({ tone: "busy", text: ["Setting this PC up…"] });
    expect(account({}, { state: { zeroSetupFailures: 2 } })).toMatchObject({ tone: "warn", button: { action: "sign-in" } });
    expect(account({ companionCredential: "c" }, { problems: [{ id: "sign-in-expired" }] })).toMatchObject({ tone: "bad", text: ["Signed out"] });
  });

  it("allows Sync now for a signed-in or device PC with a game file, and not while sending", () => {
    expect(mainStatus({ config: { device: true, deviceSecret: "s", watchFile: FILE } }).syncNow.enabled).toBe(true);
    expect(mainStatus({ config: { watchFile: FILE } }).syncNow.enabled).toBe(false);
    expect(mainStatus({ config: signedIn, state: { syncPhase: "uploading" } }).syncNow).toEqual({ enabled: false, busy: true });
  });

  it("shows one needs-you item, most urgent first, with its buttons", () => {
    const pick = (input: object) => mainStatus({ config: signedIn, savedFile: okAddon, ...input }).needsYou;
    const both = pick({ problems: [{ id: "disk-space-low", data: { freeMb: 100 } }, { id: "settings-not-saved" }], otherAccount: { account: "Other" } });
    expect(both?.id).toBe("settings-not-saved");
    expect(pick({ problems: [{ id: "disk-space-low", data: { freeMb: 100 } }], otherAccount: { account: "Other" } })?.id).toBe("disk-space-low");
    expect(pick({ otherAccount: { account: "Other" } })).toMatchObject({ id: "new-wow-account", buttons: [{ action: "account-yes" }, { action: "account-no" }] });
    expect(pick({ state: { device: { status: "choose", guild: { name: "QG" } } } })?.id).toBe("choose-server");
    expect(pick({ state: { device: { status: "no-guild", guild: { name: "QG" } } } })?.id).toBe("guild-not-set-up");
    expect(pick({ savedFile: { ...okAddon, candidate: { path: "x" } } })?.id).toBe("folder-moved");
    expect(pick({ problems: [{ id: "companion-outdated", data: { latest: "9.2.0", store: true } }] })).toMatchObject({ id: "companion-update", buttons: [{ action: "open-store" }] });
    expect(pick({})).toBeNull();
  });

  it("opens the window by itself only when something needs the member", () => {
    expect(mainStatus({ config: signedIn, savedFile: okAddon, otherAccount: { account: "Other" } }).openWindow).toBe(true);
    expect(mainStatus({ config: signedIn, savedFile: okAddon, problems: [{ id: "addon-outdated" }] }).openWindow).toBe(false);
  });

  it("has a French entry for every text and button it can emit", () => {
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) { if (typeof value[0] === "string") keys.add(value[0]); }
      else if (value && typeof value === "object") for (const child of Object.values(value)) walk(child);
    };
    const problemIds = ["settings-not-saved", "disk-space-low", "sign-in-expired", "bot-unreachable", "addon-missing", "addon-wrong-edition", "addon-outdated", "saved-file-missing", "saved-file-not-updated", "upload-rejected", "wow-running-update", "companion-outdated"];
    const data = { freeMb: 1, offline: true, chosen: false, latest: "9.2.0", store: true };
    const configs = [{}, signedIn, { device: true, deviceSecret: "s", watchFile: FILE }, { wowEnabled: false }, { companionCredential: "c", syncEnabled: false, watchFile: FILE }];
    const states = [{}, { syncPhase: "uploading" }, { running: true, lastUpload: { at: "2026-11-13T10:00:00.000Z" } }, { device: { status: "choose", guild: { name: "G" } } }, { device: { status: "no-guild", guild: { name: "G" } } }, { device: { status: "synced", server: "S" } }, { zeroSetupFailures: 1 }];
    const extras = [{}, { otherAccount: { account: "A" } }, { addonAction: { action: "update" }, wowRunning: true, savedFile: { ...okAddon, candidate: { path: "p" } } }, { savedFile: okAddon, me: { account: { username: "u" } } }];
    const problemSets = [[], ...problemIds.map((id) => [{ id, data }]), problemIds.map((id) => ({ id, data }))];
    problemSets.push([{ id: "bot-unreachable", data: { offline: false } }]); // the server answered nothing, not "this PC is offline"
    for (const config of configs) for (const state of states) for (const problems of problemSets) for (const extra of extras) {
      const status = mainStatus({ config, state, problems, ...extra });
      for (const entry of status.lines) { walk(entry.text); walk(entry.detail); if (entry.button) keys.add((entry.button as { label: string }).label); }
      if (status.needsYou) { walk(status.needsYou.text); walk(status.needsYou.detail); for (const button of status.needsYou.buttons as { label: string }[]) keys.add(button.label); }
    }
    expect([...keys].filter((key) => typeof fr[key] !== "string")).toEqual([]);
    const slots = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
    for (const key of keys) expect(slots(fr[key] ?? ""), key).toEqual(slots(key));
  });
});
