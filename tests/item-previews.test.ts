import { describe, expect, it, vi } from "vitest";
import { MAX_ITEMS_PER_MESSAGE, parseItemLinks } from "../src/services/item-links.js";
import { CachedItemProvider, itemKey, nullItemDataProvider, PreviewGate } from "../src/services/item-preview-data.js";
import { buildItemEmbed, buildPayload, sanitizeName } from "../src/services/item-preview-embed.js";
import { parseWebhookUrl, postWebhook, type FetchLike } from "../src/services/item-preview-webhook.js";
import { handlePreviewMessage, type PreviewDeps } from "../src/services/item-preview.js";
import { openSecret, sealSecret } from "../src/services/secret-box.js";

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789";
const SECRET = "x".repeat(40);

describe("parseItemLinks", () => {
  it("reads a raw link with colour, enchant and random suffix", () => {
    const [item] = parseItemLinks("look |cff0070dd|Hitem:2092:15:0:0:0:0:-1234:0:60|h[Training Sword of the Owl]|h|r!");
    expect(item).toEqual({ itemId: 2092, name: "Training Sword of the Owl", verified: true, enchantId: 15, suffixId: -1234, quality: 3 });
  });
  it("marks bracket-only text unverified and never invents an id", () => {
    expect(parseItemLinks("got [Linen Cloth] today")).toEqual([{ itemId: null, name: "Linen Cloth", verified: false }]);
  });
  it("does not read a raw link twice and de-duplicates", () => {
    const text = "|cffffffff|Hitem:6948:0:0:0:0:0:0:0:1|h[Hearthstone]|h|r |cffffffff|Hitem:6948:0:0:0:0:0:0:0:1|h[Hearthstone]|h|r [Hearthstone]";
    const items = parseItemLinks(text);
    expect(items.filter(i => i.verified)).toHaveLength(1);
    expect(items).toHaveLength(2); // the bracket-only copy has no id, so it stays separate and unverified
  });
  it("ignores non-items and caps the count", () => {
    expect(parseItemLinks("[1] [..] [] no items here")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `[Item ${String.fromCharCode(65 + i)}]`).join(" ");
    expect(parseItemLinks(many)).toHaveLength(MAX_ITEMS_PER_MESSAGE);
  });
  it("rejects malformed links and survives hostile input quickly", () => {
    expect(parseItemLinks("|Hitem:abc|h[Bad]|h")).toEqual([{ itemId: null, name: "Bad", verified: false }]);
    expect(parseItemLinks("|Hitem:0|h[Zero]|h")[0]?.verified).toBe(false);
    const started = Date.now();
    parseItemLinks("[".repeat(100_000) + "|Hitem:".repeat(50_000) + "|h[".repeat(50_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("embed", () => {
  it("neutralises mentions and markdown", () => {
    const text = sanitizeName("@everyone <@123> [x](http://e.com) **b** :emoji:");
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain("<@");
    expect(text).toContain("\\*\\*b\\*\\*");
  });
  it("links Wowhead only for a verified id and sends no mentions", () => {
    const verified = buildItemEmbed({ itemId: 2092, name: "Dagger", verified: true, quality: 4 }, null);
    expect(verified.url).toBe("https://www.wowhead.com/classic/item=2092");
    expect(verified.color).toBe(0xa335ee);
    const unverified = buildItemEmbed({ itemId: null, name: "Dagger", verified: false }, null);
    // No invented id: a name nobody matched links to a Wowhead search for that name.
    expect(unverified.url).toBe("https://www.wowhead.com/classic/search?q=Dagger");
    expect(buildItemEmbed({ itemId: null, name: "Kresh's Back & co", verified: false }, null).url).toBe("https://www.wowhead.com/classic/search?q=Kresh's%20Back%20%26%20co");
    expect(unverified.description).toContain("Unverified");
    expect(buildPayload([verified]).allowed_mentions).toEqual({ parse: [] });
  });
  it("only accepts https provider urls", () => {
    const e = buildItemEmbed({ itemId: 1, name: "A1", verified: true }, { name: "A1", url: "javascript:alert(1)", iconUrl: "http://x/y.png" });
    expect(e.thumbnail).toBeUndefined();
    expect(e.url).toBe("https://www.wowhead.com/classic/item=1");
  });
});

describe("provider, cache, gate", () => {
  it("never looks up by name and caches by id", async () => {
    let now = 0;
    const inner = { lookup: vi.fn(async () => ({ name: "X" })) };
    const cache = new CachedItemProvider(inner, () => now, 1000);
    expect(await cache.lookup({ itemId: null, name: "Dagger", verified: false })).toBeNull();
    await cache.lookup({ itemId: 5, name: "X", verified: true });
    await cache.lookup({ itemId: 5, name: "X", verified: true });
    expect(inner.lookup).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.lookup({ itemId: 5, name: "X", verified: true });
    expect(inner.lookup).toHaveBeenCalledTimes(2);
    expect(await nullItemDataProvider.lookup({ itemId: 5, name: "X", verified: true })).toBeNull();
  });
  it("de-duplicates and rate-limits per channel with an injected clock", () => {
    let now = 0;
    const gate = new PreviewGate(() => now, 2, 1000);
    expect(gate.allow("c", "a")).toBe(true);
    expect(gate.allow("c", "a")).toBe(false);
    expect(gate.allow("c", "b")).toBe(true);
    expect(gate.allow("c", "c")).toBe(false); // over 2 per minute
    expect(gate.allow("other", "c")).toBe(true);
    now = 61_000;
    expect(gate.allow("c", "a")).toBe(true);
  });
});

describe("secret box", () => {
  it("round-trips and refuses a wrong key or tampering", () => {
    const sealed = sealSecret(SECRET, HOOK);
    expect(sealed).not.toContain("abcdefghij");
    expect(openSecret(SECRET, sealed)).toBe(HOOK);
    expect(openSecret("y".repeat(40), sealed)).toBeNull();
    // Always change the last characters (a fixed "AA" left the text unchanged whenever it already ended in "AA").
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(openSecret(SECRET, tampered)).toBeNull();
    expect(openSecret(SECRET, "garbage")).toBeNull();
  });
});

const response = (status: number, retryAfter?: string, body: unknown = {}) => ({ status, headers: { get: (n: string) => n === "retry-after" ? retryAfter ?? null : null }, json: async () => body });

describe("postWebhook", () => {
  it("accepts only Discord webhook urls", () => {
    expect(parseWebhookUrl(HOOK)).toEqual({ id: "123456789012345678", token: "abcdefghijklmnopqrstuvwxyz0123456789" });
    expect(parseWebhookUrl("https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
    expect(parseWebhookUrl("http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
  });
  it("posts with wait=true and no mentions", async () => {
    const fetchMock = vi.fn(async () => response(200));
    const result = await postWebhook(fetchMock as unknown as FetchLike, HOOK, buildPayload([]));
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("?wait=true");
    expect(JSON.parse(init.body).allowed_mentions).toEqual({ parse: [] });
  });
  it("maps 401/404 to disable, 429 to retry-after, others to plain failure", async () => {
    const run = (r: ReturnType<typeof response>) => postWebhook((async () => r) as unknown as FetchLike, HOOK, buildPayload([]));
    expect(await run(response(404))).toMatchObject({ ok: false, disable: true, status: 404 });
    expect(await run(response(401))).toMatchObject({ disable: true });
    expect(await run(response(429, "2.5"))).toMatchObject({ disable: false, retryAfterMs: 2500 });
    expect(await run(response(429, undefined, { retry_after: 1 }))).toMatchObject({ retryAfterMs: 1000 });
    expect(await run(response(500))).toEqual({ ok: false, status: 500, disable: false });
  });
  it("never leaks the url when fetch throws", async () => {
    const result = await postWebhook((async () => { throw new Error(HOOK); }) as unknown as FetchLike, HOOK, buildPayload([]));
    expect(JSON.stringify(result)).not.toContain("abcdefghij");
  });
});

describe("handlePreviewMessage", () => {
  const row = { discordGuildId: "g", channelId: "chan", webhookId: "123456789012345678", webhookSealed: sealSecret(SECRET, HOOK), enabled: true };
  const make = (over: Partial<PreviewDeps> = {}, fetchStatus = 200) => {
    const fetchMock = vi.fn(async () => response(fetchStatus));
    const disable = vi.fn(async () => undefined);
    const deps: PreviewDeps = {
      loadConfig: async () => row, disable, secret: SECRET, botUserId: "bot", fetch: fetchMock as unknown as FetchLike,
      provider: nullItemDataProvider, gate: new PreviewGate(() => 0), backoff: new Map(), now: () => 0, ...over
    };
    return { deps, fetchMock, disable };
  };
  const msg = (over = {}) => ({ guildId: "g", channelId: "chan", content: "[Linen Cloth]", authorId: "relay", webhookId: "other", ...over });

  it("is off by default and when disabled", async () => {
    expect(await handlePreviewMessage(make({ loadConfig: async () => null }).deps, msg())).toBe("off");
    expect(await handlePreviewMessage(make({ loadConfig: async () => ({ ...row, enabled: false }) }).deps, msg())).toBe("off");
  });
  it("posts one preview for a relayed message", async () => {
    const { deps, fetchMock } = make();
    expect(await handlePreviewMessage(deps, msg())).toBe("posted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("ignores other channels, itself, its own webhook and plain text", async () => {
    const { deps, fetchMock } = make();
    expect(await handlePreviewMessage(deps, msg({ channelId: "x" }))).toBe("wrong-channel");
    expect(await handlePreviewMessage(deps, msg({ authorId: "bot" }))).toBe("self");
    expect(await handlePreviewMessage(deps, msg({ webhookId: row.webhookId }))).toBe("self");
    expect(await handlePreviewMessage(deps, msg({ content: "hello" }))).toBe("no-items");
    // The addon's own "[Guilded] Help! ..." lines are a tag, not an item (seen in #chat-guilde, 8 Nov).
    expect(await handlePreviewMessage(deps, msg({ content: "[Guilded] Help! Domichammon Graves is under attack in Ashenvale" }))).toBe("no-items");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("posts a burst of five bracket names from the relay within the per-minute gate, each linked", async () => {
    const { deps, fetchMock } = make();
    for (const name of ["Keen Skinning Knife", "Conjured Muffin", "Intact Makrura Eye", "Strange Dust", "Greater Magic Wand"]) {
      expect(await handlePreviewMessage(deps, msg({ content: `[${name}]` }))).toBe("posted");
    }
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)) as { embeds: { url?: string }[] };
    expect(body.embeds[0]!.url).toBe("https://www.wowhead.com/classic/search?q=Keen%20Skinning%20Knife");
  });
  it("de-duplicates a repeated link", async () => {
    const { deps } = make();
    expect(await handlePreviewMessage(deps, msg())).toBe("posted");
    expect(await handlePreviewMessage(deps, msg())).toBe("throttled");
  });
  it("disables the server when Discord says the webhook is gone", async () => {
    const { deps, disable } = make({}, 404);
    expect(await handlePreviewMessage(deps, msg())).toBe("disabled");
    expect(disable).toHaveBeenCalledWith("g", expect.stringContaining("404"));
  });
  it("backs off after a 429 and needs the secret", async () => {
    const backoff = new Map<string, number>();
    const rate = make({ backoff, gate: new PreviewGate(() => 0) }, 429);
    expect(await handlePreviewMessage(rate.deps, msg())).toBe("failed");
    expect(await handlePreviewMessage(rate.deps, msg({ content: "[Other Thing]" }))).toBe("backoff");
    expect(await handlePreviewMessage(make({ secret: undefined }).deps, msg())).toBe("no-secret");
  });
  it("disables when the stored secret cannot be opened", async () => {
    const { deps, disable } = make({ secret: "z".repeat(40) });
    expect(await handlePreviewMessage(deps, msg())).toBe("bad-secret");
    expect(disable).toHaveBeenCalled();
  });
});

describe("itemKey", () => {
  it("separates different suffixes of one item id", () => {
    expect(itemKey({ itemId: 1, name: "A", verified: true, suffixId: -1 })).not.toBe(itemKey({ itemId: 1, name: "A", verified: true, suffixId: -2 }));
  });
});
