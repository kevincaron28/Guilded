import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { STATUS_ORDER, guildLine, statusCard } from "../companion/status-card.mjs";

// Companion redesign PR 1 (docs/plans/COMPANION_REDESIGN.md): Home leads with one status card, one
// state at a time, most urgent first, in plain words and with at most one button.
const require = createRequire(import.meta.url);
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

const linked = { companionCredential: "c", wowEnabled: true, watchFile: "D:\\WoW\\_forever_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua" };
const zeroSetup = { wowEnabled: true, watchFile: linked.watchFile, device: true, deviceSecret: "set" };
const p = (id: string, data: Record<string, unknown> = {}) => ({ id, data });

describe("the status card", () => {
  it("shows the most urgent state first", () => {
    const everything = [p("settings-not-saved"), p("disk-space-low", { freeMb: 26, neededMb: 600 }), p("sign-in-expired"), p("addon-missing"), p("bot-unreachable"), p("upload-rejected")];
    const order: string[] = [];
    let problems = everything;
    for (;;) {
      const card = statusCard({ problems, config: linked, state: { lastUpload: { at: "2026-11-07T12:00:00.000Z" } } });
      order.push(card.id);
      if (card.id === "synced") break;
      problems = problems.filter((item) => !card.id.startsWith(item.id.replace(/-.*/, "")) && item.id !== card.id);
    }
    expect(order).toEqual(["settings-not-saved", "disk-space-low", "sign-in-expired", "addon-missing", "bot-unreachable", "upload-rejected", "synced"]);
    for (const id of order) expect(STATUS_ORDER).toContain(id);
  });

  it("asks to sign in before anything else a member can fix", () => {
    const card = statusCard({ problems: [p("addon-missing"), p("bot-unreachable")], config: { wowEnabled: true, zeroSetupOff: true } });
    expect(card).toMatchObject({ id: "not-signed-in", tone: "warn", button: { action: "sign-in", label: "Sign in with Discord" } });
    // Saving and disk space still come first: they would break the sign-in too.
    expect(statusCard({ problems: [p("disk-space-low", { freeMb: 10 })], config: {} }).id).toBe("disk-space-low");
  });

  it("says the PC is getting ready, not 'sign in', while the device key is being made", () => {
    const card = statusCard({ problems: [p("addon-missing")], config: { wowEnabled: true } });
    expect(card).toMatchObject({ id: "getting-ready", tone: "busy", title: ["Getting this PC ready…"], button: null });
    // An older bot without zero-setup: Sign in is the way.
    expect(statusCard({ config: { wowEnabled: true }, state: { device: { status: "unsupported" } } }).id).toBe("not-signed-in");
  });

  it("falls through to sign-in when automatic setup keeps failing, instead of waiting forever", () => {
    const card = statusCard({ problems: [p("addon-missing")], config: { wowEnabled: true }, state: { zeroSetupFailures: 1 } });
    expect(card).toMatchObject({ id: "not-signed-in", button: { action: "sign-in" } });
    expect(fr[card.detail![0]]).toBeTruthy();
    // Back to normal once a try works.
    expect(statusCard({ config: { wowEnabled: true }, state: { zeroSetupFailures: 0 } }).id).toBe("getting-ready");
  });

  it("offers a message for the officer, not Sign in, when the guild is not set up", () => {
    const card = statusCard({ config: zeroSetup, state: { device: { status: "no-guild", guild: { name: "Quebec Gold" } } } });
    expect(card).toMatchObject({ id: "guild-not-set-up", button: { action: "copy-officer-message", label: "Copy a message for your officer" } });
  });

  it("keeps sign-in as a secondary link on the healthy device card", () => {
    const card = statusCard({ config: zeroSetup, state: { device: { status: "synced", server: "Quebec Gold", guild: { name: "Quebec Gold" } } } });
    expect(card.id).toBe("synced");
    expect(card.button?.action).not.toBe("sign-in");
    expect(card.link).toMatchObject({ action: "sign-in" });
    expect(fr[card.link!.label]).toBeTruthy();
  });

  it("finds WoW, installs the addon, follows a moved folder, waits for the first save", () => {
    expect(statusCard({ problems: [p("saved-file-missing", { chosen: false })], config: { companionCredential: "c" } })).toMatchObject({ id: "no-wow-folder", button: { action: "find-wow" } });
    // Leaderboards only: no folder of their own to find through this card.
    expect(statusCard({ problems: [p("saved-file-missing", { chosen: false })], config: { companionCredential: "c", personal: true } }).id).toBe("never-saved");
    expect(statusCard({ problems: [p("addon-outdated", { installed: "9.0.0", current: "9.0.1" })], config: linked })).toMatchObject({ id: "addon-outdated", button: { action: "install-addon", label: "Update addon" } });
    expect(statusCard({ problems: [p("addon-wrong-edition")], config: linked }).button?.label).toBe("Update addon");
    expect(statusCard({ problems: [p("saved-file-not-updated", { moved: true })], config: linked })).toMatchObject({ id: "folder-moved", button: { action: "switch-folder" } });
    expect(statusCard({ problems: [p("saved-file-missing", { chosen: true })], config: linked })).toMatchObject({ id: "never-saved", button: null });
  });

  it("says when Guilded's server or the PC is offline, and keeps the data waiting", () => {
    expect(statusCard({ problems: [p("bot-unreachable", { offline: false })], config: linked }).title).toEqual(["Guilded's server is not answering."]);
    expect(statusCard({ problems: [p("bot-unreachable", { offline: true })], config: linked }).title).toEqual(["This PC is offline."]);
  });

  it("all good: paused, syncing, synced, waiting for the first /reload", () => {
    expect(statusCard({ config: { ...linked, syncEnabled: false }, state: { running: false } }).id).toBe("paused");
    expect(statusCard({ config: linked, state: { running: true, syncPhase: "uploading" } })).toMatchObject({ id: "syncing", tone: "busy", button: null });
    expect(statusCard({ config: linked, state: { running: true, lastUpload: { at: "2026-11-07T12:00:00.000Z" } } })).toMatchObject({ id: "synced", tone: "ok", title: ["Synced {0}.", { ago: "2026-11-07T12:00:00.000Z" }], button: { action: "sync-now" } });
    expect(statusCard({ config: linked, state: { running: true } }).id).toBe("waiting-first-save");
  });

  it("is worded in French, every sentence and button", () => {
    const inputs = [
      { problems: [p("settings-not-saved")], config: linked }, { problems: [p("disk-space-low", { freeMb: 1, neededMb: 600 })], config: linked },
      { config: {} }, { config: { zeroSetupOff: true } }, { problems: [p("sign-in-expired")], config: linked }, { problems: [p("saved-file-missing", { chosen: false })], config: { companionCredential: "c" } },
      { problems: [p("addon-missing")], config: linked }, { problems: [p("addon-wrong-edition")], config: linked }, { problems: [p("addon-outdated")], config: linked },
      { problems: [p("saved-file-not-updated", { moved: true })], config: linked }, { problems: [p("saved-file-missing", { chosen: true })], config: linked },
      { problems: [p("bot-unreachable")], config: linked }, { problems: [p("bot-unreachable", { offline: true })], config: linked }, { problems: [p("upload-rejected")], config: linked },
      { config: { ...linked, syncEnabled: false }, state: {} }, { config: linked, state: { syncPhase: "uploading" } }, { config: linked, state: { lastUpload: { at: "2026-11-07T12:00:00.000Z" } } }, { config: linked, state: {} },
      // Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): device key, no sign-in.
      ...["no-guild", "choose", "synced"].flatMap((status) => [{ config: zeroSetup, state: { device: { status, server: "Quebec Gold", guild: { name: "Quebec Gold" } } } }]),
      { config: zeroSetup, state: { device: { status: "no-guild", guild: null } } }
    ];
    const seen = new Set<string>();
    for (const input of inputs) {
      const card = statusCard(input);
      seen.add(card.id);
      for (const key of [card.title[0], card.detail?.[0], card.button?.label, card.link?.label].filter(Boolean) as string[]) expect(fr[key], key).toBeTruthy();
    }
    expect([...seen].sort()).toEqual([...STATUS_ORDER].sort());
  });

  it("the line under it: the guild's name and the last /reload only", () => {
    expect(guildLine({ config: { wowGuildName: "Quebec Gold" }, savedFile: { changedAt: "2026-11-07T21:14:00.000Z" } })).toEqual({ guild: "Quebec Gold", lastReload: "2026-11-07T21:14:00.000Z" });
    expect(guildLine({})).toEqual({ guild: null, lastReload: null });
  });
});
