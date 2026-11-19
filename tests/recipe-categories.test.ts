import { describe, expect, it } from "vitest";
import { categoryLabel, categoryOf, groupByCategory, isCategoryKey } from "../src/services/recipe-categories.js";
import { professionCategoryMessages } from "../src/services/profession-messages.js";
import { assignCategories, type ProfessionPost, type ProfessionRecipe } from "../src/services/profession-board.js";
import { professionDetailsRow, professionCategoryView, findProfessionCategory } from "../src/services/profession-details.js";

const NOW = new Date("2026-11-19T12:00:00Z");
const cat = (profession: string, itemName: string, slot?: string, type?: string) => categoryOf(profession, { itemName, slot, type });

describe("categoryOf", () => {
  it("groups enchants by the slot in the name; rods and oils are Other enchanting", () => {
    expect(cat("Enchanting", "Enchant Chest - Major Mana")).toBe("ench:chest");
    expect(cat("Enchanting", "Enchant Bracer - Superior Strength")).toBe("ench:bracer");
    expect(cat("Enchanting", "Enchant Weapon - Crusader")).toBe("ench:weapon");
    expect(cat("Enchanting", "Enchant 2H Weapon - Major Spirit")).toBe("ench:2h");
    expect(cat("Enchanting", "Enchant Cloak - Greater Resistance")).toBe("ench:cloak");
    expect(cat("Enchanting", "Runed Arcanite Rod")).toBe("ench:other");
    expect(cat("Enchanting", "Minor Wizard Oil")).toBe("ench:other");
    expect(cat("Enchanting", "Enchant Ring - Strength")).toBe("ench:other");
  });
  it("groups alchemy by name, transmutes first", () => {
    expect(cat("Alchemy", "Major Healing Potion")).toBe("alch:potion");
    expect(cat("Alchemy", "Elixir of the Mongoose")).toBe("alch:elixir");
    expect(cat("Alchemy", "Flask of the Titans")).toBe("alch:flask");
    expect(cat("Alchemy", "Transmute: Iron to Gold")).toBe("alch:transmute");
    expect(cat("Alchemy", "Shadow Oil")).toBe("alch:oil");
    expect(cat("Alchemy", "Philosopher Stone")).toBe("other");
  });
  it("keeps cooking and first aid in one group, in either language's canonical name", () => {
    expect(cat("Cooking", "Roast Raptor")).toBe("all");
    expect(cat("Cuisine", "Roast Raptor")).toBe("all");
    expect(cat("First Aid", "Heavy Runecloth Bandage")).toBe("all");
  });
  it("groups engineering by name and item type", () => {
    expect(cat("Engineering", "Goblin Sapper Charge")).toBe("eng:explosive");
    expect(cat("Engineering", "Crude Throwing Dynamite")).toBe("eng:explosive");
    expect(cat("Engineering", "Sniper Scope")).toBe("eng:scope");
    expect(cat("Engineering", "Gnomish Goggles")).toBe("eng:goggles");
    expect(cat("Engineering", "Gold Power Core")).toBe("other");
    expect(cat("Engineering", "Mithril Casing")).toBe("eng:parts");
    expect(cat("Engineering", "Gnomish Net-o-Matic Projector")).toBe("eng:gadget");
    expect(cat("Engineering", "Dark Iron Rifle", "Ranged", "Gun")).toBe("weapons");
  });
  it("uses the cached slot and type for gear, and names when nothing is cached", () => {
    expect(cat("Blacksmithing", "Imperial Plate Helm", "Head", "Plate")).toBe("arm:head");
    expect(cat("Blacksmithing", "Arcanite Reaper", "Two-Hand", "Two-Handed Axe")).toBe("weapons");
    expect(cat("Blacksmithing", "Thorium Shield Spike", "Off Hand", "Shield")).toBe("arm:shield");
    expect(cat("Leatherworking", "Devilsaur Gauntlets")).toBe("arm:hands");
    expect(cat("Leatherworking", "Heavy Leather Ammo Pouch")).toBe("bags");
    expect(cat("Tailoring", "Runecloth Bag")).toBe("bags");
    expect(cat("Tailoring", "Bolt of Runecloth")).toBe("trade");
    expect(cat("Tailoring", "Robe of Winter Night", "Chest", "Cloth")).toBe("arm:chest");
    expect(cat("Tailoring", "Mooncloth Boots")).toBe("arm:feet");
  });
  it("falls back to Other and never throws", () => {
    expect(cat("Mining", "Smelt Thorium")).toBe("other");
    expect(cat("Poisons", "Instant Poison")).toBe("other");
    expect(isCategoryKey("toString")).toBe(false);
  });
  it("has an English and a French label for every category, and Other last", () => {
    const keys = ["ench:chest", "ench:2h", "alch:oil", "eng:goggles", "weapons", "arm:head", "arm:shoulder", "arm:other", "bags", "trade", "all", "other"];
    for (const key of keys) { expect(categoryLabel(key, "en")).not.toBe(""); expect(categoryLabel(key, "fr")).not.toBe(""); }
    expect(categoryLabel("alch:elixir", "fr")).toBe("Élixirs");
    const sorted = groupByCategory([{ itemName: "Z", category: "other" }, { itemName: "B", category: "alch:flask" }, { itemName: "A", category: "alch:potion" }, { itemName: "C" }]);
    expect(sorted.map(group => group.key)).toEqual(["alch:potion", "alch:flask", "other"]);
    expect(sorted.at(-1)!.recipes.map(recipe => recipe.itemName)).toEqual(["C", "Z"]);
  });
});

const recipe = (index: number, itemName: string): ProfessionRecipe => ({ itemKey: -index - 1, itemName, crafters: [{ character: "Ann", lastSeen: NOW }, { character: "Bo", lastSeen: null }] });
const slots = ["Chest", "Bracer", "Boots", "Gloves", "Cloak", "Weapon", "2H Weapon", "Shield"];
const bigEnchanting = (): ProfessionPost => {
  const recipes = Array.from({ length: 96 }, (_, index) => recipe(index, `Enchant ${slots[index % slots.length]} - Greater Effect ${index}`));
  recipes.push(recipe(200, "Runed Golden Rod"));
  const post: ProfessionPost = { profession: "Enchanting", skilled: [{ character: "Ann", skillLevel: 300, lastSeen: NOW }], recipes };
  assignCategories([post]);
  return post;
};

describe("post sections", () => {
  it("renders every recipe under one heading per category, Other last, with nothing hidden", () => {
    const messages = professionCategoryMessages(bigEnchanting(), "en", NOW);
    const text = messages.flatMap(message => message.embeds).map(embed => embed.toJSON().description ?? "").join("\n");
    expect(text).toContain("### Weapon (12)");
    expect(text).toContain("### Chest (12)");
    expect(text.indexOf("### Weapon")).toBeLessThan(text.indexOf("### Chest"));
    expect(text).not.toContain("more recipes not shown");
    expect((text.match(/^• \*\*/gm) ?? []).length).toBe(97);
  });
  it("keeps the line format and the French headings", () => {
    const post: ProfessionPost = { profession: "Alchemy", skilled: [], recipes: [{ ...recipe(0, "Elixir of Might"), itemKey: 9, category: "alch:elixir", quality: 2 }, { ...recipe(1, "Major Healing Potion"), itemKey: 8, category: "alch:potion" }] };
    const text = professionCategoryMessages(post, "fr", NOW).flatMap(message => message.embeds).map(embed => embed.toJSON().description ?? "").join("\n");
    expect(text).toContain("### Potions (1)");
    expect(text).toContain("### Élixirs (1)");
    expect(text).toContain("🟩 **[Elixir of Might](https://www.wowhead.com/classic/item=9)** — 🟢 Ann, ⚪ Bo");
  });
});

describe("two-step Details menu", () => {
  it("step 1 lists categories with counts; step 2 lists one category and a pick finds the category", () => {
    const post = bigEnchanting();
    const row = professionDetailsRow(post, "en")!.toJSON().components[0] as { custom_id: string; options: { label: string; value: string }[] };
    expect(row.custom_id).toBe("pdet:enchanting");
    expect(row.options.map(option => option.label)).toContain("Chest (12)");
    expect(row.options.at(-1)!.label).toBe("Other enchanting (1)");
    expect(row.options.length).toBeLessThanOrEqual(25);
    const found = findProfessionCategory([post], row.custom_id, "ench:chest")!;
    const view = professionCategoryView(found.post, found.category, 0, "en")!;
    const options = (view.components[0]!.toJSON().components[0] as { options: { value: string }[] }).options;
    expect(options).toHaveLength(12);
    expect(view.components).toHaveLength(1);
    expect(findProfessionCategory([post], row.custom_id, "12345")).toBeNull();
  });
});
