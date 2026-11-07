import { describe, expect, it, vi } from "vitest";
import { addItemQuality, loadProfessionPosts, professionPostEmbed, QUALITY_SQUARES, recipeCrafters, updateProfessionPosts } from "../src/services/profession-board.js";
import { professionDetailsRow } from "../src/services/profession-details.js";
import { professionDirectoryText, professionNavRows } from "../src/services/profession-directory.js";
import { findProfessionHolders } from "../src/services/profession-search.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const db = {
  professionSkill: { findMany: async () => [
    { profession: "Alchemy", skillLevel: 300, character: { name: "Old", lastSeenAt: ago(40), member: { displayName: "Olive" }, isMain: true } },
    { profession: "alchemy", skillLevel: 150, character: { name: "Fresh", lastSeenAt: ago(0.1), member: { displayName: "Fred" }, isMain: true } },
    { profession: "Mining", skillLevel: 100, character: { name: "Scanner", lastSeenAt: null, member: { displayName: "Sam" }, isMain: false } }
  ] },
  recipeKnown: {
    findMany: async () => [
      { character: "Old", profession: "Alchemy", itemKey: 1, itemName: "Elixir", scannedAt: ago(41) },
      { character: "Fresh", profession: "Alchemy", itemKey: 1, itemName: "Elixir", scannedAt: ago(3) },
      { character: "Scanner", profession: "Mining", itemKey: 2, itemName: "Smelt", scannedAt: ago(5) }
    ],
    groupBy: async () => [{ character: "Scanner", _max: { scannedAt: ago(5) } }]
  }
};

describe("profession posts and last seen", () => {
  it("groups spelling variants, lists recently seen crafters first and uses the roster date", async () => {
    const posts = await loadProfessionPosts(db as never, "g1");
    const alchemy = posts.find(post => post.profession === "Alchemy")!;
    expect(alchemy.skilled.map(row => row.character)).toEqual(["Fresh", "Old"]);
    expect(alchemy.recipes[0]?.crafters.map(row => row.character)).toEqual(["Fresh", "Old"]);
    expect(alchemy.recipes[0]?.crafters[0]?.lastSeen).toEqual(ago(0.1));
    expect(posts.find(post => post.profession === "Mining")?.skilled[0]?.lastSeen).toEqual(ago(5));
  });
  it("renders one embed per profession with last seen, in both languages, and marks itself for adoption", async () => {
    const [alchemy] = await loadProfessionPosts(db as never, "g1");
    const en = professionPostEmbed(alchemy!, "en", "g1", NOW).toJSON();
    expect(en.title).toBe("🧪 Alchemy");
    expect(en.description).toContain("skill (out of 300)");
    expect(en.description).toContain("🟢 **Fresh** ▰▰▰▰▱▱▱▱ 150 · today");
    expect(en.description).toContain("• **[Elixir](https://www.wowhead.com/classic/item=1)** — 🟢 Fresh, ⚪ Old");
    expect(en.footer?.text).toContain("Guilded profession board");
    expect(professionPostEmbed(alchemy!, "fr", "g1", NOW).toJSON().description).toContain("aujourd'hui");
  });
  it("cuts a very long recipe list with a pointer to the search instead of overflowing Discord", () => {
    const recipes = Array.from({ length: 400 }, (_, index) => ({ itemKey: index, itemName: `Recipe number ${index}`, crafters: [{ character: "Ann", lastSeen: NOW }] }));
    const embed = professionPostEmbed({ profession: "Cooking", skilled: [], recipes }, "en", "g1", NOW).toJSON();
    expect((embed.description ?? "").length).toBeLessThanOrEqual(4096);
    expect(embed.description).toMatch(/…and \d+ more recipes/);
  });
  it("adds last seen to holders and to the directory index, and links the profession post", async () => {
    const holders = await findProfessionHolders(db as never, "g1", "mining");
    expect(holders[0]?.lastSeen).toEqual(ago(5));
    const text = await professionDirectoryText(db as never, "g1", "en", new Map([["alchemy", "999"]]), NOW);
    expect(text).toContain("🧪 **Alchemy** · 2 crafters · last seen: Fresh (today) → <#999>");
    expect(text).toContain("⛏️ **Mining** · 1 crafter");
  });
  it("stays quiet when an officer switched the posts off", async () => {
    const forum = { threads: { fetchActive: vi.fn(), create: vi.fn() } };
    const off = { guildSettings: { findUnique: async () => ({ professionPostsEnabled: false }) } };
    expect(await updateProfessionPosts({ id: "d1" } as never, forum as never, off as never, "g1", "en", NOW)).toBe(0);
    expect(forum.threads.fetchActive).not.toHaveBeenCalled();
  });
  it("edits an existing post in place and creates a missing one", async () => {
    const edit = vi.fn();
    const existing = { name: "📚 Alchemy", archived: false, fetchStarterMessage: async () => ({ editable: true, edit }), setArchived: vi.fn() };
    const create = vi.fn();
    const forum = { threads: { fetchActive: async () => ({ threads: new Map([["1", existing]]) }), fetchArchived: async () => ({ threads: new Map() }), create } };
    const on = { guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) }, ...db };
    expect(await updateProfessionPosts({ id: "d1" } as never, forum as never, on as never, "g1", "en", NOW)).toBe(2);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps ONE Details menu under each post (25 at most) and one jump button per profession under the directory", async () => {
    const [alchemy] = await loadProfessionPosts(db as never, "g1");
    const row = professionDetailsRow(alchemy!, "en")!.toJSON();
    expect((row.components[0] as { custom_id: string }).custom_id).toBe("pdet:alchemy");
    expect((row.components[0] as { options: { value: string }[] }).options.map(option => option.value)).toEqual(["1"]);
    const many = { profession: "Cooking", skilled: [], recipes: Array.from({ length: 60 }, (_, index) => ({ itemKey: index, itemName: `Dish ${index}`, crafters: [{ character: "Ann", lastSeen: NOW }] })) };
    expect((professionDetailsRow(many, "en")!.toJSON().components[0] as { options: unknown[] }).options).toHaveLength(25);
    expect(professionDetailsRow({ profession: "Mining", skilled: [], recipes: [] }, "en")).toBeNull();
    const rows = professionNavRows(["Alchemy", "Mining", "Fishing"], new Map([["alchemy", "999"], ["mining", "1000"]]), "d1");
    expect(rows).toHaveLength(1);
    const buttons = rows[0]!.toJSON().components as { url: string; label: string }[];
    expect(buttons.map(button => button.url)).toEqual(["https://discord.com/channels/d1/999", "https://discord.com/channels/d1/1000"]);
  });
  it("lists who can craft one recipe with skill and last seen", async () => {
    const found = await recipeCrafters(db as never, "g1", 1);
    expect(found?.itemName).toBe("Elixir");
    expect(found?.profession).toBe("Alchemy");
    expect(found?.crafters.map(crafter => [crafter.character, crafter.skill])).toEqual([["Fresh", 150], ["Old", 300]]);
    expect(await recipeCrafters(db as never, "g1", 999)).toBeNull();
  });
});

describe("one crafter entry per shown name", () => {
  it("merges repeated scans of the same crafter so the request menu has no duplicate options", async () => {
    const { requestRows } = await import("../src/commands/craft-board.js");
    const rows = requestRows("en", 4245, [
      { character: "Chad Ho", skill: 150, lastSeen: null },
      { character: "Chad Ho", skill: 150, lastSeen: null },
      { character: "chad ho", skill: 150, lastSeen: null },
      { character: "Mister", skill: 100, lastSeen: null }
    ]);
    const options = (rows[0]!.toJSON() as { components: { options: { value: string }[] }[] }).components[0]!.options;
    expect(options.map(option => option.value)).toEqual(["Chad Ho", "Mister"]);
  });
});

describe("item links in profession posts (docs/plans/ITEM_LINKS.md)", () => {
  it("marks quality with one square, links crafted items and leaves enchants plain", async () => {
    const post = { profession: "Enchanting", skilled: [], recipes: [
      { itemKey: 19019, itemName: "Thunder [x] fury", crafters: [{ character: "Ann", lastSeen: NOW }] },
      { itemKey: -7418, itemName: "Enchant Bracer - Minor Health", crafters: [{ character: "Ann", lastSeen: NOW }] }
    ] };
    const lookup = vi.fn(async () => ({ name: "Thunderfury", quality: 5 }));
    await addItemQuality([post], { lookup });
    expect(lookup).toHaveBeenCalledTimes(1); // the enchant is a spell, never looked up
    const text = professionPostEmbed(post, "en", "g1", NOW).toJSON().description ?? "";
    expect(text).toContain("🟧 **[Thunder x fury](https://www.wowhead.com/classic/item=19019)**");
    expect(text).toContain("• **Enchant Bracer - Minor Health**");
    expect(QUALITY_SQUARES).toHaveLength(6);
  });
  it("keeps the bullet when the item data source knows nothing or fails", async () => {
    const post = { profession: "Cooking", skilled: [], recipes: [{ itemKey: 5, itemName: "Stew", crafters: [] }] };
    await addItemQuality([post], { lookup: async () => { throw new Error("down"); } });
    expect(professionPostEmbed(post, "en", "g1", NOW).toJSON().description).toContain("• **[Stew]");
  });
});
