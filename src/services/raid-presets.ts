// Editable planning suggestions, not verified encounter requirements. Never infer a
// preset from a title: an officer must choose it, and explicit seat counts win.
export const RAID_PRESETS = [
  { id: "barrow", name: "Barrow Deeps", raidSize: 10, tankLimit: 2, healerLimit: 2, dpsLimit: 6 },
  { id: "hyjal", name: "Hyjal Summit", raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14 },
  { id: "onyxia", name: "Onyxia's Lair", raidSize: 40, tankLimit: 2, healerLimit: 8, dpsLimit: 30 }
] as const;

export function raidPreset(id: string | null | undefined) {
  if (id == null) return null;
  const preset = RAID_PRESETS.find(row => row.id === id);
  if (!preset) throw new Error("Unknown raid preset / Modèle de raid inconnu.");
  return preset;
}

export function presetComposition(id: string) {
  const preset = raidPreset(id)!;
  return { raidSize: preset.raidSize, tankLimit: preset.tankLimit, healerLimit: preset.healerLimit, dpsLimit: preset.dpsLimit };
}
