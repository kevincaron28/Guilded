import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { validateIpc, assertSender, rendererConfig } = require("../companion-app/ipc-security.cjs");

describe("desktop IPC boundary", () => {
  it("rejects hidden credential/profile/path overrides and malformed config fields", () => {
    for (const value of [null, [], { companionCredential: "stolen" }, { profiles: {} }, { poeJournalFile: "elsewhere" }, { wowEnabled: "true" }, { standingsIntervalMinutes: Infinity }, { watchFile: "x\0y" }]) {
      expect(() => validateIpc("sign-in-start", [value])).toThrow();
    }
    expect(() => validateIpc("sign-in-start", [{ watchFile: "C:/game/Guilded.lua", wowEnabled: true, standingsIntervalMinutes: "2" }])).not.toThrow();
    expect(() => validateIpc("upload-now", ["unexpected"])).toThrow();
    expect(() => validateIpc("set-autostart", ["false"])).toThrow();
    expect(() => validateIpc("unknown-channel", [])).toThrow();
    for (const gone of ["open-old-window", "hub-view", "hub-edit", "manage-edit", "save-config", "delete-my-data"]) expect(() => validateIpc(gone, []), gone).toThrow();
  });
  it("accepts the account switch and the forced reinstall, nothing else", () => {
    expect(() => validateIpc("set-account", [{ file: "C:/wow/Guilded.lua", on: false }])).not.toThrow();
    expect(() => validateIpc("set-account", [{ file: "C:/wow/Guilded.lua", on: "no" }])).toThrow();
    expect(() => validateIpc("set-account", [{ file: "C:/wow/Guilded.lua", on: true, extra: 1 }])).toThrow();
    expect(() => validateIpc("reinstall-addon", [])).not.toThrow();
    expect(() => validateIpc("reinstall-addon", ["x"])).toThrow();
  });
  it("accepts only the main local renderer, including its startup tab query", () => {
    const url = new URL("../companion-app/renderer/main.html", import.meta.url);
    url.search = "?tab=wow";
    const frame = { url: url.href }, contents = { mainFrame: frame }, win = { webContents: contents };
    const directory = fileURLToPath(new URL("../companion-app/", import.meta.url));
    expect(() => assertSender({ sender: contents, senderFrame: frame }, win, directory)).not.toThrow();
    expect(() => assertSender({ sender: {}, senderFrame: frame }, win, directory)).toThrow();
    expect(() => assertSender({ sender: contents, senderFrame: { ...frame } }, win, directory)).toThrow();
    frame.url = "https://guilded.kcaron.top/";
    expect(() => assertSender({ sender: contents, senderFrame: frame }, win, directory)).toThrow();
    expect(() => assertSender(null, null, directory)).toThrow();
  });
  it("keeps secrets and inactive profiles out of renderer state", () => {
    const source = { companionCredential: "private", uploadToken: "old-private", pairingCode: "private-code", profiles: { other: { companionCredential: "other-private" } }, realm: "Test" };
    expect(rendererConfig(source)).toEqual({ companionCredential: "connected", pairingCode: "", realm: "Test" });
    expect(source.companionCredential).toBe("private");
    // Zero-setup companion: the device key never reaches the page, only that there is one.
    expect(rendererConfig({ deviceSecret: "k".repeat(43), device: true })).toEqual({ deviceSecret: "set", device: true, companionCredential: "", pairingCode: "" });
  });
  it("accepts WoW Forever GRM imports only", () => {
    expect(() => validateIpc("convert-grm", [{ guild: "Test", realm: "Realm", edition: "forever", includePrivate: false }])).not.toThrow();
    for (const edition of ["classic-era", "classic-tbc", "classic-mists", "retail"]) {
      expect(() => validateIpc("convert-grm", [{ guild: "Test", realm: "Realm", edition, includePrivate: false }])).toThrow();
    }
  });
});
