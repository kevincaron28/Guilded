import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { folderEdition, isOtherEditionFolder } from "../companion/wow-folder.mjs";
import { checkInstalledAddon } from "../companion/addon-install.mjs";
import { checkSavedFile } from "../companion/live-folder.mjs";
import { wowSearchMessage } from "../companion/wow-search.mjs";

const { detectOtherEditionSavedVariables, rankSavedVariables } = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");

// The companion supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md, stage 3).
describe("game folders", () => {
  it("names Forever folders; the closed beta client is Forever", () => {
    expect(folderEdition("_forever_")).toBe("forever");
    expect(folderEdition("_classic_beta_")).toBe("forever");
    for (const other of ["_classic_era_", "_anniversary_", "_retail_"]) expect(folderEdition(other)).toBe("other");
    expect(folderEdition("World of Warcraft")).toBeNull();
  });

  it("skips other WoW versions' folders but never an unnamed or ambiguous folder", () => {
    for (const other of ["_retail_", "_classic_era_", "_anniversary_"]) expect(isOtherEditionFolder(other)).toBe(true);
    // "_classic_" is ambiguous (the live Forever client may use it), so it is never skipped.
    for (const kept of ["_forever_", "_classic_beta_", "_classic_", "World of Warcraft", ""]) expect(isOtherEditionFolder(kept)).toBe(false);
  });
});

describe("companion", () => {
  const entry = (game: string, exists = true) => ({ path: `C:\\WoW\\${game}\\WTF\\Guilded.lua`, exists, game, modifiedMs: 1 });

  it("counts other WoW versions' saved files separately instead of offering them", () => {
    expect(typeof detectOtherEditionSavedVariables).toBe("function");
    const ranked = rankSavedVariables([entry("_retail_"), entry("_forever_")]);
    expect(ranked.filter((item: { game: string }) => !isOtherEditionFolder(item.game)).map((item: { game: string }) => item.game)).toEqual(["_forever_"]);
    expect(rankSavedVariables([entry("_retail_")]).filter((item: { game: string }) => !isOtherEditionFolder(item.game))).toEqual([]);
    expect(wowSearchMessage({ otherEdition: 1 }).text[0]).toMatch(/WoW Forever only/);
  });

  it("says plainly that an install of another WoW version is left alone, not an error", async () => {
    expect(await checkInstalledAddon("C:\\Games\\WoW\\_retail_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua")).toMatchObject({ status: "other-edition" });
    expect((await checkInstalledAddon("C:\\Games\\WoW\\_forever_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua")).status).toBe("not-installed");
  });

  describe("live-folder candidates", () => {
    const roots: string[] = [];
    afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
    const save = (root: string, game: string, seconds: number) => {
      const dir = join(root, game, "WTF", "Account", "ACCT", "SavedVariables");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "Guilded.lua");
      writeFileSync(file, "x");
      utimesSync(file, seconds, seconds);
      return file;
    };

    it("moves from the beta folder to the Forever folder but never to another WoW version's file", async () => {
      const root = mkdtempSync(join(tmpdir(), "guilded-other-"));
      roots.push(root);
      const beta = save(root, "_classic_beta_", 1_000);
      save(root, "_retail_", 5_000);
      expect((await checkSavedFile(beta)).candidate).toBeNull();
      const forever = save(root, "_forever_", 3_000);
      expect((await checkSavedFile(beta)).candidate).toMatchObject({ path: forever, reason: "beta" });
    });
  });
});
