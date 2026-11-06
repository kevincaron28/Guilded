import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pagesInUse } from "../companion/page-visibility.mjs";
import { checkSavedFile } from "../companion/live-folder.mjs";
import { checkInstalledAddon } from "../companion/addon-install.mjs";

const { accountsUnder, installRootOf } = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");

// Folder picker (8.5, track F3): whatever folder the member picks, the account folders are found.
let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });
function install() {
  root = mkdtempSync(join(tmpdir(), "guilded-picker-"));
  const wow = join(root, "World of Warcraft");
  const account = (flavor: string, name: string, saved: boolean) => {
    const folder = join(wow, flavor, "WTF", "Account", name, "SavedVariables");
    mkdirSync(folder, { recursive: true });
    if (saved) writeFileSync(join(folder, "Guilded.lua"), "GuildedDB = {}\n");
    return folder;
  };
  return { wow, account };
}

describe("WoW folder picker", () => {
  it("finds the Forever account from the install folder, a parent folder or the game folder", () => {
    const { wow, account } = install();
    account("_forever_", "123456#1", true);
    account("_classic_beta_", "123456#1", true);
    for (const picked of [wow, root, join(wow, "_forever_"), join(wow, "_forever_", "WTF")]) {
      const found = accountsUnder(picked, ["Guilded.lua"]);
      expect(found.map((entry: { account: string; game: string }) => `${entry.game}/${entry.account}`), picked).toEqual(["_forever_/123456#1"]);
      expect(found[0].exists).toBe(true);
    }
  });

  it("lists every account so the member can choose, newest saved data first", () => {
    const { wow, account } = install();
    const first = account("_forever_", "AAA#1", true);
    account("_forever_", "BBB#2", true);
    account("_forever_", "CCC#3", false);
    utimesSync(join(first, "Guilded.lua"), new Date("2026-11-01"), new Date("2026-11-01"));
    const found = accountsUnder(wow, ["Guilded.lua"]);
    expect(found.map((entry: { account: string }) => entry.account)).toEqual(["BBB#2", "AAA#1", "CCC#3"]);
    expect(found[2]).toMatchObject({ exists: false, path: join(wow, "_forever_", "WTF", "Account", "CCC#3", "SavedVariables", "Guilded.lua") });
  });

  it("keeps to one account when the member picks inside it, and leaves held editions out", () => {
    const { wow, account } = install();
    const saved = account("_forever_", "AAA#1", true);
    account("_forever_", "BBB#2", true);
    account("_retail_", "AAA#1", true);
    expect(accountsUnder(join(saved, ".."), ["Guilded.lua"]).map((entry: { account: string }) => entry.account)).toEqual(["AAA#1"]);
    const held = accountsUnder(wow, ["Guilded.lua"], (game: string) => game === "_retail_");
    expect(held.every((entry: { game: string }) => entry.game === "_forever_")).toBe(true);
  });

  it("finds nothing in an unrelated folder, and knows an install's root", () => {
    root = mkdtempSync(join(tmpdir(), "guilded-picker-"));
    expect(accountsUnder(root, ["Guilded.lua"])).toEqual([]);
    expect(installRootOf("C:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\X\\SavedVariables\\Guilded.lua")?.replaceAll("/", "\\")).toBe("C:\\Games\\World of Warcraft");
    expect(installRootOf("D:\\Elsewhere\\Guilded.lua")).toBeNull();
  });
});

describe("saved-file neighbours and installed addon version", () => {
  it("reports when other addons last saved in the same folder", async () => {
    const { account } = install();
    const folder = account("_forever_", "AAA#1", true);
    writeFileSync(join(folder, "Blizzard_Console.lua"), "x = 1\n");
    writeFileSync(join(folder, "Guilded.lua.bak"), "old\n");
    utimesSync(join(folder, "Guilded.lua"), new Date("2026-11-01T10:00:00Z"), new Date("2026-11-01T10:00:00Z"));
    utimesSync(join(folder, "Blizzard_Console.lua"), new Date("2026-11-05T10:00:00Z"), new Date("2026-11-05T10:00:00Z"));
    const result = await checkSavedFile(join(folder, "Guilded.lua"));
    expect(result.othersChangedAt).toBe("2026-11-05T10:00:00.000Z");
    expect(result.changedAt).toBe("2026-11-01T10:00:00.000Z");
  });

  it("reads the installed addon's version from its TOC", async () => {
    const { wow, account } = install();
    const folder = account("_forever_", "AAA#1", true);
    const addon = join(wow, "_forever_", "Interface", "AddOns", "Guilded");
    mkdirSync(addon, { recursive: true });
    writeFileSync(join(addon, "Guilded.toc"), "## Interface: 11508\n## X-Guilded-Edition: forever\n## Version: 8.5.0\n");
    expect(await checkInstalledAddon(join(folder, "Guilded.lua"))).toMatchObject({ status: "ok", version: "8.5.0" });
  });
});

describe("optional pages", () => {
  it("stay hidden until the guild has a raid core or soft reserves", () => {
    expect(pagesInUse(null)).toEqual({ reserves: false, wishlist: false, pricing: false, cores: false });
    expect(pagesInUse({ reserves: { list: null, cores: [] } })).toEqual({ reserves: false, wishlist: false, pricing: false, cores: false });
    expect(pagesInUse({ reserves: { list: null, cores: [{ id: "1", lootMode: "EPGP" }] } })).toEqual({ reserves: false, wishlist: true, pricing: true, cores: true });
    expect(pagesInUse({ reserves: { list: { active: false }, cores: [] } })["reserves"]).toBe(true);
    expect(pagesInUse({ reserves: { list: null, cores: [{ id: "1", lootMode: "RESERVE" }] } })["reserves"]).toBe(true);
  });
  it("never hides a page this PC has already shown", () => {
    expect(pagesInUse(null, { pricing: true, cores: true })).toMatchObject({ pricing: true, cores: true, reserves: false });
  });
});
