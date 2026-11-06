import { describe, expect, it, vi } from "vitest";
import { createArtisansGallery, loadGallery } from "../src/services/artisans-gallery.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";
import { layout } from "../src/services/web-layout.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const people = [
  { name: "Ann", lastSeenAt: ago(0.1), member: { displayName: "Annie" } },
  { name: "Bob", lastSeenAt: ago(30), member: { displayName: "Robert" } }
];
const recipeRows = [
  { character: "Bob", profession: "Alchemy", itemKey: 7, itemName: "Elixir <of> Power", scannedAt: ago(30) },
  { character: "Ann", profession: "Alchemy", itemKey: 7, itemName: "Elixir <of> Power", scannedAt: ago(2) },
  { character: "Ann", profession: "Alchemy", itemKey: 8, itemName: "Rare Potion", scannedAt: ago(2) }
];
const db = {
  character: { findMany: async () => people },
  professionSkill: { findMany: async () => [
    { profession: "Alchemy", skillLevel: 300, character: { name: "Ann" } }, { profession: "Alchemy", skillLevel: 225, character: { name: "Bob" } }] },
  recipeKnown: { findMany: vi.fn(async () => recipeRows) },
  professionCooldown: { findMany: async () => [{ character: "Ann", name: "Transmute" }] },
  craftOffer: { findMany: async () => [{ id: "o1", itemKey: 7, item: "Elixir <of> Power", price: "tips", verified: true, expiresAt: ago(-3), crafter: { displayName: "Annie" } }] },
  member: { findFirst: async () => ({ id: "m1" }) },
  craftRequest: { count: async () => 0, create: vi.fn(async ({ data }: { data: object }) => ({ id: "req1", ...data })) }
};

describe("Artisans' Gallery data", () => {
  it("finds every crafter of an item, recently seen first, with skill, offers and cards", async () => {
    const data = await loadGallery(db as never, "g1", "elixir", NOW);
    expect(data.recipes).toHaveLength(2);
    const elixir = data.recipes.find(recipe => recipe.itemKey === 7)!;
    expect(elixir.crafters.map(crafter => [crafter.character, crafter.skill])).toEqual([["Ann", 300], ["Bob", 225]]);
    expect(elixir.crafters[0]?.lastSeen).toEqual(ago(0.1));
    expect(elixir.offers).toEqual([expect.objectContaining({ crafter: "Annie", price: "tips" })]);
    const ann = data.crafters.find(card => card.character === "Ann")!;
    expect(ann.cooldownsReady).toEqual(["Transmute"]);
    expect(ann.notable[0]).toBe("Rare Potion");
  });
});

describe("Artisans' Gallery page", () => {
  const access = { guilds: vi.fn(async () => [{ id: "g1", name: "Guild", edition: "forever" }]), authorize: vi.fn(async (_user: string, id: string) => id === "g1" ? { id: "g1", name: "Guild", edition: "forever" } : null) };
  const post = vi.fn(async () => true);
  const gallery = createArtisansGallery({ db: db as never, access: access as never, post });
  const run = async (target: string, method = "GET", form: Record<string, string> | null = null, signedIn = true) => {
    const url = new URL(target, "https://guilded.kcaron.top");
    const ctx: WebContext = { request: { path: url.pathname, method, query: url.searchParams, headers: {} }, lang: "en", t: (en) => en, now: NOW,
      account: signedIn ? { id: "a1", discordUserId: "u1", username: "u", displayName: "U" } as never : null, sessionToken: "s", csrf: "tok", form: form ? new URLSearchParams(form) : null, auth: null };
    const kit: WebKit = {
      page: (status, title, body) => ({ status, body: layout({ lang: "en", title, body, path: url.pathname, account: ctx.account, csrf: null, signInOn: false }), headers: {} }),
      redirect: location => ({ status: 303, headers: { location }, body: "" }),
      signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" })
    };
    return (await gallery.route(ctx, kit))!;
  };

  it("needs a sign-in and membership, and escapes item names", async () => {
    expect((await run("/me/artisans", "GET", null, false)).status).toBe(401);
    expect((await run("/me/artisans?guild=other")).status).toBe(403);
    const page = await run("/me/artisans?guild=g1&q=elixir");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Elixir &lt;of&gt; Power");
    expect(page.body).not.toContain("Elixir <of> Power");
    expect(page.body).toContain("Request this craft");
    expect(page.body).toContain("reagent");
  });
  it("shows each recipe as one compact line with the crafters and the request form behind Details", async () => {
    const page = await run("/me/artisans?guild=g1&q=elixir");
    const lines = page.body.match(/<details class="card recipe-line"><summary>[\s\S]*?<\/summary>/g) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain("Details");
      expect(line).not.toContain("<table");
      expect(line).not.toContain("<form");
    }
    expect(page.body).toMatch(/<details[^>]*><summary>[\s\S]*?<table[\s\S]*?<form[\s\S]*?<\/details>/);
    expect(page.body).not.toContain("<details open");
  });
  it("turns a Request into the ordinary craft request and posts it to the board", async () => {
    const response = await run("/me/artisans", "POST", { guild: "g1", item: "Elixir <of> Power", profession: "Alchemy", quantity: "2", csrf: "tok" });
    expect(response.status).toBe(303);
    expect(response.headers["location"]).toContain("requested=posted");
    expect(db.craftRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ guildId: "g1", requesterId: "m1", item: "Elixir <of> Power", quantity: 2, profession: "Alchemy" }) });
    expect(post).toHaveBeenCalledWith("g1", "req1", undefined);
  });
  it("asks one crafter: Request on a crafter row carries the crafter, so the post pings them once", async () => {
    post.mockClear();
    const page = await run("/me/artisans?guild=g1&q=elixir");
    expect(page.body).toContain('name="crafter" value="Ann"');
    const response = await run("/me/artisans", "POST", { guild: "g1", item: "Elixir <of> Power", profession: "Alchemy", quantity: "1", crafter: "Ann", csrf: "tok" });
    expect(response.status).toBe(303);
    expect(post).toHaveBeenCalledWith("g1", "req1", "Ann");
  });
  it("offers Details for each item: the id, a link and an honest note when no item source is connected", async () => {
    const page = await run("/me/artisans?guild=g1&q=elixir");
    expect(page.body).toContain("<summary>Details</summary>");
    expect(page.body).toContain("Item ID 7");
    expect(page.body).toContain("https://www.wowhead.com/classic/item=7");
    expect(page.body).toContain("▰");
  });
  it("shows a clear error and sends nothing when the request is invalid", async () => {
    const response = await run("/me/artisans", "POST", { guild: "g1", item: "x", quantity: "1", csrf: "tok" });
    expect(response.status).toBe(400);
    expect(response.body).toContain("Name the item you want crafted.");
  });
});
