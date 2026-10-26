// Editable planning suggestions, not verified encounter requirements. Never infer a
// preset from a title: an officer must choose it, and explicit seat counts win.
// Named raids are only those open in each edition (sources: docs/raid-loot/RAID_PRESETS_BY_EDITION.md);
// each uses the generic role split for its size. Retail raids are flexible, so Retail keeps the sizes.
import { currentEdition } from "./edition-context.js";
import type { GameEdition } from "./game-edition.js";

const SPLITS = { 10: [2, 2, 6], 20: [2, 4, 14], 25: [2, 5, 18], 30: [2, 6, 22], 40: [2, 8, 30] } as const;
function preset(id: string, name: string, raidSize: keyof typeof SPLITS, editions: readonly GameEdition[] | null) {
  const [tankLimit, healerLimit, dpsLimit] = SPLITS[raidSize];
  return { id, name, raidSize, tankLimit, healerLimit, dpsLimit, editions };
}
const ERA = ["classic-era"] as const, TBC = ["classic-tbc"] as const, MISTS = ["classic-mists"] as const;
const mists = (id: string, name: string) => [preset(`${id}-10`, name, 10, MISTS), preset(`${id}-25`, name, 25, MISTS)];

export const RAID_PRESETS = [
  preset("barrow", "Barrow Deeps", 10, ["forever"]),
  preset("hyjal", "Hyjal Summit", 20, ["forever"]),
  preset("onyxia", "Onyxia's Lair", 40, ["forever", "classic-era"]),
  preset("molten-core", "Molten Core", 40, ERA),
  preset("blackwing-lair", "Blackwing Lair", 40, ERA),
  preset("zulgurub", "Zul'Gurub", 20, ERA),
  preset("aq20", "Ruins of Ahn'Qiraj", 20, ERA),
  preset("aq40", "Temple of Ahn'Qiraj", 40, ERA),
  preset("naxxramas", "Naxxramas", 40, ERA),
  preset("karazhan", "Karazhan", 10, TBC),
  preset("gruul", "Gruul's Lair", 25, TBC),
  preset("magtheridon", "Magtheridon's Lair", 25, TBC),
  preset("serpentshrine", "Serpentshrine Cavern", 25, TBC),
  preset("tempest-keep", "Tempest Keep: The Eye", 25, TBC),
  preset("tbc-hyjal", "Hyjal Summit", 25, TBC),
  preset("black-temple", "Black Temple", 25, TBC),
  preset("zulaman", "Zul'Aman", 10, TBC),
  ...mists("msv", "Mogu'shan Vaults"),
  ...mists("hof", "Heart of Fear"),
  ...mists("toes", "Terrace of Endless Spring"),
  ...mists("tot", "Throne of Thunder"),
  ...mists("soo", "Siege of Orgrimmar"),
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
