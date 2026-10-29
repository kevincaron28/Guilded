import type { PrismaClient } from "../src/generated/prisma/client.js";
import { describe, expect, it, vi } from "vitest";
import { createGuildDirectory, directoryMatches, prismaGuildDirectoryStore, readDirectoryFilters, type DirectoryGuild } from "../src/services/guild-directory.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const quebecGold: DirectoryGuild = {
  id: "g1", name: "⚜Québec Gold⚜", gameEdition: "forever", language: "fr", slug: "quebec-gold", dungeons: true,
  cores: ["Les Aggros Anonyme", "Les Pulliticiens"], listings: [{ id: "l1", faction: "HORDE", realm: "Doomhowl", language: "fr" }]
};
const beard: DirectoryGuild = { id: "g2", name: "The Beard", gameEdition: "forever", language: "en", slug: null, dungeons: true, cores: [], listings: [] };

describe("guild directory filters", () => {
  it("caps the search, keeps known factions and languages only", () => {
    expect(readDirectoryFilters(new URLSearchParams(`q=${"x".repeat(60)}&faction=horde&language=de&recruiting=1`)))
      .toEqual({ q: "x".repeat(40), faction: "HORDE", language: null, recruiting: true });
  });

  it("finds a guild by name without accents or case, and by its listings", () => {
    const match = (query: string, guild: DirectoryGuild) => directoryMatches(guild, readDirectoryFilters(new URLSearchParams(query)));
    expect(match("q=quebec", quebecGold)).toBe(true);
    expect(match("q=quebec", beard)).toBe(false);
    expect(match("faction=HORDE", quebecGold)).toBe(true);
    expect(match("faction=ALLIANCE", quebecGold)).toBe(false);
    expect(match("language=en", beard)).toBe(true);
    expect(match("recruiting=1", beard)).toBe(false);
  });
});

describe("guild directory page", () => {
  function app(guilds: DirectoryGuild[]) {
    const store = { guilds: vi.fn(async () => guilds) };
    const web = createWebApp({ auth: null, store: memoryWebStore().store, allows: () => true, postApplication: async () => null, routes: [createGuildDirectory(store).route] });
    const open = (path: string, query = "") => web.respond({ method: "GET", path, query: new URLSearchParams(query), headers: {} });
    return { store, open };
  }

  it("lists published guild pages that allow indexing in a sitemap, once across editions", async () => {
    const hidden: DirectoryGuild = { ...beard, id: "g3", slug: "not-indexed", indexable: false };
    const { open, store } = app([quebecGold, beard, hidden]);
    const map = (await open("/recruitment/guilds/sitemap.xml"))!;
    expect(map.status).toBe(200);
    expect(map.headers["content-type"]).toContain("application/xml");
    expect(map.body).toContain("<loc>https://guilded.kcaron.top/g/quebec-gold/</loc>");
    expect(map.body).not.toContain("not-indexed");
    expect(map.body.match(/<url>/g)).toHaveLength(1);
    expect(store.guilds).toHaveBeenCalledTimes(5);
  });

  it("lists each guild with its page, recruitment and dungeon scores, in the page language", async () => {
    const { open, store } = app([quebecGold, beard]);
    const page = (await open("/recruitment/guilds/", "lang=fr"))!;
    expect(page.status).toBe(200);
    expect(page.body).toContain("Trouver une guilde");
    expect(page.body).toContain('href="/g/quebec-gold/?lang=fr">⚜Québec Gold⚜</a>');
    expect(page.body).toContain("2 cores de raid : Les Aggros Anonyme, Les Pulliticiens");
    expect(page.body).toContain("/recruitment/apply/l1");
    expect(page.body).toContain("/leaderboards/guild/g2");
    expect(page.body).toContain('aria-current="page">Trouver une guilde</a>');
    expect(store.guilds).toHaveBeenCalledWith("forever");
  });

  it("filters, says when nothing matches, and redirects the address without a slash", async () => {
    const { open } = app([quebecGold, beard]);
    const filtered = (await open("/recruitment/guilds/", "q=beard"))!.body;
    expect(filtered).toContain("The Beard");
    expect(filtered).not.toContain("Québec Gold</a>");
    expect((await open("/recruitment/guilds/", "q=nobody"))!.body).toContain("No guild matches these filters yet.");
    expect((await open("/recruitment/guilds"))!.headers["location"]).toBe("/recruitment/guilds/");
  });

  it("escapes guild names", async () => {
    const { open } = app([{ ...beard, name: "<script>x</script>" }]);
    expect((await open("/recruitment/guilds/"))!.body).not.toContain("<script>x");
  });
});

describe("guild directory data", () => {
  it("reads one edition, published or recruiting or public guilds only, from approved servers", async () => {
    const findMany = vi.fn(async () => [
      { id: "g1", name: "QG", discordId: "ok", gameEdition: "forever", settings: { language: "fr", publicDungeonRuns: false }, page: { slug: "qg", published: true }, raidCores: [{ name: "A" }], recruitmentListings: [] },
      { id: "g2", name: "Draft", discordId: "ok", gameEdition: "forever", settings: null, page: { slug: "draft", published: false }, raidCores: [], recruitmentListings: [{ id: "l", faction: null, realm: null, language: null }] },
      { id: "g3", name: "Blocked", discordId: "blocked", gameEdition: "forever", settings: null, page: null, raidCores: [], recruitmentListings: [] }
    ]);
    const guilds = await prismaGuildDirectoryStore({ guild: { findMany } } as unknown as PrismaClient, (id) => id !== "blocked").guilds("forever");
    expect(guilds.map((g) => [g.name, g.slug, g.listings.length])).toEqual([["QG", "qg", 0], ["Draft", null, 1]]);
    expect(guilds.map((g) => g.indexable)).toEqual([true, false]);
    const query = (findMany.mock.calls[0] as unknown as [{ where: { gameEdition: string; OR: unknown[] }; take: number }])[0];
    expect(query.where.gameEdition).toBe("forever");
    expect(query.where.OR).toHaveLength(3);
    expect(query.take).toBe(500);
  });
});
