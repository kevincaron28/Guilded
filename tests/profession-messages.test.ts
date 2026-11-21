import { describe, expect, it, vi } from "vitest";
import { assignCategories, syncCategoryMessages, type ProfessionPost, type ProfessionRecipe } from "../src/services/profession-board.js";
import { professionCategoryMessages, professionSummaryEmbed, PROFESSION_CATEGORY_PREFIX } from "../src/services/profession-messages.js";
import { professionDetailsEmbed } from "../src/services/profession-details.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const recipe = (index: number, itemName: string, extra: Partial<ProfessionRecipe> = {}): ProfessionRecipe =>
  ({ itemKey: index + 1, itemName, crafters: [{ character: "Ann", lastSeen: NOW }, { character: "Bo", lastSeen: null }, { character: "Cy", lastSeen: null }, { character: "Di", lastSeen: null }], ...extra });
const big = (count = 240): ProfessionPost => {
  const post: ProfessionPost = { profession: "Tailoring", skilled: [{ character: "Ann", skillLevel: 300, lastSeen: NOW }],
    recipes: Array.from({ length: count }, (_, index) => recipe(index, `Imperial Silk Mantle of the Eternal Dawn Number ${index}`, { slot: ["Head", "Chest", "Legs", "Feet"][index % 4]! })) };
  assignCategories([post]);
  return post;
};
const total = (message: ReturnType<typeof professionCategoryMessages>[number]) =>
  message.embeds.reduce((sum, embed) => sum + (embed.toJSON().description ?? "").length + (embed.toJSON().title ?? "").length + (embed.toJSON().footer?.text ?? "").length, 0);

describe("profession category messages", () => {
  it("a 240-recipe profession keeps every recipe within Discord's limits, with a link on each", () => {
    const post = big();
    const messages = professionCategoryMessages(post, "en", NOW);
    expect(messages.length).toBeGreaterThan(4);
    for (const message of messages) {
      expect(message.embeds.length).toBeLessThanOrEqual(10);
      expect(total(message)).toBeLessThanOrEqual(6000);
      for (const embed of message.embeds) expect((embed.toJSON().description ?? "").length).toBeLessThanOrEqual(4096);
      expect(message.components).toHaveLength(1);
    }
    const text = messages.flatMap(message => message.embeds).map(embed => embed.toJSON().description ?? "").join("\n");
    expect(text).not.toContain("more recipes");
    expect((text.match(/\(https:\/\/www\.wowhead\.com\/classic\/item=\d+\)/g) ?? []).length).toBe(240);
    for (let index = 0; index < 240; index++) expect(text).toContain(`Number ${index}**`.replace("**", "](https://www.wowhead.com/classic/item=" + (index + 1) + ")"));
    expect(new Set(messages.map(message => message.slot)).size).toBe(messages.length);
    expect(messages.some(message => message.embeds[0]!.toJSON().description?.includes("(continued)"))).toBe(true);
  });
  it("is deterministic and the button opens the category", () => {
    const first = professionCategoryMessages(big(30), "fr", NOW), second = professionCategoryMessages(big(30), "fr", NOW);
    expect(JSON.stringify(first.map(message => message.embeds.map(embed => embed.toJSON())))).toBe(JSON.stringify(second.map(message => message.embeds.map(embed => embed.toJSON()))));
    const button = first[0]!.components[0]!.toJSON().components[0] as { custom_id: string; label: string };
    expect(button.custom_id).toBe(`${PROFESSION_CATEGORY_PREFIX}tailoring:${first[0]!.category}`);
    expect(button.label.startsWith("Détails")).toBe(true);
  });
  it("the starter summarises and links each category message", () => {
    const post = big(40);
    const plain = professionSummaryEmbed(post, "en", "g1", NOW).toJSON().description ?? "";
    expect(plain).toContain("Recipes** (40)");
    expect(plain).not.toContain("wowhead");
    const messages = professionCategoryMessages(post, "en", NOW);
    const jump = { discordGuildId: "d1", threadId: "t1", firstMessage: new Map(messages.map((message, index) => [message.category, `m${index}`] as [string, string])) };
    expect(professionSummaryEmbed(post, "en", "g1", NOW, jump).toJSON().description).toContain("](https://discord.com/channels/d1/t1/m0)");
    expect(professionSummaryEmbed(post, "en", "g1", NOW).toJSON().footer?.text).toContain("Guilded profession board");
  });
  it("the item card has the item name, link, thumbnail and crafters", () => {
    const post = big(3);
    const embed = professionDetailsEmbed(post, post.recipes[0]!, "en", NOW, { itemId: 1, name: "Mantle", quality: 4, iconUrl: "https://example.com/i.jpg", facts: { slot: "Shoulder", type: "Cloth" } } as never).toJSON();
    expect(embed.url).toContain("wowhead.com/classic/item=1");
    expect(embed.fields?.[0]?.value).toContain("Ann");
    expect(JSON.stringify(embed)).toContain("Shoulder");
  });
});

function fakeThread(id = "t1") {
  let next = 0;
  const messages = { edit: vi.fn(async () => ({})), delete: vi.fn(async () => undefined) };
  const send = vi.fn(async () => ({ id: `m${++next}` }));
  return { id, messages, send } as never as { id: string; messages: typeof messages; send: typeof send };
}
function fakeStore() {
  const rows = new Map<string, Record<string, string>>();
  const keyOf = (where: { guildId: string; profession: string; slot: string }) => `${where.guildId}|${where.profession}|${where.slot}`;
  return { rows, store: {
    findMany: async ({ where }: { where: { guildId: string; profession: string } }) => [...rows.values()].filter(row => row["guildId"] === where.guildId && row["profession"] === where.profession),
    upsert: async ({ where, create }: { where: { guildId_profession_slot: { guildId: string; profession: string; slot: string } }; create: Record<string, string> }) => { rows.set(keyOf(where.guildId_profession_slot), create); },
    deleteMany: async ({ where }: { where: { guildId: string; profession: string; slot: { in: string[] } } }) => { for (const slot of where.slot.in) rows.delete(keyOf({ guildId: where.guildId, profession: where.profession, slot })); }
  } };
}

describe("syncCategoryMessages", () => {
  it("creates the messages, then edits nothing when the content is unchanged", async () => {
    const thread = fakeThread(), { store, rows } = fakeStore();
    const db = { professionPostMessage: store } as never;
    const post = big(60);
    const first = await syncCategoryMessages(thread as never, db, "g1", post, "en", NOW);
    const count = professionCategoryMessages(post, "en", NOW).length;
    expect(thread.send).toHaveBeenCalledTimes(count);
    expect(rows.size).toBe(count);
    expect(first?.size).toBeGreaterThan(0);
    await syncCategoryMessages(thread as never, db, "g1", post, "en", NOW);
    expect(thread.send).toHaveBeenCalledTimes(count);
    expect(thread.messages.edit).not.toHaveBeenCalled();
  });
  it("edits only the message whose recipes changed", async () => {
    const thread = fakeThread(), { store } = fakeStore();
    const db = { professionPostMessage: store } as never;
    const post = big(60);
    await syncCategoryMessages(thread as never, db, "g1", post, "en", NOW);
    post.recipes[0]!.crafters.push({ character: "New", lastSeen: NOW });
    post.recipes[0]!.crafters.reverse();
    await syncCategoryMessages(thread as never, db, "g1", post, "en", NOW);
    expect(thread.messages.edit).toHaveBeenCalledTimes(1);
  });
  it("deletes the message of a category that emptied and posts again a message deleted by hand", async () => {
    const thread = fakeThread(), { store, rows } = fakeStore();
    const db = { professionPostMessage: store } as never;
    const post = big(60);
    await syncCategoryMessages(thread as never, db, "g1", post, "en", NOW);
    const before = rows.size;
    const gone = post.recipes.filter(item => item.category === "arm:head");
    const emptied = { ...post, recipes: post.recipes.filter(item => item.category !== "arm:head") };
    expect(gone.length).toBeGreaterThan(0);
    await syncCategoryMessages(thread as never, db, "g1", emptied, "en", NOW);
    expect(thread.messages.delete).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(before - 1);
    thread.messages.edit.mockRejectedValueOnce({ code: 10008 });
    const changed = { ...emptied, recipes: emptied.recipes.map((item, index) => index === 0 ? { ...item, quality: 4 } : item) };
    const sends = thread.send.mock.calls.length;
    await syncCategoryMessages(thread as never, db, "g1", changed, "en", NOW);
    expect(thread.send.mock.calls.length).toBe(sends + 1);
  });
  it("does nothing when the message store is unavailable", async () => {
    const thread = fakeThread();
    expect(await syncCategoryMessages(thread as never, {} as never, "g1", big(5), "en", NOW)).toBeNull();
    expect(thread.send).not.toHaveBeenCalled();
  });
});
