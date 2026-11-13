import { describe, expect, it } from "vitest";
import { createLeaderboardPages, prismaLeaderboardStore, type LeaderboardStore, type LeaderRun, type PublicGuild } from "../src/services/public-leaderboard.js";
import { freeSlug, guildPageStats, guildSlugs, slugBase } from "../src/services/guild-public-stats.js";
import { characterKey } from "../companion/character-identity.mjs";
import { publicRules } from "../src/services/public-score.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-10T20:00:00Z");
const P = (character: string, role = "DPS", extra: Record<string, unknown> = {}) => ({ character, realm: "Doomhowl", className: "Warrior", role, level: 16, minLevel: 16, presentSec: 1400, ...extra });
const run = (id: string, sec: number, players: ReturnType<typeof P>[], over: Partial<LeaderRun> = {}): LeaderRun => ({
  runId: id, instanceId: 389, dungeonName: "Ragefire Chasm", durationSec: sec, endedAt: new Date(NOW.getTime() - sec * 1000), deaths: 0, bracket: "15-29", season: "2026-Q4", confirmations: 2, routeKey: null, difficultyId: 0,
  evidence: { startedAt: new Date(NOW.getTime() - 2 * sec * 1000), completedBy: "final boss", encounters: [] }, players, ...over } as unknown as LeaderRun);
const key = (name: string) => characterKey(name, "Doomhowl", "forever");

const groupA = [P("Aldric", "TANK"), P("Brenna", "HEALER"), P("Corvin"), P("Dara"), P("Edda", "DPS", { guild: "Elsewhere Crew" })];
const groupB = [P("Fenn", "TANK"), P("Gale", "HEALER"), P("Hob"), P("Ivo"), P("Pickup", "DPS", { guild: "Moonwell Vanguard" })];
const runsA = [run("a1", 1500, groupA), run("a2", 1400, groupA)];
const runsB = [run("b1", 1450, groupB)];

function appFor(guilds: PublicGuild[], extra: Partial<LeaderboardStore> = {}) {
  const all = [...runsA, ...runsB];
  const store: LeaderboardStore = {
    async runs(q) { return all.filter((r) => (!q.from || r.endedAt >= q.from) && (!q.to || r.endedAt < q.to)); },
    async characterRuns() { return all; },
    async guilds() { return guilds; },
    async guildRuns(id) { return id === "g1" ? runsA : id === "g2" ? runsB : []; },
    // "zed" is on the roster of g1 but has no public run there: never tagged.
    async guildRoster(id) { return id === "g1" ? [...groupA.map((p) => key(p.character)), key("Zed")] : id === "g2" ? groupB.slice(0, 4).map((p) => key(p.character)) : []; },
    async guildStats(ids) { return ids.map((guildId) => guildId === "g1"
      ? { guildId, faction: "ALLIANCE", realm: "Doomhowl", members: 30, linked: 20, levelled: 10, at60: 1, levelSum: 200, duels: 0 }
      : { guildId, faction: "HORDE", realm: "Faerlina", members: 12, linked: 8, levelled: 6, at60: 0, levelSum: 90, duels: 0 }); },
    ...extra
  };
  const pages = createLeaderboardPages({ store, personal: null, now: () => NOW });
  const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null,
    routes: [pages.route], now: () => NOW, fetch: fetch });
  return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
}
const two: PublicGuild[] = [{ id: "g1", name: "Quebec Gold" }, { id: "g2", name: "Moonwell Vanguard" }];

describe("public guild pages", () => {
  it("shows each guild's own faction and realm whichever page is opened first", async () => {
    const get = appFor(two);
    await get("/leaderboards/guilds/");
    const second = await get("/leaderboards/guild/moonwell-vanguard");
    expect(second.body).toContain("Horde");
    expect(second.body).toContain("Faerlina");
    expect(second.body).not.toContain("Doomhowl</div>");
    const json = JSON.parse((await get("/leaderboards/guild/quebec-gold.json")).body) as { faction: string; realm: string };
    expect(json).toMatchObject({ faction: "ALLIANCE", realm: "Doomhowl" });
    const other = JSON.parse((await get("/leaderboards/guild/moonwell-vanguard.json")).body) as { faction: string };
    expect(other.faction).toBe("HORDE");
  });

  it("uses the stored slug, falls back to an id slug for names without Latin letters and keeps the old id URL redirecting", async () => {
    const get = appFor([{ id: "g1", name: "Quebec Gold", publicSlug: "legacy-qg" }, { id: "g2", name: "Лунный колодец" }]);
    expect((await get("/leaderboards/guild/legacy-qg")).status).toBe(200);
    expect((await get("/leaderboards/guild/quebec-gold")).status).toBe(404);
    const moved = await get("/leaderboards/guild/g1");
    expect(moved.status).toBe(302);
    expect(moved.headers["location"]).toContain("/leaderboards/guild/legacy-qg");
    expect((await get("/leaderboards/guild/g-g2")).status).toBe(200);
    expect(slugBase("Лунный колодец", "ckAbC123xyz")).toBe("g-ckabc123xy");
  });

  it("states canonical and language alternates on the guilds page and a guild page", async () => {
    const get = appFor(two);
    for (const path of ["/leaderboards/guilds/", "/leaderboards/guild/quebec-gold"]) {
      const page = await get(path);
      expect(page.body).toContain('rel="canonical"');
      expect(page.body).toContain('hreflang="fr"');
      expect(page.body).toContain('hreflang="x-default"');
    }
    expect((await get("/leaderboards/guild/quebec-gold")).body).toMatch(/rel="canonical" href="[^"]*\/leaderboards\/guild\/quebec-gold\//);
  });

  it("tags only characters with a public run in their guild and never prints uploader guild text", async () => {
    const get = appFor(two);
    const page = (await get("/leaderboards/characters/?bracket=15-29")).body;
    expect(page).toContain('guild-tag">&lt;<a href="/forever/leaderboards/guild/quebec-gold');
    expect(page).not.toContain("Elsewhere Crew");
    expect(page).not.toContain("Zed");
    // Pickup is on no roster but says "Moonwell Vanguard", a listed guild: no tag from the uploader's text.
    const pickup = /Pickup[\s\S]{0,400}?<\/tr>/.exec(page)?.[0] ?? "";
    expect(pickup).not.toContain("guild-tag");
  });

  it("does not load guild data for run pages, and a failing guild store never breaks a page", async () => {
    let calls = 0;
    const get = appFor(two, { async guilds() { calls++; throw new Error("db down"); } });
    expect((await get("/leaderboards/run/a1")).status).not.toBe(500);
    expect(calls).toBe(0);
  });

  it("keeps different difficulties of one dungeon apart", () => {
    const heroic = run("h1", 1000, groupA, { difficultyId: 2 });
    const stats = guildPageStats([...runsA, heroic], groupA.map((p) => key(p.character)), publicRules(), [...runsA, heroic]);
    expect(stats.dungeons.map((d) => [d.instanceId, d.difficultyId, d.bestSec])).toEqual([[389, 0, 1400], [389, 2, 1000]]);
    expect(stats.records).toBe(2);
  });

  it("assigns slugs once and never reassigns", () => {
    expect(freeSlug("Quebec Gold", "g1", new Set(["quebec-gold"]))).toBe("quebec-gold-2");
    const slugs = guildSlugs([{ id: "z", name: "Quebec Gold", publicSlug: "quebec-gold" }, { id: "a", name: "Quebec Gold" }]);
    expect(slugs.get("z")).toBe("quebec-gold");
    expect(slugs.get("a")).toBe("quebec-gold-2");
  });

  it("stores a new guild's slug on first listing, keeps stored ones and survives two concurrent loads", async () => {
    const stored = new Map<string, string | null>([["g1", "quebec-gold"], ["g2", null]]);
    const names: Record<string, string> = { g1: "Quebec Gold", g2: "Quebec Gold" };
    const database = {
      guildSettings: {
        async findMany(args: { where: Record<string, unknown> }) {
          await Promise.resolve();
          if ("publicDungeonRuns" in args.where) return [...stored].map(([guildId, publicSlug]) => ({ guildId, publicSlug, guild: { name: names[guildId], discordId: guildId, page: null } }));
          return [...stored].filter(([, slug]) => slug).map(([, publicSlug]) => ({ publicSlug }));
        },
        async findUnique(args: { where: { guildId: string } }) { return { publicSlug: stored.get(args.where.guildId) ?? null }; },
        async updateMany(args: { where: { guildId: string; publicSlug: null }; data: { publicSlug: string } }) {
          if (stored.get(args.where.guildId)) return { count: 0 };
          if ([...stored.values()].includes(args.data.publicSlug)) throw Object.assign(new Error("unique"), { code: "P2002" });
          stored.set(args.where.guildId, args.data.publicSlug); return { count: 1 };
        }
      }
    };
    // Two separate stores (two processes) and a second call on the same one, all cold at once.
    const first = prismaLeaderboardStore(database as never);
    const second = prismaLeaderboardStore(database as never);
    const results = await Promise.all([first.guilds(), second.guilds(), first.guilds()]);
    expect(Object.fromEntries(stored)).toEqual({ g1: "quebec-gold", g2: "quebec-gold-2" });
    for (const guilds of results) expect(guilds.map((g) => g.publicSlug).sort()).toEqual(["quebec-gold", "quebec-gold-2"]);
  });

  it("never overwrites a slug another process stored first", async () => {
    const stored = new Map<string, string | null>([["g2", null]]);
    const database = {
      guildSettings: {
        async findMany(args: { where: Record<string, unknown> }) { return "publicDungeonRuns" in args.where ? [{ guildId: "g2", publicSlug: null, guild: { name: "Foo", discordId: "g2", page: null } }] : []; },
        async findUnique() { return { publicSlug: stored.get("g2") ?? null }; },
        // The other process wins between our read and our write.
        async updateMany() { stored.set("g2", "foo"); return { count: 0 }; }
      }
    };
    const guilds = await prismaLeaderboardStore(database as never).guilds();
    expect(guilds[0]!.publicSlug).toBe("foo");
    expect(stored.get("g2")).toBe("foo");
  });

  it("redirects the id URL of the duels page to the slug", async () => {
    const get = appFor(two, { async guildDuelRows() { return []; } });
    const moved = await get("/leaderboards/guild/g1/duels?lang=fr");
    expect(moved.status).toBe(302);
    expect(moved.headers["location"]).toContain("/leaderboards/guild/quebec-gold/duels");
  });
});
