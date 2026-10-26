import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { prismaAvailabilityStore, type AvailabilityStore } from "../src/services/web-availability-store.js";
import { createWebAvailability } from "../src/services/web-availability.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const now = new Date("2026-10-26T12:00:00Z");
const guild = { id: "g", name: "Guild <test>", edition: "forever" };
const character = { id: "c", name: "arden", displayName: "Arden River", realm: "Forever", memberId: "m" };
function fixture() {
  const db = { character: { findMany: vi.fn(async () => [character]), findFirst: vi.fn(async () => ({ memberId: "m" })) },
    webAvailability: { findMany: vi.fn(async () => [{ memberId: "m", role: "HEALER", expiresAt: new Date(now.getTime() + 60_000), character }]),
      upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async fn => fn(db)) };
  const access = { authorize: vi.fn(async (): Promise<typeof guild | null> => guild), guilds: vi.fn(async () => [guild]) };
  return { db, access, store: prismaAvailabilityStore(db as unknown as PrismaClient, access) };
}
it("scopes reads to active edition members, expiry and unchanged ownership, preserving Forever full names", async () => {
  const { db, store } = fixture();
  const result = await store.load("u", "g", now);
  expect(result?.rows[0]?.character.name).toBe("Arden River");
  expect(result?.rows[0]?.mine).toBe(true);
  expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g", gameEdition: "forever", member: { guildId: "g", status: "ACTIVE", isTest: false, discordUserId: "u" } } }));
  expect(db.webAvailability.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "g", gameEdition: "forever", expiresAt: { gt: now }, member: { guildId: "g", status: "ACTIVE", isTest: false }, character: expect.objectContaining({ guildId: "g", gameEdition: "forever" }) }), take: 101 }));
  db.webAvailability.findMany.mockResolvedValue([{ memberId: "someone-else", role: "TANK", expiresAt: now, character }]);
  expect((await store.load("u", "g", now))?.rows).toEqual([]);
});
it("only shares an owned linked character after fresh access and rejects unsupported roles/durations", async () => {
  const { db, store, access } = fixture();
  await store.share("u", "g", "c", "TANK", 15, now);
  expect(db.character.findFirst).toHaveBeenCalledWith({ where: { id: "c", guildId: "g", gameEdition: "forever", member: { guildId: "g", discordUserId: "u", status: "ACTIVE", isTest: false } }, select: { memberId: true } });
  expect(db.webAvailability.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "m" }, update: { characterId: "c", guildId: "g", gameEdition: "forever", role: "TANK", expiresAt: new Date("2026-10-26T12:15:00Z") } }));
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  await expect(store.share("u", "g", "c", "ONLINE", 15, now)).rejects.toThrow();
  await expect(store.share("u", "g", "c", "ANY", 1440, now)).rejects.toThrow();
  db.webAvailability.upsert.mockClear();
  db.character.findFirst.mockResolvedValue(null as never);
  await expect(store.share("u", "g", "other", "ANY", 15, now)).rejects.toThrow("ownership");
  access.authorize.mockResolvedValue(null);
  await expect(store.share("u", "g", "c", "ANY", 15, now)).rejects.toThrow("Access");
  expect(await store.load("u", "g", now)).toBeNull();
  expect(db.webAvailability.upsert).not.toHaveBeenCalled();
  access.authorize.mockClear();
  await store.revoke("u", "g");
  expect(db.webAvailability.deleteMany).toHaveBeenCalledWith({ where: { guildId: "g", member: { guildId: "g", discordUserId: "u" } } });
  expect(access.authorize).not.toHaveBeenCalled(); // removal survives lost Discord access
});

async function appFixture() {
  const store: AvailabilityStore = { guilds: vi.fn(async () => [guild]), load: vi.fn(async () => ({ guild, characters: [{ id: "c", name: "Arden River", realm: "Forever" }], rows: [], truncated: false })), share: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "u", username: "Tester", displayName: "Tester" }, now);
  await memory.createSession(account.id, hashToken("session"), new Date(now.getTime() + 60_000));
  const secret = "s".repeat(40), feature = createWebAvailability(store);
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => now, routes: [feature.route], meSections: [feature.meSection] });
  const request = async (path: string, body?: URLSearchParams, signedIn = true, origin = "https://guilded.kcaron.top") => {
    const url = new URL(path, origin);
    return await app.respond({ method: body ? "POST" : "GET", path: url.pathname, query: url.searchParams, ...(body ? { body: body.toString() } : {}), headers: { ...(signedIn ? { cookie: `${SESSION_COOKIE}=${sign(secret, "session")}` } : {}), origin, "content-type": "application/x-www-form-urlencoded" } }) as WebResponse;
  };
  return { store, request };
}
it("requires sign-in, CSRF, explicit consent and same-origin; then redirects without a repost", async () => {
  const { store, request } = await appFixture();
  const url = "/me/availability?guild=g&edition=retail";
  expect((await request(url, undefined, false)).status).toBe(401);
  expect(store.load).not.toHaveBeenCalled();
  const page = await request(url);
  expect(page.body).toContain("Arden River");
  expect(page.body).toContain("Guild &lt;test&gt;");
  expect(page.body).toContain("never uploaded here");
  expect(page.body).not.toContain('value="yes" checked');
  const form = new URLSearchParams({ intent: "share", character: "c", role: "ANY", minutes: "15", consent: "yes" });
  expect((await request(url, form)).status).toBe(403);
  form.set("csrf", page.body.match(/name="csrf" value="([^"]+)"/)![1]!);
  expect((await request(url, form, true, "https://evil.example")).status).toBe(403);
  form.delete("consent");
  expect((await request(url, form)).status).toBe(400);
  expect(store.share).not.toHaveBeenCalled();
  form.set("consent", "yes");
  expect((await request(url, form)).status).toBe(303);
  expect(store.share).toHaveBeenCalledWith("u", "g", "c", "ANY", 15, now);
  vi.mocked(store.load).mockResolvedValue(null);
  expect((await request(url)).body).toContain("Stop sharing");
  form.set("intent", "revoke");
  expect((await request(url, form)).status).toBe(200);
  expect(store.revoke).toHaveBeenCalledWith("u", "g");
});
