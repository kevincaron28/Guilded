import { describe, expect, it, vi } from "vitest";
import { CallSpacer, createBlizzardItemProvider, itemProviderFromEnv, parseBlizzardItem, withDeadline } from "../src/services/blizzard-items.js";
import { nullItemDataProvider } from "../src/services/item-preview-data.js";
import { buildItemEmbed } from "../src/services/item-preview-embed.js";
import { itemDetailLines, itemDetails } from "../src/services/item-details.js";

const thunderfury = {
  id: 19019,
  name: { en_US: "Thunderfury, Blessed Blade of the Windseeker", fr_FR: "Lame-tonnerre, lame bénie du Cherchevent" },
  quality: { type: "LEGENDARY", name: { en_US: "Legendary" } },
  level: 80, required_level: 60,
  item_subclass: { name: { en_US: "Sword", fr_FR: "Épée" } },
  inventory_type: { type: "WEAPON", name: { en_US: "One-Hand", fr_FR: "À une main" } },
  preview_item: {
    weapon: { damage: { display_string: { en_US: "44 - 115 Damage", fr_FR: "Dégâts : 44 - 115" } } },
    stats: [{ display: { display_string: { en_US: "+5 Agility", fr_FR: "+5 Agilité" } } }, { display: { display_string: { en_US: "+8 Stamina", fr_FR: "+8 Endurance" } } }]
  }
};
const media = { assets: [{ key: "icon", value: "https://render.worldofwarcraft.com/us/icons/56/inv_sword_39.jpg" }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Battle.net: a token endpoint and a route table keyed by "path?namespace". */
function fakeBlizzard(routes: Record<string, unknown>, options: { tokenStatus?: number } = {}) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth.battle.net/token") {
      calls.push("token");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toBe("grant_type=client_credentials");
      return options.tokenStatus ? json({}, options.tokenStatus) : json({ access_token: "tok", expires_in: 86399 });
    }
    const parsed = new URL(url);
    expect(parsed.host).toBe("us.api.blizzard.com");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
    const search = [...parsed.searchParams].filter(([key]) => key.startsWith("name.")).map(([key, value]) => `&${key}=${value}`).join("");
    const key = `${parsed.pathname}?${parsed.searchParams.get("namespace")}${search}`;
    calls.push(key);
    return key in routes ? json(routes[key]) : json({ code: 404 }, 404);
  });
  return { fetch, calls };
}
const provider = (fetch: ReturnType<typeof fakeBlizzard>["fetch"], now = () => 0) =>
  createBlizzardItemProvider({ clientId: "id", clientSecret: "secret", fetch, now, minIntervalMs: 0, sleep: async () => {} });

describe("Blizzard item data", () => {
  it("parses quality, a one-line summary and the French name from one all-locales answer", () => {
    const details = parseBlizzardItem(thunderfury, "forever")!;
    expect(details).toMatchObject({ itemId: 19019, quality: 5, source: "forever", url: "https://www.wowhead.com/classic/item=19019" });
    expect(details.summary).toBe("One-Hand · Sword · 44 - 115 Damage · +5 Agility · +8 Stamina · item level 80 · requires level 60");
    expect(details.fr?.name).toBe("Lame-tonnerre, lame bénie du Cherchevent");
    expect(details.fr?.summary).toContain("+5 Agilité");
    expect(parseBlizzardItem({ id: "x" }, "forever")).toBeNull();
  });

  it("looks an id up in Forever first, with its icon, and caches it (one token for everything)", async () => {
    const fake = fakeBlizzard({ "/data/wow/item/19019?static-forever-us": thunderfury, "/data/wow/media/item/19019?static-forever-us": media });
    const items = provider(fake.fetch);
    const found = await items.lookup({ itemId: 19019, name: "Thunderfury", verified: true });
    expect(found).toMatchObject({ name: "Thunderfury, Blessed Blade of the Windseeker", source: "forever", matchedBy: "id", iconUrl: media.assets[0]!.value });
    await items.lookup({ itemId: 19019, name: "Thunderfury", verified: true });
    expect(fake.calls).toEqual(["token", "/data/wow/item/19019?static-forever-us", "/data/wow/media/item/19019?static-forever-us"]);
  });

  it("falls back to Classic Era for ids Forever does not know, and says so", async () => {
    const fake = fakeBlizzard({ "/data/wow/item/6340?static-classic1x-us": { id: 6340, name: { en_US: "Fenrus' Hide" }, quality: { type: "RARE" } } });
    const found = await provider(fake.fetch).byId(6340);
    expect(found).toMatchObject({ source: "classic1x", quality: 3 });
    expect(fake.calls).toContain("/data/wow/item/6340?static-forever-us");
    expect(buildItemEmbed({ itemId: 6340, name: "Fenrus' Hide", verified: true }, found).description).toContain("Classic Era data");
    expect(itemDetailLines(await itemDetails(6340, "x", provider(fake.fetch), "fr"), "fr").join(" ")).toContain("Classic Era");
  });

  it("finds a name-only link only when exactly one item has that exact name", async () => {
    const one = fakeBlizzard({
      "/data/wow/search/item?static-forever-us&name.en_US=linen cloth": { results: [{ data: { id: 2589, name: { en_US: "Linen Cloth" } } }, { data: { id: 9999, name: { en_US: "Linen Cloth Bandage" } } }] },
      "/data/wow/item/2589?static-forever-us": { id: 2589, name: { en_US: "Linen Cloth", fr_FR: "Étoffe de lin" }, quality: { type: "COMMON" } }
    });
    const found = await provider(one.fetch).lookup({ itemId: null, name: "linen cloth", verified: false });
    expect(found).toMatchObject({ itemId: 2589, matchedBy: "name" });
    const embed = buildItemEmbed({ itemId: null, name: "linen cloth", verified: false }, found);
    expect(embed.description).toContain("matched by its exact name");
    expect(embed.url).toBe("https://www.wowhead.com/classic/item=2589");

    const two = fakeBlizzard({ "/data/wow/search/item?static-forever-us&name.en_US=Monster - Sword": { results: [{ data: { id: 1, name: { en_US: "Monster - Sword" } } }, { data: { id: 2, name: { en_US: "Monster - Sword" } } }] } });
    expect(await provider(two.fetch).byName("Monster - Sword")).toBeNull();
    expect(two.calls.some(call => call.startsWith("/data/wow/item/"))).toBe(false); // never guessed
  });

  it("finds a French name through the French search", async () => {
    const fake = fakeBlizzard({
      "/data/wow/search/item?static-forever-us&name.fr_FR=Étoffe de lin": { results: [{ data: { id: 2589, name: { en_US: "Linen Cloth", fr_FR: "Étoffe de lin" } } }] },
      "/data/wow/item/2589?static-forever-us": { id: 2589, name: { en_US: "Linen Cloth", fr_FR: "Étoffe de lin" } }
    });
    const found = await provider(fake.fetch).byName("Étoffe de lin");
    expect(found?.itemId).toBe(2589);
    expect(buildItemEmbed({ itemId: null, name: "Étoffe de lin", verified: false }, found, "fr").title).toBe("Étoffe de lin");
  });

  it("ignores a provider's stats for an unverified link it did not match by name", () => {
    const embed = buildItemEmbed({ itemId: null, name: "Dagger", verified: false }, { name: "Dagger", quality: 4, summary: "Epic", iconUrl: "https://x/y.png" });
    expect(embed.description).toContain("Unverified");
    expect(embed.thumbnail).toBeUndefined();
  });

  it("fails quietly: a bad secret backs off instead of retrying every message", async () => {
    let now = 0;
    const fake = fakeBlizzard({}, { tokenStatus: 401 });
    const items = provider(fake.fetch, () => now);
    expect(await items.byId(19019)).toBeNull();
    expect(await items.byId(2589)).toBeNull();
    expect(fake.calls).toEqual(["token"]);
    now = 400_000;
    await items.byId(777);
    expect(fake.calls).toEqual(["token", "token"]);
  });

  it("renews the token once on a 401 and treats server errors as a short miss", async () => {
    let first = true;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("oauth")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/item/5")) { if (first) { first = false; return json({}, 401); } return json({ id: 5, name: "Five" }); }
      return json({}, 503);
    });
    const items = provider(fetch);
    expect((await items.byId(5))?.name).toBe("Five");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth"))).toHaveLength(2);
    expect(await items.byId(6)).toBeNull();
  });

  it("shares one request between simultaneous lookups of the same item", async () => {
    const fake = fakeBlizzard({ "/data/wow/item/19019?static-forever-us": thunderfury });
    const items = provider(fake.fetch);
    await Promise.all([items.byId(19019), items.byId(19019), items.byId(19019)]);
    expect(fake.calls.filter(call => call === "/data/wow/item/19019?static-forever-us")).toHaveLength(1);
  });

  it("spaces calls and stops at the hourly budget", async () => {
    let now = 0;
    const waits: number[] = [];
    const spacer = new CallSpacer(() => now, async ms => { waits.push(ms); }, 50, 3);
    expect(await spacer.take()).toBe(true);
    expect(await spacer.take()).toBe(true);
    expect(await spacer.take()).toBe(true);
    expect(waits).toEqual([50, 100]);
    expect(await spacer.take()).toBe(false);
    now = 3_600_200;
    expect(await spacer.take()).toBe(true);
  });

  it("is the null provider without credentials, and a deadline answers null without waiting", async () => {
    expect(itemProviderFromEnv({})).toBe(nullItemDataProvider);
    expect(itemProviderFromEnv({ BATTLENET_CLIENT_ID: "a" })).toBe(nullItemDataProvider);
    const slow = { lookup: () => new Promise<null>(resolve => setTimeout(() => resolve(null), 1000)) };
    vi.useFakeTimers();
    const pending = withDeadline(slow, 10).lookup({ itemId: 1, name: "A", verified: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toBeNull();
    vi.useRealTimers();
  });

  it("puts French names and summaries in the French Details view", async () => {
    const fake = fakeBlizzard({ "/data/wow/item/19019?static-forever-us": thunderfury });
    const view = await itemDetails(19019, "Thunderfury", provider(fake.fetch), "fr");
    expect(view.name).toBe("Lame-tonnerre, lame bénie du Cherchevent");
    expect(itemDetailLines(view, "fr")).toContain("Légendaire");
    expect(view.hasStats).toBe(true);
  });
});
