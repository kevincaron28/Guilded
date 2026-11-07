import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { validateIpc, assertSender, rendererConfig } = require("../companion-app/ipc-security.cjs");

describe("desktop IPC boundary", () => {
  it("rejects hidden credential/profile/path overrides and malformed config fields", () => {
    for (const value of [null, [], { companionCredential: "stolen" }, { profiles: {} }, { poeJournalFile: "elsewhere" }, { wowEnabled: "true" }, { standingsIntervalMinutes: Infinity }, { watchFile: "x\0y" }]) {
      expect(() => validateIpc("save-config", [value])).toThrow();
    }
    expect(() => validateIpc("save-config", [{ watchFile: "C:/game/Guilded.lua", wowEnabled: true, standingsIntervalMinutes: "2" }])).not.toThrow();
    expect(() => validateIpc("upload-now", ["unexpected"])).toThrow();
    expect(() => validateIpc("set-autostart", ["false"])).toThrow();
    expect(() => validateIpc("unknown-channel", [])).toThrow();
  });
  it("accepts only the main local renderer, including its startup tab query", () => {
    const url = new URL("../companion-app/renderer/index.html", import.meta.url);
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
  });
  it("accepts WoW Forever GRM imports only and rejects oversized edits", () => {
    expect(() => validateIpc("convert-grm", [{ guild: "Test", realm: "Realm", edition: "forever", includePrivate: false }])).not.toThrow();
    for (const edition of ["classic-era", "classic-tbc", "classic-mists", "retail"]) {
      expect(() => validateIpc("convert-grm", [{ guild: "Test", realm: "Realm", edition, includePrivate: false }])).toThrow();
    }
    expect(() => validateIpc("manage-edit", [{ action: "prices.set", text: "x".repeat(220_001) }])).toThrow();
  });
});

describe("hub IPC envelopes", () => {
  it("accepts only a language for hub-view and only known fields for hub-edit", () => {
    expect(() => validateIpc("hub-view", ["fr"])).not.toThrow();
    expect(() => validateIpc("hub-view", ["de"])).toThrow();
    expect(() => validateIpc("hub-edit", [{ action: "server.reminders", on: true }])).not.toThrow();
    expect(() => validateIpc("hub-edit", [{ action: "server.language", value: "fr" }])).not.toThrow();
    expect(() => validateIpc("hub-edit", [{ action: "server.reminders", on: "yes" }])).toThrow();
    expect(() => validateIpc("hub-edit", [{ action: "server.x", guildId: "other" }])).toThrow();
  });
});
