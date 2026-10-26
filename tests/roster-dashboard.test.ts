import { describe, expect, it, vi } from "vitest";
import { Collection, type Client } from "discord.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createRosterDashboard, filterRoster, rosterCounts, rosterCsv, rosterFilters } from "../src/services/roster-dashboard.js";
import { prismaRosterDashboardStore, rosterProfessions, type RosterCharacter, type RosterDashboardStore } from "../src/services/roster-dashboard-store.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-10-25T18:00:00Z");
const character = (fields: Partial<RosterCharacter> = {}): RosterCharacter => ({ key: "one", name: "Élodie Dawn", realm: "Forever", className: "Mage", race: "Human", level: 60, memberId: "member1", isMain: true, professions: ["Alchemy", "Tailoring"], refreshedAt: NOW, ...fields });
const sample = [character(), character({ key: "two", name: "Alt Dawn", isMain: false, level: 20, className: "Priest", professions: [] }), character({ key: "three", name: "Unclaimed", memberId: null, isMain: null, level: null, race: null, professions: [] })];

async function setup(rows = sample) {
  const store: RosterDashboardStore = {
    guilds: vi.fn(async () => [{ id: "guild1", name: "Test guild", edition: "forever" }, { id: "guild2", name: "Test Retail", edition: "retail" }]),
    load: vi.fn(async (_user, id) => id === "guild1" ? { guild: { id, name: "Test guild", edition: "forever" }, characters: rows, truncated: false } : id === "guild2" ? { guild: { id, name: "Test Retail", edition: "retail" }, characters: [character({ name: "RetailOnly", realm: "RealmTwo" })], truncated: false } : null)
  };
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "user1", username: "Tester", displayName: "Tester" }, NOW);
  await memory.createSession(account.id, hashToken("session"), new Date(NOW.getTime() + 60_000));
  const secret = "s".repeat(40);
  const dashboard = createRosterDashboard(store);
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => NOW, routes: [dashboard.route], meSections: [dashboard.meSection] });
  const request = async (target: string, authenticated = true, method = "GET") => {
    const url = new URL(target, "https://guilded.kcaron.top");
    return await app.respond({ method, path: url.pathname, query: url.searchParams, headers: authenticated ? { cookie: `${SESSION_COOKIE}=${sign(secret, "session")}` } : {} }) as WebResponse;
  };
  return { store, request };
}

describe("roster dashboard filtering and export", () => {
  it("counts members once, keeps unclaimed separate, and searches full names and realms without accents", () => {
    expect(rosterCounts(sample)).toEqual({ characters: 3, linkedMembers: 1, unclaimed: 1 });
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("q=elodie+dawn")))).toEqual([sample[0]]);
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("q=forever&kind=alt")))).toEqual([sample[1]]);
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("kind=unclaimed")))).toEqual([sample[2]]);
  });
  it("combines class, profession and level filters without treating unknown levels as zero or unknown mains as alts", () => {
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("class=Mage&profession=Alchemy&min=60&max=60")))).toEqual([sample[0]]);
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("max=25")))).toEqual([sample[1]]);
    expect(filterRoster(sample, rosterFilters(new URLSearchParams("race=__unknown__&profession=__unknown__")))).toEqual([sample[2]]);
    for (const query of ["min=70&max=60", "min=-1", "max=2.5", "kind=officer", `q=${"x".repeat(81)}`]) expect(() => rosterFilters(new URLSearchParams(query))).toThrow();
  });
  it("uses existing CSV formula protection and UTF-8, preserves realm identity and leaves unknown main status empty", () => {
    const csv = rosterCsv([character({ name: '=HYPERLINK("x")' }), sample[2]!]);
    expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.toString()).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv.toString()).toContain("Unclaimed,Forever,Mage,,,unclaimed,,,");
    expect(csv.toString()).not.toContain("member1");
  });
  it("normalizes profession snapshots without trusting malformed JSON", () => {
    expect(rosterProfessions([{ name: " Alchemy " }, { profession: "Alchemy" }, null, { name: 42 }, { name: "Tailoring" }])).toEqual(["Alchemy", "Tailoring"]);
    expect(rosterProfessions({ private: "note" })).toEqual([]);
  });
});

describe("signed-in roster pages", () => {
  it("requires sign-in for page and CSV before loading any roster, and denies an unauthorized guild", async () => {
    const { request, store } = await setup();
    for (const path of ["/me/roster?guild=guild1", "/me/roster/export?guild=guild1"]) expect((await request(path, false)).status).toBe(401);
    expect(store.load).not.toHaveBeenCalled();
    expect((await request("/me/roster?guild=other")).status).toBe(403);
    expect((await request("/me/roster/export?guild=other")).status).toBe(403);
  });
  it("offers scoped guild choices and re-evaluates scope on every request, independent of the edition query", async () => {
    const { request, store } = await setup();
    const index = await request("/me/roster");
    expect(index.body).toContain("guild=guild2&amp;edition=retail");
    expect((await request("/me/")).body).toContain("Open roster dashboard");
    const first = await request("/me/roster?guild=guild1");
    expect(first.body).toContain("Élodie Dawn");
    const second = await request("/me/roster?guild=guild2&edition=forever");
    expect(second.body).toContain("RetailOnly");
    expect(second.body).not.toContain("Élodie Dawn");
    expect(second.body).toContain('name="edition" value="retail"');
    expect(store.load).toHaveBeenLastCalledWith("user1", "guild2");
  });
  it("escapes member-supplied text and offers French labels, privacy headers and honest freshness wording", async () => {
    const { request } = await setup([character({ name: '<script>alert("x")</script>' })]);
    const response = await request("/me/roster?guild=guild1&lang=fr");
    expect(response.status).toBe(200);
    expect(response.body).toContain("Effectif de guilde");
    expect(response.body).toContain("Données actualisées (UTC)");
    expect(response.body).toContain("&lt;script&gt;");
    expect(response.body).not.toContain('<script>alert("x")');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('name="robots" content="noindex');
  });
  it("paginates HTML but exports all matching rows and the same filters, without exposing internal member IDs", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => character({ key: String(i), name: `Person${i}`, className: i === 50 ? "Priest" : "Mage" }));
    const { request } = await setup(rows);
    const first = await request("/me/roster?guild=guild1");
    expect(first.body).toContain("Person49");
    expect(first.body).not.toContain("Person50");
    expect((await request("/me/roster?guild=guild1&page=2")).body).toContain("Person50");
    const page = await request("/me/roster?guild=guild1&class=Priest");
    expect(page.body).toContain("/me/roster/export?");
    expect(page.body).toContain("class=Priest");
    const frenchLink = /href="([^"]+)" hreflang="fr"/.exec(page.body)![1]!.replaceAll("&amp;", "&");
    expect(frenchLink).toContain("guild=guild1");
    expect(frenchLink).toContain("class=Priest");
    const frenchPage = await request(frenchLink);
    expect(frenchPage.body).toContain("Person50");
    expect(frenchPage.body).not.toContain("Person49");
    expect((await request("/me/roster?guild=guild1&profession=MissingProfession")).status).toBe(400);
    const csv = await request("/me/roster/export?guild=guild1&class=Priest");
    expect(csv.binaryBody?.toString()).toContain("Person50");
    expect(csv.binaryBody?.toString()).not.toContain("Person49");
    expect(csv.binaryBody?.toString()).not.toContain("member1");
    expect((await request("/me/roster/export?guild=guild1", true, "HEAD")).binaryBody).toBeUndefined();
  });
  it("shows empty, denied, failed and truncated states without retaining a previous roster or silently exporting a sample", async () => {
    const { request, store } = await setup([]);
    expect((await request("/me/roster?guild=guild1")).body).toContain("No characters match");
    expect((await request("/me/roster?guild=guild1&min=80&max=10")).status).toBe(400);
    vi.mocked(store.load).mockResolvedValue({ guild: { id: "guild1", name: "Test", edition: "forever" }, characters: sample, truncated: true });
    expect((await request("/me/roster?guild=guild1")).body).toContain("Partial snapshot");
    expect((await request("/me/roster/export?guild=guild1")).status).toBe(409);
    vi.mocked(store.load).mockRejectedValue(new Error("private database error"));
    const error = await request("/me/roster?guild=guild1");
    expect(error.status).toBe(503);
    expect(error.body).not.toContain("private database error");
    expect(error.body).not.toContain("Élodie Dawn");
  });
});

describe("roster store authority and isolation", () => {
  function setupStore() {
    const roles = new Collection<string, { id: string; name: string }>([["era-officer", { id: "era-officer", name: "Officer" }], ["member-role", { id: "member-role", name: "Member" }]]);
    const fetchMember = vi.fn(async () => ({ permissions: { has: () => false }, roles: { cache: roles } }));
    const db = {
      member: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "member1" })), findMany: vi.fn(async () => [{ guildId: "era" }, { guildId: "retail" }]) },
      guild: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, discordId: "same-server", name: where.id, scopeKey: where.id, gameEdition: where.id === "era" ? "classic-era" : "retail", wowSpace: { memberRoleId: "member-role", permissionRoles: { officer: `${where.id}-officer` } } })) },
      character: { findMany: vi.fn(async () => [{ name: "Alice", displayName: null, realm: "Realm1", className: "Mage", race: null, level: 60, memberId: "member1", isMain: true, professions: [{ profession: "Alchemy" }], lastSeenAt: NOW }]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [{ name: "Alice", displayName: null, realm: "Realm1", className: "Mage", race: null, level: 20, professions: [], lastSeenAt: NOW }, { name: "Alice", displayName: null, realm: "Realm2", className: "Mage", race: null, level: 20, professions: [], lastSeenAt: NOW }]) }
    };
    const client = { isReady: () => true, guilds: { fetch: vi.fn(async () => ({ members: { fetch: fetchMember } })) } };
    const allows = vi.fn(() => true);
    return { db, roles, fetchMember, allows, store: prismaRosterDashboardStore(db as unknown as PrismaClient, client as unknown as Client, allows) };
  }
  it("does not grant another edition's officer access based on a shared Discord role name", async () => {
    const { store, db, fetchMember } = setupStore();
    expect((await store.guilds("user1")).map(guild => guild.id)).toEqual(["era"]);
    expect(await store.load("user1", "retail")).toBeNull();
    expect(db.character.findMany).not.toHaveBeenCalled();
    expect(fetchMember).toHaveBeenCalledWith({ user: "user1", force: true });
  });
  it("scopes both queries to the authorized guild/edition and deduplicates discoveries without merging realms", async () => {
    const { store, db } = setupStore();
    const snapshot = await store.load("user1", "era");
    expect(snapshot?.characters).toHaveLength(2);
    expect(snapshot?.characters.find(row => row.realm === "Realm1")?.isMain).toBe(true);
    expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "era", gameEdition: "classic-era", member: { guildId: "era", status: "ACTIVE", isTest: false } }, take: 1001 }));
    expect(db.unclaimedCharacter.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "era", gameEdition: "classic-era" }, take: 1001 }));
  });
  it("rechecks demotion, membership and hosted eligibility before querying character data", async () => {
    const { store, db, roles, allows } = setupStore();
    expect(await store.load("user1", "era")).not.toBeNull();
    db.character.findMany.mockClear();
    roles.delete("era-officer");
    expect(await store.load("user1", "era")).toBeNull();
    roles.set("era-officer", { id: "era-officer", name: "Officer" });
    roles.delete("member-role");
    expect(await store.load("user1", "era")).toBeNull();
    allows.mockReturnValue(false);
    expect(await store.load("user1", "era")).toBeNull();
    allows.mockReturnValue(true);
    roles.set("member-role", { id: "member-role", name: "Member" });
    db.member.findFirst.mockResolvedValue(null);
    expect(await store.load("user1", "era")).toBeNull();
    expect(db.character.findMany).not.toHaveBeenCalled();
  });
});
