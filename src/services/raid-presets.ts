// Editable planning suggestions, not verified encounter requirements. Never infer a
// preset from a title: an officer must choose it, and explicit seat counts win.
// Named raids are those open in WoW Forever (docs/raid-loot/FOREVER_RAID_LOOT_2026-10-25.md); each uses the
// generic role split for its size.
import { currentEdition } from "./edition-context.js";
import type { GameEdition } from "./game-edition.js";

const SPLITS = { 10: [2, 2, 6], 20: [2, 4, 14], 25: [2, 5, 18], 30: [2, 6, 22], 40: [2, 8, 30] } as const;
function preset(id: string, name: string, raidSize: keyof typeof SPLITS, editions: readonly GameEdition[] | null) {
  const [tankLimit, healerLimit, dpsLimit] = SPLITS[raidSize];
  return { id, name, raidSize, tankLimit, healerLimit, dpsLimit, editions };
}

export const RAID_PRESETS = [
  preset("barrow", "Barrow Deeps", 10, ["forever"]),
  preset("hyjal", "Hyjal Summit", 20, ["forever"]),
  preset("onyxia", "Onyxia's Lair", 40, ["forever"]),
  preset("group10", "10 players", 10, null),
  preset("group20", "20 players", 20, null),
  preset("group25", "25 players", 25, null),
  preset("group30", "30 players", 30, null),
  preset("group40", "40 players", 40, null)
];
export const raidPresetLabel = (p: { name: string; raidSize: number }) => `${p.name} (${p.raidSize})`;
export const raidPresetsForEdition = () => {
  const edition = currentEdition();
  return RAID_PRESETS.filter(row => !row.editions || row.editions.includes(edition));
};

// Takes the id from autocomplete, or a typed name/label that matches exactly one preset.
export function raidPreset(id: string | null | undefined) {
  if (id == null) return null;
  const key = id.trim().toLowerCase();
  const matches = raidPresetsForEdition().filter(row => row.id === key || row.name.toLowerCase() === key || raidPresetLabel(row).toLowerCase() === key);
  if (matches.length !== 1) throw new Error("Unknown raid preset / Modèle de raid inconnu.");
  return matches[0]!;
}

export function raidPresetChoices(query: string) {
  const q = query.trim().toLowerCase();
  return raidPresetsForEdition().filter(row => !q || raidPresetLabel(row).toLowerCase().includes(q))
    .slice(0, 25).map(row => ({ name: raidPresetLabel(row), value: row.id }));
}

export function presetComposition(id: string) {
  const preset = raidPreset(id)!;
  return { raidSize: preset.raidSize, tankLimit: preset.tankLimit, healerLimit: preset.healerLimit, dpsLimit: preset.dpsLimit };
}
