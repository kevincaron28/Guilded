import { describe, expect, it, vi } from "vitest";
import { enableAfterStepZero, parseStepZeroButton, runStepZero, stepZeroButtons, type BotWebhook } from "../src/services/item-preview-step0.js";
import { openSecret } from "../src/services/secret-box.js";
import { postWebhook, type FetchLike } from "../src/services/item-preview-webhook.js";
import { buildPayload } from "../src/services/item-preview-embed.js";
import { professionDetailsEmbed, professionDetailsRow, findProfessionRecipe } from "../src/services/profession-details.js";
import type { ProfessionPost } from "../src/services/profession-board.js";

const URL = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789";
const SECRET = "x".repeat(40);
const reply = (status: number, body: unknown = {}) => ({ status, headers: { get: () => null }, json: async () => body });
const hook = (remove: () => Promise<void> = async () => undefined): BotWebhook => ({ id: "123456789012345678", url: URL, remove });

describe("step 0: test embed through a temporary webhook", () => {
  it("posts one embed, never mentions anyone, deletes the webhook and returns the test post", async () => {
    const remove = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => reply(200, { id: "223456789012345678" }));
    const result = await runStepZero({ createWebhook: async () => hook(remove), fetch: fetchMock as unknown as FetchLike }, "323456789012345678");
    expect(result).toMatchObject({ ok: true, stage: "done", messageId: "223456789012345678", cleaned: true });
    expect(remove).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.embeds).toHaveLength(1);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].footer.text).toContain("test");
    expect(result.detail).not.toContain("webhooks/");
  });
  it("stops cleanly when the bot cannot create a webhook (nothing to clean up)", async () => {
    const fetchMock = vi.fn();
    const result = await runStepZero({ createWebhook: async () => { throw new Error("Missing Permissions"); }, fetch: fetchMock as unknown as FetchLike }, "1");
    expect(result).toMatchObject({ ok: false, stage: "create", cleaned: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([403, 404, 500])("deletes the webhook even when the channel refuses the post (HTTP %i)", async status => {
    const remove = vi.fn(async () => undefined);
    const result = await runStepZero({ createWebhook: async () => hook(remove), fetch: (async () => reply(status)) as unknown as FetchLike }, "1");
    expect(result).toMatchObject({ ok: false, stage: "post", cleaned: true });
    expect(result.detail).toContain(`HTTP ${status}`);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("deletes the webhook when the network throws, and says so if even that fails", async () => {
    const result = await runStepZero({ createWebhook: async () => hook(async () => { throw new Error("nope"); }), fetch: (async () => { throw new Error(URL); }) as unknown as FetchLike }, "1");
    expect(result).toMatchObject({ ok: false, cleaned: false });
    expect(result.detail).toContain("delete \"Guilded item preview test\"");
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

describe("turning previews on after step 0", () => {
  it("creates the permanent webhook itself and stores only the encrypted url", async () => {
    const saved: { channelId: string; webhookId: string; webhookSealed: string }[] = [];
    const result = await enableAfterStepZero({ createWebhook: async (_c, name) => { expect(name).toBe("Guilded item previews"); return hook(); }, save: async row => { saved.push(row); }, secret: SECRET }, "323456789012345678");
    expect(result.ok).toBe(true);
    expect(saved[0]!.webhookId).toBe("123456789012345678");
    expect(saved[0]!.webhookSealed).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(openSecret(SECRET, saved[0]!.webhookSealed)).toBe(URL);
    expect(result.detail).not.toContain("webhooks/");
  });
  it("removes the new webhook when saving fails, and stays off when it cannot be created", async () => {
    const remove = vi.fn(async () => undefined);
    const failed = await enableAfterStepZero({ createWebhook: async () => hook(remove), save: async () => { throw new Error("db"); }, secret: SECRET }, "1");
    expect(failed.ok).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await enableAfterStepZero({ createWebhook: async () => { throw new Error("x"); }, save: async () => undefined, secret: SECRET }, "1")).ok).toBe(false);
  });
  it("round-trips the owner's button ids and rejects anything else", () => {
    const ids = stepZeroButtons("323456789012345678", "223456789012345678");
    expect(parseStepZeroButton(ids.pass)).toEqual({ verdict: "ok", channelId: "323456789012345678", messageId: "223456789012345678" });
    expect(parseStepZeroButton(ids.fail)?.verdict).toBe("bad");
    expect(ids.pass.length).toBeLessThanOrEqual(100);
    expect(parseStepZeroButton("ipv:ok:1:2")).toBeNull();
    expect(parseStepZeroButton("ipv:maybe:323456789012345678:223456789012345678")).toBeNull();
  });
  it("postWebhook returns the created message id only when Discord sends a valid one", async () => {
    expect(await postWebhook((async () => reply(200, { id: "223456789012345678" })) as unknown as FetchLike, URL, buildPayload([]))).toEqual({ ok: true, messageId: "223456789012345678" });
    expect(await postWebhook((async () => reply(200, { id: "<script>" })) as unknown as FetchLike, URL, buildPayload([]))).toEqual({ ok: true });
  });
});

const NOW = new Date("2026-11-10T12:00:00Z");
const post: ProfessionPost = { profession: "Alchemy", skilled: [], recipes: [
  { itemKey: 2092, itemName: "Elixir of *Might*", crafters: [{ character: "Amy Smith", lastSeen: NOW }, { character: "Bob", lastSeen: null }] },
  { itemKey: -7418, itemName: "Enchant Bracer", crafters: [{ character: "Cy", lastSeen: null }] }
] };

describe("profession post Details menu", () => {
  it("offers at most 25 recipes by name and keeps ids within Discord's limits", () => {
    const many: ProfessionPost = { ...post, recipes: Array.from({ length: 40 }, (_, i) => ({ itemKey: i + 1, itemName: `Recipe ${i}`.repeat(30), crafters: [] })) };
    const json = professionDetailsRow(many, "en")!.toJSON().components[0] as { custom_id: string; options: { label: string; value: string }[] };
    expect(json.options).toHaveLength(25);
    expect(json.options.every(o => o.label.length <= 100)).toBe(true);
    expect(json.custom_id).toBe("pdet:alchemy");
    expect(professionDetailsRow({ ...post, recipes: [] }, "en")).toBeNull();
  });
  it("answers with the full preview: link for an item id, none for an enchant, and every crafter's last seen", () => {
    const item = professionDetailsEmbed(post, post.recipes[0]!, "en", NOW).toJSON();
    expect(item.url).toBe("https://www.wowhead.com/classic/item=2092");
    expect(item.title).toContain("Elixir of");
    expect(item.fields![0]!.value).toContain("Amy Smith");
    expect(item.fields![0]!.value).toContain("Bob");
    const enchant = professionDetailsEmbed(post, post.recipes[1]!, "fr", NOW).toJSON();
    expect(enchant.url).toBeUndefined();
    expect(enchant.description).toContain("7418");
  });
  it("finds the recipe a pick refers to and rejects stale or forged picks", () => {
    expect(findProfessionRecipe([post], "pdet:alchemy", "2092")?.recipe.itemName).toContain("Elixir");
    expect(findProfessionRecipe([post], "pdet:alchemy", "-7418")?.recipe.itemKey).toBe(-7418);
    expect(findProfessionRecipe([post], "pdet:alchemy", "999")).toBeNull();
    expect(findProfessionRecipe([post], "pdet:mining", "2092")).toBeNull();
    expect(findProfessionRecipe([post], "pdet:alchemy", "2092; drop")).toBeNull();
    expect(findProfessionRecipe([post], "other:alchemy", "2092")).toBeNull();
  });
});
