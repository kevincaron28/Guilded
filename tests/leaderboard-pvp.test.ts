import { describe, expect, it } from "vitest";
import { clearLeaderboardCaches, createLeaderboardPages, type LeaderRun, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { bgBoard, guildPvp, hotZoneRows, loadPvpData, playerPvp, readPvpFilters, worldBoard, type PvpData, type PvpGame, type PvpWorldRow } from "../src/services/leaderboard-pvp.js";
import { weekKeyOf } from "../src/services/world-pvp.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-12-10T20:00:00Z");
const week = weekKeyOf(NOW);
const person = (name: string, className: string, level: number, guildId = "g1", realm = "Doomhowl") => ({ key: `${name.toLowerCase()}-${realm.toLowerCase()}`, name, short: name.split(" ")[0]!, realm, className, level, guildId });
const world = (name: string, className: string, level: number, kills: number, deaths: number, extra: Partial<PvpWorldRow> = {}): PvpWorldRow => ({ ...person(name, className, level), kills, deaths, defends: 0, helped: 0, ...extra });
const game = (name: string, className: string, outcome: string, hoursAgo: number, over: Partial<PvpGame> = {}): PvpGame => ({ ...person(name, className, 60), mode: "casual", bracket: "60", mapId: 489, outcome, endedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000), ...over });
const HOSTILE = `<img src=x onerror=alert(1)>`;
const data = (): PvpData => ({
  weekKey: week,
  week: [world("Dara", "Rogue", 60, 40, 10), world("Corvin", "Mage", 60, 25, 5), world("Edda", "Hunter", 45, 12, 3), world(HOSTILE, "Priest", 60, 5, 1)],
  total: [world("Dara", "Rogue", 60, 140, 40), world("Corvin", "Mage", 60, 90, 20)],
  games: [game("Dara", "Rogue", "win", 1), game("Dara", "Rogue", "win", 2), game("Dara", "Rogue", "loss", 3, { mapId: 529, mode: "rated" }), game("Corvin", "Mage", "win", 4)],
  calls: [{ guildId: "g1", zone: "Stranglethorn Vale", calledAt: NOW }, { guildId: "g1", zone: "Stranglethorn Vale", calledAt: NOW }, { guildId: "g1", zone: "Hillsbrad Foothills", calledAt: NOW }, { guildId: "g1", zone: `"><script>alert(1)</script>`, calledAt: NOW }]
});
const run: LeaderRun = {
  runId: "r1", instanceId: 389, dungeonName: "Ragefire Chasm", durationSec: 1500, endedAt: new Date("2026-12-09T20:00:00Z"), deaths: 0, bracket: "15-29", season: "2026-Q4", confirmations: 1, routeKey: null, difficultyId: 0,
  evidence: { startedAt: new Date("2026-12-09T19:30:00Z"), completedBy: "final boss", encounters: [] },
  players: [{ character: "Dara", realm: "Doomhowl", className: "Rogue", role: "DPS", level: 20, minLevel: 20, presentSec: 1500 }]
};

function setup(pvp: LeaderboardStore["pvp"] | undefined, clock = NOW) {
  const store: LeaderboardStore = {
    async runs() { return [run]; }, async characterRuns(name) { return name.toLowerCase().startsWith("dara") ? [run] : []; },
    async guilds() { return [{ id: "g1", name: "Quebec Gold", publicSlug: "quebec-gold" }]; }, async guildRuns() { return [run]; }, async guildRoster() { return ["dara-doomhowl"]; },
    async globalDuelRows() { return []; }, ...(pvp ? { pvp } : {})
  };
  const pages = createLeaderboardPages({ store, personal: null, now: () => clock });
  const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => clock });
  const get = (path: string, lang = "en") => { const url = new URL(path, "https://guildedwow.com"); url.searchParams.set("lang", lang); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
  return { get, pages };
}

describe("PvP leaderboards: aggregation", () => {
  it("ranks world PvP by kills, filters by class, level and period, and counts deaths into K/D", () => {
    const d = data();
    const base = { className: null, band: null, period: "week" as const, mode: null };
    expect(worldBoard(d, base).rows.map((r) => r.name).slice(0, 3)).toEqual(["Dara", "Corvin", "Edda"]);
    expect(worldBoard(d, { ...base, className: "Mage" }).rows.map((r) => r.name)).toEqual(["Corvin"]);
    expect(worldBoard(d, { ...base, band: { key: "40-59", from: 40, to: 59 } }).rows.map((r) => r.name)).toEqual(["Edda"]);
    const all = worldBoard(d, { ...base, period: "all" });
    expect(all.rows[0]).toMatchObject({ name: "Dara", kills: 140 });
    expect(all.kills).toBe(230);
    expect(all.deaths).toBe(60);
  });

  it("builds the battleground ladder, the results by map and the latest results", () => {
    const board = bgBoard(data(), { className: null, band: null, period: "week", mode: null });
    expect(board.rows[0]).toMatchObject({ name: "Dara", wins: 2, losses: 1, games: 3 });
    expect(board.byMap.map((m) => [m.mapId, m.games, m.wins])).toEqual([[489, 3, 3], [529, 1, 0]]);
    expect(board.recent[0]!.name).toBe("Dara");
    expect(bgBoard(data(), { className: null, band: null, period: "week", mode: "rated" }).rows.map((r) => `${r.name}:${r.games}`)).toEqual(["Dara:1"]);
  });

  it("counts the hot zones, finds a player and sums a guild", () => {
    const zones = hotZoneRows(data().calls).map((z) => `${z.zone}:${z.calls}`);
    expect(zones[0]).toBe("Stranglethorn Vale:2");
    expect(zones).toContain("Hillsbrad Foothills:1");
    expect(playerPvp(data(), "Dara", "Doomhowl").total?.kills).toBe(140);
    expect(playerPvp(data(), "Nobody", null).record.games).toBe(0);
    expect(guildPvp(data(), "g1")).toMatchObject({ week: { kills: 82, deaths: 19 }, games: 4, wins: 3 });
    expect(guildPvp(data(), "other").top).toEqual([]);
  });

  it("reads filters from the address and ignores anything unknown", () => {
    expect(readPvpFilters(new URLSearchParams("class=mage&levels=60&period=all&mode=rated"))).toMatchObject({ className: "Mage", band: { key: "60" }, period: "all", mode: "rated" });
    expect(readPvpFilters(new URLSearchParams(`class=${encodeURIComponent("<script>")}&levels=../../x&period=x&mode='"`))).toEqual({ className: null, band: null, period: "week", mode: null });
  });
});

describe("PvP leaderboards: the store query", () => {
  it("asks only for the publishing guilds, never hidden or test members, and nothing at all without a guild", async () => {
    const calls: { table: string; where: Record<string, unknown> }[] = [];
    const record = (table: string, rows: unknown[]) => async (args: { where: Record<string, unknown> }) => { calls.push({ table, where: args.where }); return rows; };
    const database = {
      worldPvpWeek: { findMany: record("worldPvpWeek", []), groupBy: record("worldPvpWeek.total", []) },
      battlegroundReport: { findMany: record("battlegroundReport", []) }, guildHelpCall: { findMany: record("guildHelpCall", []) }, character: { findMany: record("character", []) }
    };
    expect(await loadPvpData(database as never, [], "forever", NOW)).toMatchObject({ week: [], games: [] });
    expect(calls).toHaveLength(0);
    await loadPvpData(database as never, ["g1"], "forever", NOW);
    expect(calls.map((c) => c.table).sort()).toEqual(["battlegroundReport", "guildHelpCall", "worldPvpWeek", "worldPvpWeek.total"]);
    for (const call of calls) {
      expect(call.where["guildId"]).toEqual({ in: ["g1"] });
      expect(call.where["member"]).toEqual({ status: "ACTIVE", isTest: false, raceHidden: false });
    }
  });
});

describe("PvP leaderboards: pages", () => {
  it("shows the PvP tab with world PvP, hot zones, the battleground ladder, results and a link to the duel ladder", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/");
    expect(res.status).toBe(200);
    for (const text of ["World PvP", "Hot zones", "Battleground ladder", "Latest results", "Warsong Gulch", "Stranglethorn Vale", "Dara", "Corvin", "K/D", "Kills this week"]) expect(res.body).toContain(text);
    expect(res.body).toMatch(/href="[^"]*\/leaderboards\/duels\//);
    expect(res.body).toContain('class="on" aria-current="page"');
    expect(res.body).not.toMatch(/<script|onchange=|onclick=/i);
    const main = res.body.slice(res.body.indexOf('class="hub-tabs"'), res.body.indexOf("<footer"));
    expect(main.length).toBeGreaterThan(500);
    expect(main).not.toMatch(/discord|confirm|evidence|verif|limit|checked|cap\b/i);
  });

  it("is served in French", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/", "fr");
    expect(res.status).toBe(200);
    for (const text of ["PvP mondial", "Zones chaudes", "Classement des champs de bataille", "Derniers résultats", "Goulet des Chanteguerres", "Victimes", "Classement des duels"]) expect(res.body).toContain(text);
    expect(res.body).not.toContain("Hot zones");
    expect(res.body).not.toContain("Battleground ladder");
  });

  it("keeps the class, level, period and mode filters in the address and applies them", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/?class=Mage&levels=60&period=all&mode=casual");
    expect(res.status).toBe(200);
    expect(res.body).toContain('action="/leaderboards/pvp/"');
    expect(res.body).toContain('<option value="Mage" selected>');
    expect(res.body).toContain('<option value="all" selected>');
    expect(res.body).toContain("Corvin");
    expect(res.body).not.toContain(">Dara<");
    expect(res.body).toContain("<button");
  });

  it("escapes hostile names, zones and filter values", async () => {
    const { get } = setup(async () => data());
    const res = await get(`/leaderboards/pvp/?class=${encodeURIComponent(`<script>alert(1)</script>`)}&levels=${encodeURIComponent(`"><img src=x>`)}&mode=${encodeURIComponent(`'"><svg onload=1>`)}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("<img src=x");
    expect(res.body).not.toContain("<script>alert");
    expect(res.body).not.toContain("<svg onload");
    expect(res.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(res.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("adds the PvP tab, a podium and the latest battleground results to the hub, and a PvP section to a player and a guild page", async () => {
    const { get } = setup(async () => data());
    const hub = await get("/leaderboards/");
    expect(hub.status).toBe(200);
    expect(hub.body).toMatch(/href="[^"]*\/leaderboards\/pvp\//);
    expect(hub.body).toContain("PvP this week");
    expect(hub.body).toContain("Latest PvP");
    expect(hub.body).toContain("Warsong Gulch");
    const player = await get("/leaderboards/character/Dara-Doomhowl");
    expect(player.status).toBe(200);
    expect(player.body).toContain("<h2>PvP</h2>");
    expect(player.body).toContain("140");
    const guild = await get("/leaderboards/guild/quebec-gold");
    expect(guild.status).toBe(200);
    expect(guild.body).toContain("<h2>PvP</h2>");
    expect(guild.body).toContain("Battleground wins");
  });

  it("has no PvP page or panel when the store has no PvP data source", async () => {
    const { get } = setup(undefined);
    expect((await get("/leaderboards/pvp/")).status).toBe(404);
    const hub = await get("/leaderboards/");
    expect(hub.body).not.toContain("Latest PvP");
  });

  it("reads PvP once per week through the cache, serves it stale while it reloads, and drops it when cleared", async () => {
    let loads = 0, clock = NOW.getTime();
    let value = data();
    const store: LeaderboardStore = {
      async runs() { return []; }, async characterRuns() { return []; }, async guilds() { return [{ id: "g1", name: "Quebec Gold", publicSlug: "quebec-gold" }]; }, async guildRuns() { return []; }, async guildRoster() { return []; },
      async pvp() { loads += 1; return value; }
    };
    const pages = createLeaderboardPages({ store, personal: null, now: () => new Date(clock) });
    const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => new Date(clock) });
    const get = () => app.respond({ method: "GET", path: "/leaderboards/pvp/", query: new URLSearchParams(), headers: {} }) as Promise<WebResponse>;
    await get(); await get(); await get();
    expect(loads).toBe(1);
    value = { ...data(), week: [world("Newcomer", "Warlock", 60, 99, 1)] };
    expect((await get()).body).not.toContain("Newcomer");
    clearLeaderboardCaches();
    expect((await get()).body).toContain("Newcomer");
    expect(loads).toBe(2);
    clock += 61_000;
    expect((await get()).body).toContain("Newcomer");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loads).toBe(3);
  });
});
