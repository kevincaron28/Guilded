import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ManageError } from "../src/services/companion-manage.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { createWebLootLists, prismaLootListStore, type LootListStore, type ReservesView, type WishlistView } from "../src/services/web-loot-lists.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const now = new Date("2026-11-07T12:00:00Z");
const guild = { id: "g", name: "Guild <test>", edition: "forever" };
const reserves: ReservesView = {
  guild, list: { active: true, open: true, title: "Molten Core", perPlayer: 2, keeper: "Kev", syncedAt: "2026-11-07T10:00:00.000Z" },
  items: [{ itemId: 1, itemName: "Onslaught Girdle", characters: ["Arden River", "Zed"], mine: true }, { itemId: 2, itemName: "<b>Bad</b>", characters: ["Zed"], mine: false }],
  mineCount: 1, cores: [{ id: "c1", name: "Main", lootMode: "RESERVE", reservesPerPlayer: 2 }]
};
const wishlist: WishlistView = { guild, itemNames: ["Onslaught Girdle"],
  characters: [{ id: "ch1", name: "arden", displayName: "Arden River", realm: "Forever", className: "Warrior", isMain: true, wishlist: [{ itemName: "Onslaught Girdle", priority: 1 }] }] };

async function appFixture(guilds = [guild]) {
  const store: LootListStore = { guilds: vi.fn(async () => guilds), reserves: vi.fn(async () => reserves), wishlist: vi.fn(async () => wishlist),
    setWish: vi.fn(async () => true), removeWish: vi.fn(async () => true) };
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "u", username: "Tester", displayName: "Tester" }, now);
  await memory.createSession(account.id, hashToken("session"), new Date(now.getTime() + 60_000));
  const secret = "s".repeat(40), feature = createWebLootLists(store);
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => now, routes: [feature.route] });
  const request = async (path: string, body?: URLSearchParams, signedIn = true, origin = "https://guilded.kcaron.top") => {
    const url = new URL(path, origin);
    return await app.respond({ method: body ? "POST" : "GET", path: url.pathname, query: url.searchParams, ...(body ? { body: body.toString() } : {}), headers: { ...(signedIn ? { cookie: `${SESSION_COOKIE}=${sign(secret, "session")}` } : {}), origin, "content-type": "application/x-www-form-urlencoded" } }) as WebResponse;
  };
  return { store, request, feature };
}

it("shows the soft-reserve list read-only, marks my reserves and says where to reserve", async () => {
  const { store, request } = await appFixture();
  expect((await request("/me/reserves", undefined, false)).status).toBe(401);
  const page = await request("/me/reserves?lang=fr");
  expect(page.status).toBe(200);
  expect(store.reserves).toHaveBeenCalledWith("u", "g");
  expect(page.body).toContain("Molten Core");
  expect(page.body).toContain("Vos réserves : 1 sur 2");
  expect(page.body).toContain("Où réserver");
  expect(page.body).toContain("&lt;b&gt;Bad&lt;/b&gt;");
  expect(page.body).toContain('class="mine"');
  expect(page.body).not.toContain("<form method=\"post\" action=\"/me/reserves");
  expect([403, 405]).toContain((await request("/me/reserves", new URLSearchParams({ x: "1" }))).status);
  vi.mocked(store.reserves).mockResolvedValue(null);
  expect((await request("/me/reserves?guild=other")).status).toBe(403);
});

it("lets a member choose among several guilds", async () => {
  const { store, request } = await appFixture([guild, { id: "g2", name: "Vanguard", edition: "forever" }]);
  const page = await request("/me/wishlist");
  expect(page.body).toContain("Vanguard");
  expect(store.wishlist).not.toHaveBeenCalled();
});

it("edits the wishlist with CSRF and same origin, then redirects", async () => {
  const { store, request } = await appFixture();
  const url = "/me/wishlist?guild=g&edition=forever";
  const page = await request(url);
  expect(page.body).toContain("Arden River");
  expect(page.body).toContain('<option value="1" selected>High</option>');
  expect(page.body).toContain('<datalist id="wish-items"><option value="Onslaught Girdle">');
  const form = new URLSearchParams({ intent: "set", character: "ch1", item: "Eye of Sulfuras", priority: "2" });
  expect((await request(url, form)).status).toBe(403);
  form.set("csrf", page.body.match(/name="csrf" value="([^"]+)"/)![1]!);
  expect((await request(url, form, true, "https://evil.example")).status).toBe(403);
  expect(store.setWish).not.toHaveBeenCalled();
  form.set("priority", "9");
  expect((await request(url, form)).status).toBe(400);
  form.set("priority", "2");
  const saved = await request(url, form);
  expect(saved.status).toBe(303);
  expect(store.setWish).toHaveBeenCalledWith("u", "g", "ch1", "Eye of Sulfuras", 2);
  form.set("intent", "remove");
  expect((await request(url, form)).status).toBe(303);
  expect(store.removeWish).toHaveBeenCalledWith("u", "g", "ch1", "Eye of Sulfuras");
  vi.mocked(store.setWish).mockRejectedValue(new ManageError("That character is not linked to your profile.", 403));
  form.set("intent", "set");
  const refused = await request(`${url}&lang=fr`, form);
  expect(refused.status).toBe(400);
  expect(refused.body).toContain("Ce personnage n&#39;est pas lié à votre profil.");
});

it("only reads and writes through a live membership and the companion's own-character check", async () => {
  const access = { authorize: vi.fn(async (): Promise<typeof guild | null> => guild), guilds: vi.fn(async () => [guild]) };
  const db = {
    member: { findFirst: vi.fn(async () => ({ id: "m" })) },
    character: { findMany: vi.fn(async () => wishlist.characters), findFirst: vi.fn(async () => null) },
    wishlistEntry: { findMany: vi.fn(async () => [{ itemName: "Item 123" }, { itemName: "Onslaught Girdle" }]) },
    coreItemValue: { findMany: vi.fn(async () => []) }
  };
  const store = prismaLootListStore(db as unknown as PrismaClient, access as never);
  const view = await store.wishlist("u", "g");
  expect(view?.itemNames).toEqual(["Onslaught Girdle"]);
  expect(db.member.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g", discordUserId: "u", status: "ACTIVE", isTest: false } }));
  expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "m" } }));
  // Someone else's character: refused by companion-manage's ownership check.
  await expect(store.setWish("u", "g", "not-mine", "Eye of Sulfuras", 1)).rejects.toThrow("not linked to your profile");
  access.authorize.mockResolvedValue(null);
  expect(await store.wishlist("u", "g")).toBeNull();
  expect(await store.setWish("u", "g", "ch1", "Eye", 1)).toBe(false);
});
