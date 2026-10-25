import { describe, expect, it, vi } from "vitest";
import { editionFromInterface, gameEditionOf } from "../companion/game-edition.mjs";
import { parseAddonExportText } from "../companion/lua-export-content.mjs";
import { personalPayloadFrom } from "../companion/personal-runs-content.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { assertSnapshotEdition } from "../src/services/game-edition.js";
import { personalSnapshot } from "../src/services/companion-access.js";
import { createAddonImportService } from "../src/services/addon-import.js";
import { findCharacter } from "../src/services/character-match.js";

describe("edition provenance and import isolation", () => {
  it.each([[16001, "forever"], [11509, "classic-era"], [20506, "classic-tbc"], [50504, "classic-mists"], [120105, "retail"]])("recognizes interface %i without certifying client support", (api, edition) => {
    expect(editionFromInterface(api)).toBe(edition);
    expect(gameEditionOf({ interface: api })).toBe(edition);
  });
  it("keeps legacy Forever exports but rejects unknown or contradictory provenance", () => {
    expect(gameEditionOf({})).toBe("forever");
    for (const source of [{ interface: 999 }, { interface: "16001" }, { gameEdition: "other" }, { gameEdition: "forever", interface: 120105 }]) {
      expect(() => gameEditionOf(source)).toThrow();
    }
  });
  const saved = (api: number) => `GuildedDB = { character = { name = "Ray", realm = "Realm", interface = ${api} }, dungeon = { runs = { { id = "run-1", state = "COMPLETED", instanceId = 36, interface = ${api}, endedAt = 1000 } } } }`;
  it("carries client metadata through guild, personal and member-scoped exports", () => {
    const exported = parseAddonExportText(saved(16001), "Realm");
    expect(exported).toMatchObject({ gameEdition: "forever", interface: 16001 });
    expect(exported.dungeonRuns[0]).toMatchObject({ gameEdition: "forever", interface: 16001 });
    const narrowed = personalSnapshot(parseAddonSnapshot(exported), [{ name: "Ray", realm: "Realm" }]);
    expect(narrowed).toMatchObject({ gameEdition: "forever", interface: 16001 });
    expect(personalPayloadFrom([saved(120105)]).character).toMatchObject({ gameEdition: "retail", interface: 120105 });
  });
  it("refuses to merge personal files from different clients", () => {
    expect(() => personalPayloadFrom([saved(16001), saved(120105)])).toThrow("one WoW edition");
  });
  it("rejects mismatched guild uploads before import lookup or any mutation", async () => {
    const findFirst = vi.fn();
    const db = { guild: { findUnique: vi.fn().mockResolvedValue({ gameEdition: "forever" }) }, guildSettings: { findUnique: vi.fn().mockResolvedValue({ gameEdition: "forever" }) }, addonImport: { findFirst } };
    await expect(createAddonImportService(db as never).preview("g", { source: "Guilded", exportedAt: new Date(), gameEdition: "retail" }, "u")).rejects.toThrow("This guild uses forever");
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("rechecks a queued import before touching any character or ledger", async () => {
    const findMany = vi.fn();
    const tx = { guild: { findUnique: vi.fn().mockResolvedValue({ gameEdition: "forever" }) },
      $executeRaw: vi.fn(),
      addonImport: { findFirst: vi.fn().mockResolvedValue({ status: "PREVIEWED", payload: { source: "Guilded", exportedAt: new Date(), gameEdition: "retail" } }) },
      guildSettings: { findUnique: vi.fn().mockResolvedValue({ gameEdition: "forever" }) },
      character: { findMany }
    };
    const db = { $transaction: (fn: (value: unknown) => unknown) => fn(tx) };
    await expect(createAddonImportService(db as never).apply("g", "queued", "u")).rejects.toThrow("This guild uses forever");
    expect(findMany).not.toHaveBeenCalled();
  });
  it("rejects a mixed run or character even under a valid envelope", () => {
    for (const fields of [{ characters: [{ name: "Ray", realm: "R", interface: 120105 }] }, { dungeonRuns: [{ interface: 120105 }] }]) {
      const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(), ...fields });
      expect(() => assertSnapshotEdition(snapshot, "forever")).toThrow("different WoW editions".slice(0, -1));
    }
  });
  it("matches realm and edition exactly outside legacy Forever", () => {
    const retail = { name: "Ray", realm: "One", gameEdition: "retail" };
    const forever = { name: "Ray", realm: "Forever", gameEdition: "forever" };
    expect(findCharacter([retail, forever], "Ray", "One", "retail")).toBe(retail);
    expect(findCharacter([retail, forever], "Ray", "Other", "retail")).toBeUndefined();
    expect(findCharacter([retail], "Ray", "Other")).toBeUndefined();
    expect(findCharacter([forever], "Ray", "Legacy")).toBe(forever);
  });
});
