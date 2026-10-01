// Lists behind the dropdowns in slash commands, so people pick instead of type.
// Classes are a fixed choice (fits Discord's 25-choice limit); races, specs and
// the rest are suggestions (autocomplete): typing anything else still works.

export const CLASSES = [
  "Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid",
  "Death Knight", "Monk", "Demon Hunter", "Evoker"
] as const;

export const RACES = [
  "Human", "Dwarf", "Night Elf", "Gnome", "Draenei", "Worgen", "Pandaren",
  "Orc", "Undead", "Tauren", "Troll", "Blood Elf", "Goblin"
] as const;

export const PROFESSIONS = [
  "Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Leatherworking", "Tailoring",
  "Jewelcrafting", "Inscription", "Herbalism", "Mining", "Skinning", "Cooking", "First Aid", "Fishing", "Archaeology"
] as const;

export const SPECS: Record<string, string[]> = {
  Warrior: ["Arms", "Fury", "Protection"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Rogue: ["Assassination", "Combat", "Outlaw", "Subtlety"],
  Priest: ["Discipline", "Holy", "Shadow"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Mage: ["Arcane", "Fire", "Frost"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Druid: ["Balance", "Feral", "Guardian", "Restoration"],
  "Death Knight": ["Blood", "Frost", "Unholy"],
  Monk: ["Brewmaster", "Mistweaver", "Windwalker"],
  "Demon Hunter": ["Havoc", "Vengeance", "Devourer"],
  Evoker: ["Devastation", "Preservation", "Augmentation"]
};

export const EP_REASONS = ["Raid attendance", "Boss kill", "On-time bonus", "Consumables", "Standby / bench", "Correction"];
export const GP_REASONS = ["Loot: ", "Tier piece", "Off-spec item", "Correction"];
export const REVERSE_REASONS = ["Entered by mistake", "Wrong player", "Duplicate entry"];
export const AVAILABILITY = ["Weekday evenings", "Weekends", "Any evening", "Flexible"];
export const DURATIONS: [number, string][] = [[30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"]];
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// Case-insensitive contains, best (prefix) matches first, at most 25 (Discord's limit).
export function pick(list: readonly string[], query: string): { name: string; value: string }[] {
  const needle = query.trim().toLowerCase();
  const matches = list.filter((item) => !needle || item.toLowerCase().includes(needle));
  matches.sort((a, b) => Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle)));
  return matches.slice(0, 25).map((item) => ({ name: item.slice(0, 100), value: item.slice(0, 100) }));
}
