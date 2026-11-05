import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_EDITIONS, activeEditions, editionList, folderEdition, heldEditions, isFolderOnHold } from "../companion/active-editions.mjs";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";
import { checkInstalledAddon } from "../companion/addon-install.mjs";
import { checkSavedFile } from "../companion/live-folder.mjs";
import { editionCards, editionPages, editionHubs } from "../site/editions.mjs";
import { EDITION_SECTIONS, editionMenu } from "../site/nav.mjs";

const { detectHeldSavedVariables, rankSavedVariables } = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");
const ALL = [...GAME_EDITIONS];
const OTHERS = ALL.filter(edition => edition !== "forever");

// The Forever-first switch: ACTIVE_EDITIONS (companion/active-editions.mjs) is the only list that
// decides what members are offered. Hidden is not deleted, and flipping the list brings it back.
describe("Forever-first switch", () => {
  it("ships with WoW Forever only, and every id is a real edition", () => {
    expect([...ACTIVE_EDITIONS]).toEqual(["forever"]);
    for (const edition of ACTIVE_EDITIONS) expect(ALL).toContain(edition);
    expect(heldEditions()).toEqual(OTHERS);
  });

  it("can be flipped back: the helpers follow whatever list they are given", () => {
    expect(activeEditions(ALL)).toEqual(ALL);
    expect(heldEditions(ALL)).toEqual([]);
    expect(editionList(0)).toBe("WoW Forever");
    expect(editionList(0, ["forever", "retail"])).toBe("WoW Forever or Retail");
    expect(isFolderOnHold("_retail_", ALL)).toBe(false);
    expect(isFolderOnHold("_retail_", ["forever"])).toBe(true);
  });
});

describe("game folders", () => {
  it("names the edition of each folder; the closed beta client is Forever", () => {
    expect(folderEdition("_forever_")).toBe("forever");
    expect(folderEdition("_classic_beta_")).toBe("forever");
    expect(folderEdition("_classic_era_")).toBe("classic-era");
    expect(folderEdition("_retail_")).toBe("retail");
    expect(folderEdition("World of Warcraft")).toBeNull();
  });

  it("holds other editions' folders but never an unnamed install folder", () => {
    for (const held of ["_retail_", "_classic_era_", "_anniversary_"]) expect(isFolderOnHold(held)).toBe(true);
    // "_classic_" is ambiguous (the live Forever client may use it), so it is never held.
    for (const kept of ["_forever_", "_classic_beta_", "_classic_", "World of Warcraft", ""]) expect(isFolderOnHold(kept)).toBe(false);
  });
});

describe("companion", () => {
  const entry = (game: string, exists = true) => ({ path: `C:\\WoW\\${game}\\WTF\\Guilded.lua`, exists, game, modifiedMs: 1 });

  it("reports held saved files separately instead of offering them", () => {
    // detectHeldSavedVariables only filters what exists on disk; exercise the pure ranking helper too.
    expect(typeof detectHeldSavedVariables).toBe("function");
    const ranked = rankSavedVariables([entry("_retail_"), entry("_forever_")]);
    expect(ranked.filter((item: { game: string }) => !isFolderOnHold(item.game)).map((item: { game: string }) => item.game)).toEqual(["_forever_"]);
    expect(rankSavedVariables([entry("_retail_")]).filter((item: { game: string }) => !isFolderOnHold(item.game))).toEqual([]);
  });

  it("says plainly that a non-Forever install is on hold, not an error", async () => {
    expect(await checkInstalledAddon("C:\\Games\\WoW\\_retail_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua")).toMatchObject({ status: "on-hold" });
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

    it("moves from the beta folder to the Forever folder but never to another edition's file", async () => {
      const root = mkdtempSync(join(tmpdir(), "guilded-held-"));
      roots.push(root);
      const beta = save(root, "_classic_beta_", 1_000);
      save(root, "_retail_", 5_000);
      expect((await checkSavedFile(beta)).candidate).toBeNull();
      const forever = save(root, "_forever_", 3_000);
      expect((await checkSavedFile(beta)).candidate).toMatchObject({ path: forever, reason: "beta" });
    });
  });
});

describe("website", () => {
  it("offers only the active editions as cards and in the header menu", () => {
    for (const hubs of [true, false]) {
      const cards = editionCards({ hubs });
      expect(cards).toContain("edition-forever");
      for (const other of OTHERS) expect(cards).not.toContain(`edition-${other}`);
    }
    const menu = editionMenu({ current: null, title: "x", label: section => section.en, href: section => `/${section.slug}/`, only: ACTIVE_EDITIONS });
    expect(menu).toContain('data-edition="forever"');
    for (const section of EDITION_SECTIONS.filter(section => section.id !== "forever")) expect(menu).not.toContain(`data-edition="${section.slug}"`);
  });

  it("keeps every edition's page but gives a held edition no download", () => {
    const curseforge = { version: "9.9.9", editions: Object.fromEntries(ALL.map(id => [id, { Guilded: `https://example.test/${id}` }])) };
    const pages = editionPages("9.9.9", curseforge);
    const page = (id: string) => pages.find(candidate => candidate.path === `editions/${id}/`)!;
    expect(page("forever").body).not.toContain("Coming back later");
    for (const other of OTHERS) {
      expect(page(other)).toBeDefined();
      expect(page(other).body).toContain("Coming back later");
      expect(page(other).body).not.toContain(`https://example.test/${other}`);
    }
    for (const hub of editionHubs("9.9.9", curseforge).filter(hub => hub.gameEdition !== "forever")) expect(hub.body).toContain("Coming back later");
    expect(pages[0]!.description).toBe("Find the Guilded addon build for WoW Forever.");
  });
});

describe("flipping the switch restores everything", () => {
  it("shows every edition again when ACTIVE_EDITIONS lists them", async () => {
    vi.resetModules();
    vi.doMock("../companion/active-editions.mjs", async () => {
      const real = await vi.importActual<typeof import("../companion/active-editions.mjs")>("../companion/active-editions.mjs");
      return {
        ...real, ACTIVE_EDITIONS: ALL,
        isEditionActive: (id: string) => real.isEditionActive(id, ALL), activeEditions: () => real.activeEditions(ALL),
        editionList: (lang: 0 | 1, active?: readonly string[], joiner?: string[]) => real.editionList(lang, active ?? ALL, joiner),
        isFolderOnHold: (name: string) => real.isFolderOnHold(name, ALL)
      };
    });
    try {
      const site = await import("../site/editions.mjs");
      const cards = site.editionCards({ hubs: true });
      for (const edition of ALL) expect(cards).toContain(`edition-${edition}`);
      const pages = site.editionPages("9.9.9", { version: "9.9.9", editions: Object.fromEntries(ALL.map(id => [id, { Guilded: `https://example.test/${id}` }])) });
      expect(pages.some(page => page.body.includes("Coming back later"))).toBe(false);
      const live = await import("../companion/active-editions.mjs");
      expect(live.isFolderOnHold("_retail_")).toBe(false);
      const addon = await import("../companion/addon-install.mjs");
      expect((await addon.checkInstalledAddon("C:\\Games\\WoW\\_retail_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua")).status).toBe("not-installed");
    } finally {
      vi.doUnmock("../companion/active-editions.mjs");
      vi.resetModules();
    }
  });
});
