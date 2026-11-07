import { describe, expect, it, vi } from "vitest";
import { ACTIVE_EDITIONS, activeEditions, editionList, heldEditions } from "../companion/active-editions.mjs";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";
import { editionCards, editionPages, editionHubs } from "../site/editions.mjs";
import { EDITION_SECTIONS, editionMenu } from "../site/nav.mjs";

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
        editionList: (lang: 0 | 1, active?: readonly string[], joiner?: string[]) => real.editionList(lang, active ?? ALL, joiner)
      };
    });
    try {
      const site = await import("../site/editions.mjs");
      const cards = site.editionCards({ hubs: true });
      for (const edition of ALL) expect(cards).toContain(`edition-${edition}`);
      const pages = site.editionPages("9.9.9", { version: "9.9.9", editions: Object.fromEntries(ALL.map(id => [id, { Guilded: `https://example.test/${id}` }])) });
      expect(pages.some(page => page.body.includes("Coming back later"))).toBe(false);
    } finally {
      vi.doUnmock("../companion/active-editions.mjs");
      vi.resetModules();
    }
  });
});
