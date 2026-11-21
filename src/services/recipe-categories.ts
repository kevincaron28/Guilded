import type { Lang } from "../i18n.js";
import { professionSlug } from "./profession-names.js";

// 9.4 track T6: recipes grouped by category in the Discord profession posts. Pure: the category comes from the recipe's
// name plus, when the item data source has answered, the cached equip slot and item subclass. No network, no clock.

export interface CategorizableRecipe { itemName: string; slot?: string | undefined; type?: string | undefined }

interface CategoryDef { en: string; fr: string }
const DEFS: Record<string, CategoryDef> = {
  // Enchanting (by the slot in "Enchant <slot> - ...")
  "ench:weapon": { en: "Weapon", fr: "Arme" }, "ench:2h": { en: "2H Weapon", fr: "Arme à deux mains" }, "ench:chest": { en: "Chest", fr: "Torse" },
  "ench:bracer": { en: "Bracer", fr: "Bracelets" }, "ench:boots": { en: "Boots", fr: "Bottes" }, "ench:gloves": { en: "Gloves", fr: "Gants" },
  "ench:cloak": { en: "Cloak", fr: "Cape" }, "ench:shield": { en: "Shield", fr: "Bouclier" }, "ench:other": { en: "Other enchanting", fr: "Autres enchantements" },
  // Alchemy
  "alch:potion": { en: "Potions", fr: "Potions" }, "alch:elixir": { en: "Elixirs", fr: "Élixirs" }, "alch:flask": { en: "Flasks", fr: "Flacons" },
  "alch:transmute": { en: "Transmutes", fr: "Transmutations" }, "alch:oil": { en: "Oils", fr: "Huiles" },
  // Engineering
  "eng:explosive": { en: "Explosives", fr: "Explosifs" }, "eng:gadget": { en: "Gadgets", fr: "Gadgets" }, "eng:scope": { en: "Scopes", fr: "Lunettes de visée" },
  "eng:goggles": { en: "Goggles", fr: "Lunettes" }, "eng:parts": { en: "Parts", fr: "Pièces" },
  // Weapons / armor / bags / trade goods (Blacksmithing, Leatherworking, Tailoring, and engineered gear)
  weapons: { en: "Weapons", fr: "Armes" }, "arm:head": { en: "Head", fr: "Tête" }, "arm:shoulder": { en: "Shoulder", fr: "Épaules" },
  "arm:chest": { en: "Chest", fr: "Torse" }, "arm:waist": { en: "Waist", fr: "Taille" }, "arm:legs": { en: "Legs", fr: "Jambes" },
  "arm:feet": { en: "Feet", fr: "Pieds" }, "arm:wrist": { en: "Wrist", fr: "Poignets" }, "arm:hands": { en: "Hands", fr: "Mains" },
  "arm:back": { en: "Back", fr: "Dos" }, "arm:shield": { en: "Shields", fr: "Boucliers" }, "arm:other": { en: "Other armor", fr: "Autres armures" },
  bags: { en: "Bags", fr: "Sacs" }, trade: { en: "Trade goods", fr: "Composants" },
  // One group (Cooking, First Aid) and the fallback
  all: { en: "Recipes", fr: "Recettes" }, other: { en: "Other", fr: "Autres" }
};
/** Display order; "other" is always last. */
const ORDER = Object.keys(DEFS).filter(key => key !== "other");

export const categoryLabel = (key: string, lang: Lang): string => (DEFS[key] ?? DEFS["other"]!)[lang === "fr" ? "fr" : "en"];
export const categoryOrder = (key: string): number => key === "other" ? ORDER.length + 1 : ORDER.indexOf(key) >= 0 ? ORDER.indexOf(key) : ORDER.length;
export const isCategoryKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(DEFS, key);

const ENCHANT_SLOTS: [RegExp, string][] = [
  [/^2h weapon$/, "ench:2h"], [/^weapon$/, "ench:weapon"], [/^chest$/, "ench:chest"], [/^bracers?$/, "ench:bracer"], [/^boots?$/, "ench:boots"],
  [/^gloves?$/, "ench:gloves"], [/^cloak$/, "ench:cloak"], [/^shield$/, "ench:shield"]
];
const WEAPON_TYPES = /(sword|dagger|mace|axe|polearm|staff|bow|gun|crossbow|wand|thrown|fist|spear|hammer)/i;
const WEAPON_SLOTS = /^(one-hand|two-hand|main hand|ranged|thrown|held in off-hand)$/i;
const ARMOR_SLOTS: [RegExp, string][] = [
  [/^head$/i, "arm:head"], [/^shoulders?$/i, "arm:shoulder"], [/^chest$|^robe$/i, "arm:chest"], [/^waist$/i, "arm:waist"], [/^legs$/i, "arm:legs"],
  [/^feet$/i, "arm:feet"], [/^wrists?$/i, "arm:wrist"], [/^hands?$/i, "arm:hands"], [/^back$|^cloak$/i, "arm:back"], [/^(off hand|shield)$/i, "arm:shield"]
];
const ARMOR_NAMES: [RegExp, string][] = [
  [/\b(helm|helmet|circlet|hood|cowl|coif|crown|mask)\b/i, "arm:head"], [/\b(shoulders?|pauldrons?|spaulders?|mantle|epaulets?|shoulderpads?)\b/i, "arm:shoulder"],
  [/\b(breastplate|chestguard|tunic|robes?|vest|hauberk|shirt|jerkin|chestpiece|armor)\b/i, "arm:chest"], [/\b(belt|girdle|waistband|sash|cord|waistguard|cinch)\b/i, "arm:waist"],
  [/\b(leggings|pants|legguards|kilt|legplates|trousers)\b/i, "arm:legs"], [/\b(boots?|greaves|sabatons|shoes|footpads|treads|sandals)\b/i, "arm:feet"],
  [/\b(bracers?|wristguards?|bindings|vambraces|armguards|cuffs|wristbands)\b/i, "arm:wrist"], [/\b(gloves?|gauntlets|handguards|mitts|grips)\b/i, "arm:hands"],
  [/\b(cloak|cape)\b/i, "arm:back"], [/\b(shield|buckler)\b/i, "arm:shield"]
];
const WEAPON_NAMES = /\b(sword|blade|axe|mace|dagger|staff|hammer|spear|polearm|bow|gun|rifle|crossbow|wand|claymore|cleaver|scimitar|maul|halberd|stiletto|club|knife|shiv|thrown|throwing)\b/i;
const BAG_NAMES = /\b(bag|pack|quiver|pouch|satchel|ammo)\b/i;

/** The gear classifier shared by Blacksmithing, Leatherworking, Tailoring and engineered gear; null when the item is not gear. */
function gearCategory(recipe: CategorizableRecipe): string | null {
  const slot = recipe.slot?.trim() ?? "", type = recipe.type?.trim() ?? "";
  if (/bag|quiver|ammo/i.test(type) || /^bag$/i.test(slot) || BAG_NAMES.test(recipe.itemName)) return "bags";
  if (WEAPON_SLOTS.test(slot) || (type && WEAPON_TYPES.test(type) && !ARMOR_SLOTS.some(([rx]) => rx.test(slot)))) return "weapons";
  for (const [rx, key] of ARMOR_SLOTS) if (rx.test(slot)) return key;
  if (slot) return "arm:other";
  for (const [rx, key] of ARMOR_NAMES) if (rx.test(recipe.itemName)) return key;
  if (WEAPON_NAMES.test(recipe.itemName)) return "weapons";
  return null;
}

/** The category key of one recipe in one profession ("other" when nothing fits). Never throws. */
export function categoryOf(profession: string, recipe: CategorizableRecipe): string {
  const name = recipe.itemName ?? "";
  switch (professionSlug(profession)) {
    case "enchanting": {
      const match = /^enchant\s+(.+?)\s+-\s+/i.exec(name.trim());
      if (match) for (const [rx, key] of ENCHANT_SLOTS) if (rx.test(match[1]!.trim().toLowerCase())) return key;
      return "ench:other"; // rods, oils, wands and enchants with an unknown slot
    }
    case "alchemy":
      if (/\btransmute\b/i.test(name)) return "alch:transmute";
      if (/\bflask\b/i.test(name)) return "alch:flask";
      if (/\belixir\b/i.test(name)) return "alch:elixir";
      if (/\bpotion\b/i.test(name)) return "alch:potion";
      if (/\boil\b/i.test(name)) return "alch:oil";
      return "other";
    case "cooking": case "first aid": return "all";
    case "engineering": {
      if (/goggles|\blenses?\b/i.test(name)) return "eng:goggles";
      if (/\bscope\b/i.test(name)) return "eng:scope";
      if (/\b(bomb|grenade|dynamite|mine|charge|sapper|rocket|explosive|firework)s?\b/i.test(name)) return "eng:explosive";
      if (/\b(bolt|tube|gears?|casing|frame|handle|barrel|pipe|transformer|fuse|flux|powder)\b/i.test(name) || /trade|parts/i.test(recipe.type ?? "")) return "eng:parts";
      if (/\b(gnomish|goblin|device|gadget|mechanical|robot|shrinker|bot|beacon|rod|net|jammer|trap|repair|teleporter|extractor)\b/i.test(name)) return "eng:gadget";
      return gearCategory(recipe) ?? "other";
    }
    case "blacksmithing": case "leatherworking": case "tailoring":
      return gearCategory(recipe) ?? "trade";
    default: return "other";
  }
}

/** Groups recipes by category, in display order (Other last), each group sorted by name. */
export function groupByCategory<T extends { itemName: string; category?: string | undefined }>(recipes: T[]): { key: string; recipes: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const recipe of recipes) { const key = recipe.category && isCategoryKey(recipe.category) ? recipe.category : "other"; groups.set(key, [...(groups.get(key) ?? []), recipe]); }
  return [...groups].map(([key, list]) => ({ key, recipes: [...list].sort((a, b) => a.itemName.localeCompare(b.itemName)) }))
    .sort((a, b) => categoryOrder(a.key) - categoryOrder(b.key));
}
