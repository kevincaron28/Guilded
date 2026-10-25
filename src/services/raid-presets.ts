// Editable planning suggestions, not verified encounter requirements. Never infer a
// preset from a title: an officer must choose it, and explicit seat counts win.
import { currentEdition } from "./edition-context.js";
export const RAID_PRESETS = [
  { id: "barrow", name: "Barrow Deeps", raidSize: 10, tankLimit: 2, healerLimit: 2, dpsLimit: 6 },
  { id: "hyjal", name: "Hyjal Summit", raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14 },
  { id: "onyxia", name: "Onyxia's Lair", raidSize: 40, tankLimit: 2, healerLimit: 8, dpsLimit: 30 },
  { id: "group10", name: "10 players", raidSize: 10, tankLimit: 2, healerLimit: 2, dpsLimit: 6 },
  { id: "group20", name: "20 players", raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14 },
  { id: "group25", name: "25 players", raidSize: 25, tankLimit: 2, healerLimit: 5, dpsLimit: 18 },
  { id: "group30", name: "30 players", raidSize: 30, tankLimit: 2, healerLimit: 6, dpsLimit: 22 },
  { id: "group40", name: "40 players", raidSize: 40, tankLimit: 2, healerLimit: 8, dpsLimit: 30 }
] as const;
export const raidPresetsForEdition = () => RAID_PRESETS.filter(row => currentEdition() === "forever" || row.id.startsWith("group"));

export function raidPreset(id: string | null | undefined) {
  if (id == null) return null;
  const preset = raidPresetsForEdition().find(row => row.id === id);
  if (!preset) throw new Error("Unknown raid preset / Modèle de raid inconnu.");
  return preset;
}

export function presetComposition(id: string) {
  const preset = raidPreset(id)!;
  return { raidSize: preset.raidSize, tankLimit: preset.tankLimit, healerLimit: preset.healerLimit, dpsLimit: preset.dpsLimit };
}
