import { describe, expect, it } from "vitest";
import { CORE_RAID_SIZES } from "../src/services/core-planning.js";
import { withEdition } from "../src/services/edition-context.js";
import { RAID_PRESETS, raidPreset, raidPresetChoices, raidPresetsForEdition } from "../src/services/raid-presets.js";

const named = () => withEdition("forever", () => raidPresetsForEdition().filter(p => !p.id.startsWith("group")).map(p => p.id));

// WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md): its open raids plus the generic sizes.
describe("raid presets", () => {
  it("offers WoW Forever's open raids, plus the generic sizes", () => {
    expect(named()).toEqual(["barrow", "hyjal", "onyxia"]);
    expect(withEdition("forever", () => raidPresetsForEdition().filter(p => p.id.startsWith("group")).length)).toBe(5);
    // Other editions' raids are gone: a guild of another edition sees the generic sizes only.
    expect(withEdition("classic-era", () => raidPresetsForEdition().map(p => p.id).filter(id => !id.startsWith("group")))).toEqual([]);
  });

  it("keeps ids unique and every role split equal to the raid size", () => {
    expect(new Set(RAID_PRESETS.map(p => p.id)).size).toBe(RAID_PRESETS.length);
    for (const p of RAID_PRESETS) expect(p.tankLimit + p.healerLimit + p.dpsLimit).toBe(p.raidSize);
  });

  it("fits Discord's 25-option menus: the core planner adds the sizes", () => {
    const presets = withEdition("forever", () => raidPresetsForEdition().length);
    expect(presets + CORE_RAID_SIZES.length).toBeLessThanOrEqual(25);
    expect(withEdition("forever", () => raidPresetChoices("")).length).toBe(presets);
  });

  it("filters autocomplete by name and size", () => {
    expect(withEdition("forever", () => raidPresetChoices("hyjal"))).toEqual([{ name: "Hyjal Summit (20)", value: "hyjal" }]);
    expect(withEdition("forever", () => raidPresetChoices("40")).map(choice => choice.value)).toEqual(["onyxia", "group40"]);
  });

  it("accepts a typed name or label only when it names one WoW Forever preset", () => {
    expect(withEdition("forever", () => raidPreset("Onyxia's Lair")?.id)).toBe("onyxia");
    expect(withEdition("forever", () => raidPreset("hyjal summit (20)")?.id)).toBe("hyjal");
    expect(() => withEdition("forever", () => raidPreset("Molten Core"))).toThrow(/Unknown raid preset/);
    expect(withEdition("forever", () => raidPreset("group20")?.raidSize)).toBe(20);
  });
});
