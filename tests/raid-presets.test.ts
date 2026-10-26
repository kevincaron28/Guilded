import { describe, expect, it } from "vitest";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";
import { CORE_RAID_SIZES } from "../src/services/core-planning.js";
import { withEdition } from "../src/services/edition-context.js";
import { RAID_PRESETS, raidPreset, raidPresetChoices, raidPresetsForEdition } from "../src/services/raid-presets.js";

const named = (edition: typeof GAME_EDITIONS[number]) => withEdition(edition, () => raidPresetsForEdition().filter(p => !p.id.startsWith("group")).map(p => p.id));

describe("raid presets by edition", () => {
  it("offers only each edition's open raids, plus the generic sizes everywhere", () => {
    expect(named("forever")).toEqual(["barrow", "hyjal", "onyxia"]);
    expect(named("classic-era")).toEqual(["onyxia", "molten-core", "blackwing-lair", "zulgurub", "aq20", "aq40", "naxxramas"]);
    expect(named("classic-tbc")).toEqual(["karazhan", "gruul", "magtheridon", "serpentshrine", "tempest-keep", "tbc-hyjal", "black-temple", "zulaman"]);
    expect(named("classic-mists")).toEqual(["msv-10", "msv-25", "hof-10", "hof-25", "toes-10", "toes-25", "tot-10", "tot-25", "soo-10", "soo-25"]);
    expect(named("retail")).toEqual([]);
    for (const edition of GAME_EDITIONS) {
      expect(withEdition(edition, () => raidPresetsForEdition().filter(p => p.id.startsWith("group")).length)).toBe(5);
    }
  });

  it("keeps ids unique and every role split equal to the raid size", () => {
    expect(new Set(RAID_PRESETS.map(p => p.id)).size).toBe(RAID_PRESETS.length);
    for (const p of RAID_PRESETS) expect(p.tankLimit + p.healerLimit + p.dpsLimit).toBe(p.raidSize);
  });

  it("fits Discord's 25-option menus: the core planner adds sizes and Retail's flexible entry", () => {
    for (const edition of GAME_EDITIONS) {
      const presets = withEdition(edition, () => raidPresetsForEdition().length);
      expect(presets + CORE_RAID_SIZES.length + (edition === "retail" ? 1 : 0)).toBeLessThanOrEqual(25);
      expect(withEdition(edition, () => raidPresetChoices("")).length).toBe(presets);
    }
  });

  it("filters autocomplete by name and size", () => {
    expect(withEdition("classic-mists", () => raidPresetChoices("siege"))).toEqual([
      { name: "Siege of Orgrimmar (10)", value: "soo-10" }, { name: "Siege of Orgrimmar (25)", value: "soo-25" }]);
    expect(withEdition("classic-tbc", () => raidPresetChoices("hyjal"))).toEqual([{ name: "Hyjal Summit (25)", value: "tbc-hyjal" }]);
    expect(withEdition("forever", () => raidPresetChoices("hyjal"))).toEqual([{ name: "Hyjal Summit (20)", value: "hyjal" }]);
  });

  it("accepts a typed name or label only when it names one preset of this edition", () => {
    expect(withEdition("classic-era", () => raidPreset("Molten Core")?.id)).toBe("molten-core");
    expect(withEdition("classic-mists", () => raidPreset("siege of orgrimmar (25)")?.id)).toBe("soo-25");
    expect(() => withEdition("classic-mists", () => raidPreset("Siege of Orgrimmar"))).toThrow(/Unknown raid preset/);
    expect(() => withEdition("classic-tbc", () => raidPreset("molten-core"))).toThrow(/Unknown raid preset/);
    expect(() => withEdition("retail", () => raidPreset("barrow"))).toThrow(/Unknown raid preset/);
    expect(withEdition("retail", () => raidPreset("group20")?.raidSize)).toBe(20);
  });
});
