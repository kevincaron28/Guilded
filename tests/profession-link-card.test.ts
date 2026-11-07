import { describe, expect, it, vi } from "vitest";
import { addCardQualities, linkerNames, loadProfessionCard, parseProfessionLinks, professionCardEmbed } from "../src/services/profession-link-card.js";
import { handlePreviewMessage, type PreviewDeps } from "../src/services/item-preview.js";
import { nullItemDataProvider, PreviewGate } from "../src/services/item-preview-data.js";
import { sealSecret } from "../src/services/secret-box.js";

const RAW = "|cffffd000|Htrade:Player-1-0ABC1234:3908:197|h[Tailoring]|h|r";

describe("profession links in chat", () => {
  it("reads raw trade links (English or French name) and never treats other text as a profession", () => {
    expect(parseProfessionLinks(`look ${RAW}`)).toEqual([{ profession: "Tailoring", verified: true }]);
    expect(parseProfessionLinks("|Htrade:x:1:2|h[Couture]|h")).toEqual([{ profession: "Tailoring", verified: true }]);
    expect(parseProfessionLinks("|Htrade:x:1:2|h[Not a craft]|h")).toEqual([]);
    expect(parseProfessionLinks("I need [Linen Cloth]")).toEqual([]);
  });
  it("accepts a name-only profession only when it is the message's one bracket", () => {
    expect(parseProfessionLinks("[Alchimie]")).toEqual([{ profession: "Alchemy", verified: false }]);
    expect(parseProfessionLinks("[Tailoring] for [Linen Cloth]")).toEqual([]);
  });
  it("knows the linker by the relay's author name or a leading 'Name: '", () => {
    expect(linkerNames("Lebowski Holyroller", RAW)).toEqual(["Lebowski Holyroller"]);
    expect(linkerNames(null, `[Ann Smith]: ${RAW}`)).toEqual(["Ann Smith"]);
    expect(linkerNames("x", `${RAW} see: here`)).toEqual([]); // "x" too short; the colon comes after the link
  });
});

const people = [
  { name: "Lebowski", displayName: "Lebowski Holyroller", member: { discordUserId: "u1" }, professions: [{ profession: "Tailoring", skillLevel: 150 }] },
  { name: "Ann Smith", displayName: null, member: { discordUserId: "u2" }, professions: [] }
];
const rows = [
  { character: "Lebowski", itemKey: 2580, itemName: "Brown Linen Shirt" },
  { character: "Lebowski Holyroller", itemKey: 2580, itemName: "Brown Linen Shirt" },
  { character: "Lebowski", itemKey: 4245, itemName: "Small Silk Pack" },
  ...Array.from({ length: 9 }, (_, index) => ({ character: "Lebowski", itemKey: 100 + index, itemName: `Cloth ${index}` })),
  { character: "Ann Smith", itemKey: 7026, itemName: "Linen Belt" }
];
const db = (over: { people?: typeof people } = {}) => ({
  character: { findMany: vi.fn(async () => over.people ?? people) },
  recipeKnown: { findMany: vi.fn(async () => rows) }
});
const guild = { id: "g1", gameEdition: "forever" };

describe("profession card", () => {
  it("finds the one character by full or stored name, with skill and de-duplicated recipes", async () => {
    const card = await loadProfessionCard(db() as never, guild, "Tailoring", ["lebowski holyroller"]);
    expect(card).toMatchObject({ character: "Lebowski Holyroller", storedName: "Lebowski", skill: 150 });
    expect(card?.recipes.filter(recipe => recipe.itemKey === 2580)).toHaveLength(1);
    expect(card?.recipes).toHaveLength(11);
  });
  it("posts nothing for an unknown linker, an ambiguous one, or no recipes", async () => {
    expect(await loadProfessionCard(db() as never, guild, "Tailoring", ["Stranger"])).toBeNull();
    const twins = [people[0]!, { ...people[0]!, member: { discordUserId: "u9" } }];
    expect(await loadProfessionCard(db({ people: twins }) as never, guild, "Tailoring", ["Lebowski"])).toBeNull();
    expect(await loadProfessionCard({ ...db(), recipeKnown: { findMany: async () => [] } } as never, guild, "Tailoring", ["Lebowski"])).toBeNull();
  });
  it("matches a real Discord member through their own characters only when exactly one knows the profession", async () => {
    expect((await loadProfessionCard(db() as never, guild, "Tailoring", ["Some Nickname"], "u1"))?.character).toBe("Lebowski Holyroller");
    expect(await loadProfessionCard(db() as never, guild, "Tailoring", ["Some Nickname"], "u3")).toBeNull();
  });
  it("shows the best-quality recipes first, a count, '+N more' and the full-list link", async () => {
    const card = (await loadProfessionCard(db() as never, guild, "Tailoring", ["Lebowski"]))!;
    await addCardQualities(card, { lookup: async item => item.itemId === 4245 ? { name: "Small Silk Pack", quality: 2 } : null });
    const embed = professionCardEmbed(card, "en", "https://guilded.example");
    expect(embed.title).toBe("🧵 Tailoring · Lebowski Holyroller");
    const lines = (embed.description ?? "").split("\n");
    expect(lines[0]).toContain("150 · 11 known recipe(s)");
    expect(lines[1]).toBe("🟩 [Small Silk Pack](https://www.wowhead.com/classic/item=4245)");
    expect(embed.description).toContain("+3 more");
    expect(embed.url).toBe("https://guilded.example/me/artisans?guild=g1&edition=forever&q=Lebowski&lang=en");
    expect(embed.color).toBe(0x1eff00);
    expect(professionCardEmbed(card, "fr").title).toBe("🧵 Couture · Lebowski Holyroller");
  });
});

describe("preview handler with profession links", () => {
  const secret = "s".repeat(40);
  const deps = (over: Partial<PreviewDeps> = {}): PreviewDeps => ({
    loadConfig: async () => ({ discordGuildId: "d1", channelId: "c1", webhookId: "w1", webhookSealed: sealSecret(secret, "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789"), enabled: true }),
    disable: vi.fn(async () => {}), secret, botUserId: "bot", fetch: vi.fn(async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ id: "m1" }) })) as never,
    provider: nullItemDataProvider, gate: new PreviewGate(() => 0), backoff: new Map(), now: () => 0, ...over
  });
  const relay = (content: string) => ({ guildId: "d1", channelId: "c1", content, authorId: "relay", webhookId: "blizz", authorName: "Lebowski Holyroller" });

  it("posts the card through the same webhook, with no item lookup for [Tailoring]", async () => {
    const card = vi.fn(async () => ({ title: "card", color: 1 }));
    const lookup = vi.fn(async () => null);
    const d = deps({ professionCard: card, provider: { lookup } });
    expect(await handlePreviewMessage(d, relay(RAW))).toBe("posted");
    expect(card).toHaveBeenCalledWith("d1", "Tailoring", ["Lebowski Holyroller"], undefined);
    expect(lookup).not.toHaveBeenCalled();
    const body = JSON.parse(String((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body));
    expect(body.embeds).toEqual([{ title: "card", color: 1 }]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });
  it("posts nothing when there is no card, and keeps the duplicate window", async () => {
    const none = deps({ professionCard: async () => null });
    expect(await handlePreviewMessage(none, relay(RAW))).toBe("no-items");
    expect(none.fetch).not.toHaveBeenCalled();
    const once = deps({ professionCard: async () => ({ title: "card", color: 1 }) });
    expect(await handlePreviewMessage(once, relay(RAW))).toBe("posted");
    expect(await handlePreviewMessage(once, relay(RAW))).toBe("throttled");
  });
  it("ignores profession links when the card source is not wired", async () => {
    expect(await handlePreviewMessage(deps(), relay(RAW))).toBe("no-items");
  });
});
