import { describe, expect, it, vi } from "vitest";
import { createGuildToolsPages, filterGroupPosts, teamVacancies } from "../src/services/guild-tools-pages.js";
import { prismaGuildToolsStore, recipeQuery, type GuildToolsStore, type GroupView, type TeamView } from "../src/services/guild-tools-store.js";
import type { GuildDashboardAccess } from "../src/services/guild-dashboard-access.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";
import { layout } from "../src/services/web-layout.js";

const NOW = new Date("2026-10-25T18:00:00Z");
const guild = { id: "guild1", name: "Guild <one>", edition: "retail" };
const core: TeamView = { id: "core1", name: "Tuesday team", schedule: "mardi 20h", timezone: "America/Toronto", tankLimit: 2, healerLimit: 1, dpsLimit: null, truncated: false,
  members: [{ characterId: "char1", name: "Élodie Dawn", realm: "Realm", role: "TANK", bench: false, trial: true, main: "Élodie Dawn", backups: ["Alt · Realm · HEALER"] }, { characterId: "char2", name: "Backup", realm: "Realm", role: "HEALER", bench: true, trial: true, main: "Backup", backups: [] }] };
const group: GroupView = { title: "Deadmines", kind: "DUNGEON", minLevel: 15, maxLevel: 25, createdAt: NOW, size: 5, signedUp: 2, missing: { TANK: 1, HEALER: 0, DPS: 2 }, url: "https://discord.com/channels/111111111111111/222222222222222/333333333333333" };
function fixtures() {
  const store: GuildToolsStore = {
    guilds: vi.fn(async () => [guild]),
    craft: vi.fn(async () => ({ guild, truncated: false, data: [{ character: "Élodie Dawn", realm: "Realm", profession: "Alchemy", itemKey: 42, itemName: "Potion <Greater>", scannedAt: new Date("2026-10-01") }] })),
    teams: vi.fn(async () => ({ guild, truncated: false, data: [core] })),
    history: vi.fn(async () => ({ guild, truncated: false, data: { name: "Élodie Dawn", characters: [{ id: "char1", name: "Élodie Dawn", realm: "Realm", main: true }], events: [{ at: NOW, kind: "attendance" as const, title: "Raid one", detail: "BENCHED", team: "Tuesday team" }], truncated: false } })),
    groups: vi.fn(async () => ({ guild, truncated: false, data: [group] }))
  };
  const pages = createGuildToolsPages(store);
  const request = async (target: string, signedIn = true, method = "GET") => {
    const url = new URL(target, "https://guilded.kcaron.top");
    const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
    const ctx: WebContext = { request: { path: url.pathname, method, query: url.searchParams, headers: {} }, lang, t: (en, fr) => lang === "fr" ? fr : en, now: NOW, account: signedIn ? { id: "account1", discordUserId: "user1", username: "Tester", displayName: null } : null, sessionToken: null, csrf: null, form: null, auth: null };
    const kit: WebKit = {
      page: (status, title, body, extra = {}) => ({ status, body: layout({ lang, title, body, path: url.pathname, account: ctx.account, csrf: null, signInOn: false, ...(extra.noindex ? { noindex: true } : {}), ...(extra.languageParams ? { languageParams: extra.languageParams } : {}) }), headers: {} }),
      redirect: location => ({ status: 302, headers: { location }, body: "" }),
      signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" })
    };
    return (await pages.route(ctx, kit))!;
  };
  return { store, request };
}

describe("guild tool rules", () => {
  it("reads recipe names, IDs and item/enchant links without accepting malformed or overflowing IDs", () => {
    expect(recipeQuery(" Potion ")).toEqual({ itemName: { contains: "Potion", mode: "insensitive" } });
    expect(recipeQuery("|cff00ff00|Hitem:123:0:0|h[Potion]|h|r")).toEqual({ itemKey: 123 });
    expect(recipeQuery("|Hspell:456|h[Enchant]|h")).toEqual({ itemKey: -456 });
    expect(recipeQuery("-456")).toEqual({ itemKey: -456 });
    for (const value of ["", "0", "99999999999999999", "|Hitem:bad|h[X]|h"]) expect(() => recipeQuery(value)).toThrow();
  });
  it("does not count benched healers as active coverage, keeps trials independent and leaves unconfigured targets unknown", () => {
    expect(teamVacancies(core)).toEqual({ TANK: 1, HEALER: 1, DPS: null });
  });
  it("filters only matching open posts with an actual role vacancy and never treats free-form groups as fixed-role dungeons", () => {
    const rows = [group, { ...group, title: "Full Deadmines", signedUp: 5 }, { ...group, title: "Leveling", missing: null }];
    expect(filterGroupPosts(rows, "deadmines", "TANK")).toEqual([group]);
    expect(filterGroupPosts(rows, "", "HEALER")).toEqual([]);
  });
});

describe("private guild pages", () => {
  it("blocks unsigned reads and writes before loading data on every page", async () => {
    const { request, store } = fixtures();
    for (const path of ["crafters", "teams", "history", "groups"]) {
      expect((await request(`/me/${path}?guild=guild1&character=char1`, false)).status).toBe(401);
      expect((await request(`/me/${path}?guild=guild1`, true, "POST")).status).toBe(405);
    }
    expect(store.craft).not.toHaveBeenCalled(); expect(store.teams).not.toHaveBeenCalled(); expect(store.history).not.toHaveBeenCalled(); expect(store.groups).not.toHaveBeenCalled();
  });
  it("escapes recipe/character data, labels stale observations and preserves guild/query on a language switch", async () => {
    const { request, store } = fixtures();
    const page = await request("/me/crafters?guild=guild1&q=Potion");
    expect(store.craft).toHaveBeenCalledWith("user1", "guild1", "Potion");
    expect(page.body).toContain("Potion &lt;Greater&gt;");
    expect(page.body).toContain("Stale");
    expect(page.body).toContain("Élodie Dawn");
    expect(page.body).toContain("guild=guild1&amp;edition=retail&amp;q=Potion&amp;lang=fr");
    expect((await request("/me/crafters?guild=guild1&q=0")).status).toBe(400);
  });
  it("shows independent bench/trial labels, team history links and explicit unknown buff coverage", async () => {
    const { request } = fixtures();
    const page = await request("/me/teams?guild=guild1&core=core1&lang=fr");
    expect(page.body).toContain("Remplaçant · Essai");
    expect(page.body).toContain("Titulaire · Essai");
    expect(page.body).toContain("/me/history?guild=guild1&amp;edition=retail&amp;character=char1");
    expect(page.body).toContain("America/Toronto");
  });
  it("labels member-wide history, shows team attribution, and includes only safe returned fields", async () => {
    const { request, store } = fixtures();
    const page = await request("/me/history?guild=guild1&character=char1");
    expect(store.history).toHaveBeenCalledWith("user1", "guild1", "char1");
    expect(page.body).toContain("Member-wide history");
    expect(page.body).toContain("Tuesday team");
    expect(page.body).toContain("BENCHED");
    expect((await request("/me/history?guild=guild1")).headers["location"]).toContain("/me/roster");
  });
  it("denies revoked access and hides previous records on backend failure", async () => {
    const { request, store } = fixtures();
    vi.mocked(store.teams).mockResolvedValue(null);
    expect((await request("/me/teams?guild=guild1")).status).toBe(403);
    vi.mocked(store.groups).mockRejectedValue(new Error("private error"));
    const failure = await request("/me/groups?guild=guild1");
    expect(failure.status).toBe(503); expect(failure.body).not.toContain("private error"); expect(failure.body).not.toContain("Deadmines");
  });
});

describe("guild tool data access", () => {
  function provider() {
    const access: GuildDashboardAccess = { authorize: vi.fn(async () => guild), guilds: vi.fn(async () => [guild]) };
    const db = {
      recipeKnown: { findMany: vi.fn(async () => [{ character: "Elodie", realm: "Realm", profession: "Alchemy", itemKey: 42, itemName: "Potion", scannedAt: NOW }]) },
      character: { findMany: vi.fn(async () => [{ name: "Elodie", displayName: "Élodie Dawn", realm: "Realm", gameEdition: "retail" }]), findFirst: vi.fn(async () => ({ name: "Elodie", displayName: "Élodie Dawn", memberId: "member1", member: { characters: [] } })) },
      unclaimedCharacter: { findMany: vi.fn(async () => []) },
      raidCore: { findMany: vi.fn(async () => []) }, raidAttendance: { findMany: vi.fn(async () => []) }, lootAward: { findMany: vi.fn(async () => []) }, epgpTransaction: { findMany: vi.fn(async () => []) }, dungeonGroup: { findMany: vi.fn(async () => []) }
    };
    return { db, access, store: prismaGuildToolsStore(db as unknown as PrismaClient, access) };
  }
  it("authorizes each operation before reading any sensitive records", async () => {
    const { store, access, db } = provider();
    vi.mocked(access.authorize).mockResolvedValue(null);
    expect(await store.craft("user", "guild1", "Potion")).toBeNull();
    expect(await store.teams("user", "guild1")).toBeNull();
    expect(await store.history("user", "guild1", "other-char")).toBeNull();
    expect(await store.groups("user", "guild1")).toBeNull();
    for (const model of Object.values(db)) {
      if ("findMany" in model) expect(model.findMany).not.toHaveBeenCalled();
    }
  });
  it("searches recipes only in the authorized guild and resolves full names within its edition", async () => {
    const { store, db } = provider();
    const result = await store.craft("user", "guild1", "42");
    expect(result?.data[0]?.character).toBe("Élodie Dawn");
    expect(db.recipeKnown.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild1", itemKey: 42 }, take: 201 }));
    expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild1", gameEdition: "retail" }) }));
  });
  it("resolves history ownership before bounded queries and omits note/reason fields", async () => {
    const { store, db } = provider();
    await store.history("user", "guild1", "char1");
    expect(db.character.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "char1", guildId: "guild1", gameEdition: "retail" }) }));
    expect(db.raidAttendance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "member1", raid: { guildId: "guild1", isTest: false, status: "COMPLETED" } }, take: 101 }));
    expect(JSON.stringify(db.raidAttendance.findMany.mock.calls)).not.toContain('"notes"');
    expect(JSON.stringify(db.epgpTransaction.findMany.mock.calls)).not.toContain('"reason"');
    expect(db.lootAward.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild1", memberId: "member1" }, take: 101 }));
  });
});
