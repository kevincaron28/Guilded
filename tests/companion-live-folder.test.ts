import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STALE_AFTER_MS, checkSavedFile, savedFileParts } from "../companion/live-folder.mjs";

// Launch day (4 November 2026): a companion still watching the beta client's Guilded.lua must
// be offered the live client's file instead of silently watching a file that never changes.
const NOW = Date.parse("2026-11-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const folders: string[] = [];
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function install() {
  const dir = mkdtempSync(join(tmpdir(), "guilded-live-")); folders.push(dir);
  const root = join(dir, "World of Warcraft");
  // A saved file `daysAgo` old in <root>/<game>/WTF/Account/<account>/SavedVariables; game "" is the install folder itself.
  const saved = (game: string, account: string, daysAgo: number | null, file = "Guilded.lua") => {
    const folder = join(root, game, "WTF", "Account", account, "SavedVariables");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, file);
    if (daysAgo !== null) {
      writeFileSync(path, "GuildedDB = {}");
      const when = new Date(NOW - daysAgo * DAY);
      utimesSync(path, when, when);
    }
    return path;
  };
  return { root, saved };
}

describe("launch-day saved folder check", () => {
  it("reads the game folder, account and file from a SavedVariables path", () => {
    expect(savedFileParts("C:\\Games\\World of Warcraft\\_classic_beta_\\WTF\\Account\\KEV#1\\SavedVariables\\Guilded.lua"))
      .toMatchObject({ rootName: "World of Warcraft", flavor: "_classic_beta_", account: "KEV#1", file: "Guilded.lua" });
    expect(savedFileParts("D:/WoW/WTF/Account/KEV/SavedVariables/GuildedDungeons.lua"))
      .toMatchObject({ rootName: "WoW", flavor: "", account: "KEV", file: "GuildedDungeons.lua" });
    expect(savedFileParts("D:/WoW/WTF/Account/KEV/Realm/Char/SavedVariables/Guilded.lua")).toBeNull();
    expect(savedFileParts("D:/Downloads/Guilded.lua")).toBeNull();
    expect(savedFileParts("")).toBeNull();
  });

  it("offers the live folder's file when the watched one is in the beta folder", async () => {
    const { saved } = install();
    const beta = saved("_classic_beta_", "KEV", 15);
    const live = saved("_classic_", "KEV", 0.1);
    const result = await checkSavedFile(beta, { now: NOW });
    expect(result.stale).toBe(true);
    expect(result.changedAt).toBe(new Date(NOW - 15 * DAY).toISOString());
    expect(result.candidate).toMatchObject({ path: live, reason: "beta", gameFolder: "_classic_", account: "KEV", sameAccount: true });
  });

  it("offers a copied WTF folder (same dates) straight away, but never an older file", async () => {
    const { saved } = install();
    const beta = saved("_classic_beta_", "KEV", 1);
    const copied = saved("_forever_", "KEV", 1);
    expect((await checkSavedFile(beta, { now: NOW })).candidate).toMatchObject({ path: copied, reason: "beta" });
    const older = install();
    const watched = older.saved("_classic_beta_", "KEV", 1);
    older.saved("_classic_era_", "KEV", 40);
    expect((await checkSavedFile(watched, { now: NOW })).candidate).toBeNull();
  });

  it("offers the beta's replacement even when the beta folder is gone, including the install folder itself", async () => {
    const { root, saved } = install();
    const live = saved("", "KEV", 0);
    const result = await checkSavedFile(join(root, "_classic_beta_", "WTF", "Account", "KEV", "SavedVariables", "Guilded.lua"), { now: NOW });
    expect(result.changedAt).toBeNull();
    expect(result.candidate).toMatchObject({ path: live, reason: "beta", gameFolder: "World of Warcraft" });
  });

  it("offers a newer copy when a non-beta file has not changed for 3 days", async () => {
    const { saved } = install();
    const watched = saved("_classic_", "KEV", 4);
    const newer = saved("_forever_", "KEV", 0.5);
    const result = await checkSavedFile(watched, { now: NOW });
    expect(result.stale).toBe(true);
    expect(result.candidate).toMatchObject({ path: newer, reason: "stale", gameFolder: "_forever_" });
    // Changed within 3 days: nothing to offer, whatever the other folders hold.
    expect(await checkSavedFile(watched, { now: NOW - 2 * DAY })).toMatchObject({ stale: false, candidate: null });
    expect(STALE_AFTER_MS).toBe(3 * DAY);
  });

  it("offers nothing when no other folder has the file, or only a beta folder does", async () => {
    const { saved } = install();
    const beta = saved("_classic_beta_", "KEV", 10);
    saved("_classic_", "KEV", null);
    saved("_classic_", "KEV", 0, "GuildedDungeons.lua");
    expect((await checkSavedFile(beta, { now: NOW })).candidate).toBeNull();

    const other = install();
    const watched = other.saved("_classic_", "KEV", 10);
    other.saved("_classic_beta_", "KEV", 0);
    other.saved("_classic_ptr_", "KEV", 20);
    expect((await checkSavedFile(watched, { now: NOW })).candidate).toBeNull();
    // A file outside WTF\Account\<account>\SavedVariables is left alone.
    expect((await checkSavedFile(join(other.root, "Guilded.lua"), { now: NOW })).candidate).toBeNull();
  });

  it("prefers the same account folder, then the newest file of any account", async () => {
    const { saved } = install();
    const beta = saved("_classic_beta_", "KEV", 12);
    saved("_classic_", "ALT", 0);
    const mine = saved("_classic_", "KEV", 2);
    expect((await checkSavedFile(beta, { now: NOW })).candidate).toMatchObject({ path: mine, account: "KEV", sameAccount: true });

    const renamed = install();
    const watched = renamed.saved("_classic_beta_", "KEV", 12);
    renamed.saved("_classic_", "OLD", 5);
    const newest = renamed.saved("_classic_", "12345#1", 1);
    expect((await checkSavedFile(watched, { now: NOW })).candidate).toMatchObject({ path: newest, account: "12345#1", sameAccount: false });
  });

  it("skips a folder the player already declined and offers the next one", async () => {
    const { saved } = install();
    const beta = saved("_classic_beta_", "KEV", 12);
    const declined = saved("_classic_", "KEV", 1);
    const next = saved("_forever_", "KEV", 2);
    expect((await checkSavedFile(beta, { now: NOW, ignore: [declined.toUpperCase()] })).candidate).toMatchObject({ path: next });
    expect((await checkSavedFile(beta, { now: NOW, ignore: [declined, next] })).candidate).toBeNull();
  });
});
