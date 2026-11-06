import { describe, expect, it, vi } from "vitest";
import { loadProfessionPosts, professionPostEmbed, updateProfessionPosts } from "../src/services/profession-board.js";
import { professionDirectoryText } from "../src/services/profession-directory.js";
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
    expect(en.description).toContain("**Elixir** — Fresh (today), Old (5 weeks ago)");
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
    expect(text).toContain("**Alchemy**: 2 crafters · last seen: Fresh (today) → <#999>");
  });
  it("stays quiet when an officer switched the posts off", async () => {
    const forum = { threads: { fetchActive: vi.fn(), create: vi.fn() } };
    const off = { guildSettings: { findUnique: async () => ({ professionPostsEnabled: false }) } };
    expect(await updateProfessionPosts({ id: "d1" } as never, forum as never, off as never, "g1", "en", NOW)).toBe(0);
    expect(forum.threads.fetchActive).not.toHaveBeenCalled();
  });
  it("edits an existing post in place and creates a missing one only where the preview allows", async () => {
    const edit = vi.fn();
    const existing = { name: "📚 Alchemy", archived: false, fetchStarterMessage: async () => ({ editable: true, edit }), setArchived: vi.fn() };
    const create = vi.fn();
    const forum = { threads: { fetchActive: async () => ({ threads: new Map([["1", existing]]) }), fetchArchived: async () => ({ threads: new Map() }), create } };
    const on = { guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) }, ...db };
    process.env["FEATURE_PREVIEW_GUILD_IDS"] = "someone-else";
    try {
      expect(await updateProfessionPosts({ id: "d1" } as never, forum as never, on as never, "g1", "en", NOW)).toBe(1);
    } finally { delete process.env["FEATURE_PREVIEW_GUILD_IDS"]; }
    expect(edit).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(await updateProfessionPosts({ id: "d1" } as never, forum as never, on as never, "g1", "en", NOW)).toBe(2);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
