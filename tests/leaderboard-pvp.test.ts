import { describe, expect, it, vi } from "vitest";
import { clearLeaderboardCaches, createLeaderboardPages, type LeaderRun, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { continentView, zoneBox, zonePoint, zoneMapHtml, bgBoard, guildPvp, loadPvpData, playerPvp, readPvpFilters, worldBoard, zoneStats, type PvpData, type PvpGame, type PvpWorldRow } from "../src/services/leaderboard-pvp.js";
import { weekKeyOf } from "../src/services/world-pvp.js";
import { PVP_ZONES, zoneById, zoneByName, zoneOf } from "../src/services/pvp-zones.js";
import { existsSync } from "node:fs";
import { ZONE_SHAPES } from "../src/services/pvp-zone-shapes.js";
import { CONTINENT_IMAGES, MAP_HEIGHT, MAP_WIDTH, ZONE_RECTS } from "../src/services/pvp-zone-rects.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-12-10T20:00:00Z");
const week = weekKeyOf(NOW);
const person = (name: string, className: string, level: number, guildId = "g1", realm = "Doomhowl") => ({ key: `${name.toLowerCase()}-${realm.toLowerCase()}`, name, short: name.split(" ")[0]!, realm, className, level, guildId });
const world = (name: string, className: string, level: number, kills: number, deaths: number, extra: Partial<PvpWorldRow> = {}): PvpWorldRow => ({ ...person(name, className, level), kills, deaths, defends: 0, helped: 0, ...extra });
const game = (name: string, className: string, outcome: string, hoursAgo: number, over: Partial<PvpGame> = {}): PvpGame => ({ ...person(name, className, 60), mode: "casual", bracket: "60", mapId: 489, outcome, endedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000), matchKey: `${name}-${hoursAgo}`, ...over });
const HOSTILE = `<img src=x onerror=alert(1)>`;
const data = (): PvpData => ({
  weekKey: week,
  week: [world("Dara", "Rogue", 60, 40, 10), world("Corvin", "Mage", 60, 25, 5), world("Edda", "Hunter", 45, 12, 3), world(HOSTILE, "Priest", 60, 5, 1)],
  total: [world("Dara", "Rogue", 60, 140, 40), world("Corvin", "Mage", 60, 90, 20)],
  games: [game("Dara", "Rogue", "win", 1), game("Dara", "Rogue", "win", 2), game("Dara", "Rogue", "loss", 3, { mapId: 529, mode: "rated" }), game("Corvin", "Mage", "win", 4)],
  calls: [
    { guildId: "g1", zone: "Stranglethorn Vale", mapId: 1434, calledAt: NOW }, { guildId: "g1", zone: "Stranglethorn Vale", mapId: 1434, calledAt: NOW },
    { guildId: "g1", zone: "Vallée de Strangleronce", calledAt: NOW },
    { guildId: "g1", zone: "Hillsbrad Foothills", mapId: 1424, calledAt: NOW }, { guildId: "g1", zone: `"><script>alert(1)</script>`, calledAt: NOW },
    { guildId: "g1", zone: "Tanaris", mapId: 1446, calledAt: new Date(NOW.getTime() - 20 * 86_400_000) }
  ]
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

  it("finds a player and sums a guild", () => {
    expect(playerPvp(data(), "Dara", "Doomhowl").total?.kills).toBe(140);
    expect(playerPvp(data(), "Nobody", null).record.games).toBe(0);
    expect(guildPvp(data(), "g1")).toMatchObject({ week: { kills: 82, deaths: 19 }, games: 4, wins: 3 });
    expect(guildPvp(data(), "other").top).toEqual([]);
  });

  it("maps a French zone name and a map id to one zone, and counts calls per zone for the chosen period", () => {
    expect(zoneByName("Vallée de Strangleronce")?.id).toBe(1434);
    expect(zoneByName("vallee de strangleronce")?.id).toBe(1434);
    expect(zoneByName("Stranglethorn Vale")?.id).toBe(1434);
    expect(zoneOf(1434, "anything")?.en).toBe("Stranglethorn Vale");
    expect(zoneOf(null, "Les Tarides")?.en).toBe("The Barrens");
    expect(zoneById(99999)).toBeNull();
    expect(new Set(PVP_ZONES.map((z) => z.id)).size).toBe(PVP_ZONES.length);
    for (const zone of PVP_ZONES) expect(ZONE_RECTS[zone.id], zone.en).toBeDefined();
    const week = zoneStats(data(), { className: null, band: null, period: "week", mode: null });
    expect(week.find((z) => z.zone?.id === 1434)).toMatchObject({ calls: 3, kills: 0, deaths: 0, heat: 3 });
    expect(week.find((z) => z.zone?.id === 1434)!.guilds[0]).toMatchObject({ guildId: "g1", count: 3 });
    expect(week.every((z) => z.dots.length === 0)).toBe(true);
    expect(week.find((z) => z.zone?.id === 1446)!.calls).toBe(0);
    expect(week.find((z) => z.zone === null)).toMatchObject({ calls: 1 });
    expect(week.length).toBe(PVP_ZONES.length + 1);
    expect(zoneStats(data(), { className: null, band: null, period: "all", mode: null }).find((z) => z.zone?.id === 1446)!.calls).toBe(1);
    expect(zoneStats(data(), { className: null, band: null, period: "week", mode: null }, "other").every((z) => z.heat === 0)).toBe(true);
  });

  it("places a known coordinate inside its zone and inside the continent frame", () => {
    const durotar = zoneBox(1411)!;
    expect(durotar.x).toBeCloseTo(0.5171 * MAP_WIDTH, 0);
    const centre = zonePoint(1411, 0.5, 0.5)!;
    expect(centre.x).toBeCloseTo(durotar.x + durotar.w / 2, 5);
    expect(centre.y).toBeCloseTo(durotar.y + durotar.h / 2, 5);
    for (const [id] of Object.entries(ZONE_RECTS)) {
      const b = zoneBox(Number(id))!;
      for (const [x, y] of [[0, 0], [1, 1], [0.37, 0.81]] as const) {
        const p = zonePoint(Number(id), x, y)!;
        expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-6); expect(p.x).toBeLessThanOrEqual(b.x + b.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(b.y - 1e-6); expect(p.y).toBeLessThanOrEqual(b.y + b.h + 1e-6);
        expect(p.x).toBeGreaterThanOrEqual(-1); expect(p.x).toBeLessThanOrEqual(MAP_WIDTH + 1);
        expect(p.y).toBeGreaterThanOrEqual(-1); expect(p.y).toBeLessThanOrEqual(MAP_HEIGHT + 1);
      }
    }
    expect(zonePoint(1411, 1.2, 0.5)).toBeNull();
    expect(zonePoint(99999, 0.5, 0.5)).toBeNull();
    expect(zonePoint(1411, Number.NaN, 0.5)).toBeNull();
  });

  it("adds kills and deaths to the heat when zone activity exists, and filters them by class and level", () => {
    const d: PvpData = { ...data(), zoneActivity: [
      { weekKey: week, mapId: 1434, zone: "Stranglethorn Vale", guildId: "g1", kills: 8, deaths: 3, className: "Mage", level: 60 },
      { weekKey: week, mapId: 1434, zone: "Stranglethorn Vale", guildId: "g1", kills: 5, deaths: 1, className: "Rogue", level: 45 },
      { weekKey: week - 1, mapId: 1434, zone: "Stranglethorn Vale", guildId: "g1", kills: 100, deaths: 100, className: "Mage", level: 60 }
    ] };
    const base = { className: null, band: null, period: "week" as const, mode: null };
    expect(zoneStats(d, base).find((z) => z.zone?.id === 1434)).toMatchObject({ kills: 13, deaths: 4, calls: 3, heat: 17 });
    expect(zoneStats(d, { ...base, className: "Mage" }).find((z) => z.zone?.id === 1434)).toMatchObject({ kills: 8, deaths: 3 });
    expect(zoneStats(d, { ...base, band: { key: "40-59", from: 40, to: 59 } }).find((z) => z.zone?.id === 1434)).toMatchObject({ kills: 5, deaths: 1 });
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
      battlegroundReport: { findMany: record("battlegroundReport", []) }, guildHelpCall: { findMany: record("guildHelpCall", []) }, character: { findMany: record("character", []) },
      worldPvpEvent: { findMany: record("worldPvpEvent", []), groupBy: record("worldPvpEvent.groups", []) }
    };
    expect(await loadPvpData(database as never, [], "forever", NOW)).toMatchObject({ week: [], games: [] });
    expect(calls).toHaveLength(0);
    await loadPvpData(database as never, ["g1"], "forever", NOW);
    expect(calls.map((c) => c.table).sort()).toEqual(["battlegroundReport", "guildHelpCall", "worldPvpEvent", "worldPvpEvent.groups", "worldPvpWeek", "worldPvpWeek.total"]);
    for (const call of calls) {
      expect(call.where["guildId"]).toEqual({ in: ["g1"] });
      expect(call.where["member"]).toEqual({ status: { in: ["ACTIVE", "TRIAL"] }, isTest: false, raceHidden: false });
    }
  });
});

describe("PvP leaderboards: review fixes", () => {
  const fakeDb = (weekRows: unknown[], totalRows: unknown[], characters: unknown[], reports: unknown[] = []) => ({
    worldPvpWeek: { findMany: async () => weekRows, groupBy: async () => totalRows }, battlegroundReport: { findMany: async () => reports }, guildHelpCall: { findMany: async () => [] }, character: { findMany: async () => characters }, worldPvpEvent: { findMany: async () => [], groupBy: async () => [] }
  });
  it("keeps every world PvP row (more than 300), so a small guild and a low-ranked player are still counted", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ memberId: `m${i}`, guildId: "g1", kills: 500 - i, deaths: 1, defends: 0, helped: 0 }));
    rows.push({ memberId: "small", guildId: "g2", kills: 1, deaths: 0, defends: 0, helped: 0 });
    const total = rows.map((r) => ({ memberId: r.memberId, guildId: r.guildId, _sum: { kills: r.kills, deaths: r.deaths, defends: 0, helped: 0 } }));
    const chars = rows.map((r, i) => ({ memberId: r.memberId, name: `Player${i}`, displayName: null, realm: "Doomhowl", className: "Mage", level: 60 }));
    const loaded = await loadPvpData(fakeDb(rows, total, chars) as never, ["g1", "g2"], "forever", NOW);
    expect(loaded.week).toHaveLength(401);
    expect(guildPvp(loaded, "g2").week.kills).toBe(1);
    expect(playerPvp(loaded, "Player399", "Doomhowl").week?.kills).toBe(101);
    expect(worldBoard(loaded, { className: null, band: null, period: "week", mode: null }).kills).toBe(rows.reduce((n, r) => n + r.kills, 0));
  });

  it("turns uploaded kills and deaths into exact zone counts and positioned dots, lights the map by kills plus deaths, and drops hidden members' rows in the query", async () => {
    const week = weekKeyOf(NOW);
    const groups = [
      { memberId: "a", guildId: "g1", mapId: 1434, kind: "kill", weekKey: week, _count: { _all: 8 } },
      { memberId: "a", guildId: "g1", mapId: 1434, kind: "death", weekKey: week, _count: { _all: 3 } },
      { memberId: "a", guildId: "g1", mapId: 1411, kind: "kill", weekKey: week, _count: { _all: 2 } },
      { memberId: "a", guildId: "g1", mapId: 99999, kind: "kill", weekKey: week, _count: { _all: 1 } }
    ];
    const rows = [{ memberId: "a", guildId: "g1", kind: "kill", weekKey: week, at: NOW, mapId: 1434, x: 0.4, y: 0.6, approx: false }, { memberId: "a", guildId: "g1", kind: "death", weekKey: week, at: NOW, mapId: 1434, x: 0.45, y: 0.65, approx: true }, { memberId: "b", guildId: "g1", kind: "kill", weekKey: week, at: NOW, mapId: 1434, x: 0.401, y: 0.604, approx: false }, { memberId: "c", guildId: "g1", kind: "kill", weekKey: week, at: NOW, mapId: 1434, x: 0.9, y: 0.1, approx: false }];
    const chars = [{ memberId: "a", name: "Dara", displayName: null, realm: "Doomhowl", className: "Rogue", level: 60 }];
    const seen: Record<string, unknown>[] = [];
    const database = { worldPvpWeek: { findMany: async () => [], groupBy: async () => [] }, battlegroundReport: { findMany: async () => [] }, guildHelpCall: { findMany: async () => [] }, character: { findMany: async () => chars },
      worldPvpEvent: { groupBy: async (args: Record<string, unknown>) => { seen.push(args); return groups; }, findMany: async (args: Record<string, unknown>) => { seen.push(args); return rows; } } };
    const loaded = await loadPvpData(database as never, ["g1"], "forever", NOW);
    expect(seen.every((a) => JSON.stringify(a["where"]).includes('"isTest":false'))).toBe(true);
    // hidden and test members are left out, and an event is public only after six hours
    expect(seen.every((a) => JSON.stringify(a["where"]).includes('"raceHidden":false'))).toBe(true);
    const eventQuery = seen.find((a) => (a["where"] as Record<string, unknown>)["x"]) as { where: { at: { lt: Date } } };
    expect(eventQuery.where.at.lt.getTime()).toBe(NOW.getTime() - 6 * 3_600_000);
    const f = { className: null, band: null, period: "week" as const, mode: null };
    const stats = zoneStats(loaded, f);
    expect(stats.find((z) => z.zone?.id === 1434)).toMatchObject({ kills: 8, deaths: 3, heat: 11 });
    expect(stats.find((z) => z.zone?.id === 1434)!.dots.map((d) => d.kind).sort()).toEqual(["death", "kill", "kill"]);
    // coordinates are rounded to 1% of the zone
    expect(stats.find((z) => z.zone?.id === 1434)!.dots.every((d) => Math.abs(d.x * 100 - Math.round(d.x * 100)) < 1e-9)).toBe(true);
    // a filter that leaves fewer than three members keeps the heat but draws no point
    const few = zoneStats({ ...loaded, events: loaded.events!.slice(0, 2) }, f).find((z) => z.zone?.id === 1434)!;
    expect(few.dots).toEqual([]); expect(few.kills + few.deaths).toBe(11);
    expect(stats.find((z) => z.zone === null)).toMatchObject({ kills: 1 });
    expect(zoneStats(loaded, { ...f, className: "Mage" }).find((z) => z.zone?.id === 1434)).toMatchObject({ kills: 0, deaths: 0 });
    const { get } = setup(async () => loaded);
    const res = await get("/leaderboards/pvp/");
    expect(res.body).toContain("Colour shows: kills plus deaths");
    expect(res.body).toContain("8 kills · 3 deaths");
    expect(res.body).toMatch(/class="ev kill" cx=/);
    expect(res.body).toMatch(/class="ev death approx" cx=/);
    expect(res.body).toContain("Blue dots: deaths.");
  });

  it("counts one battleground once however many guildmates reported it", () => {
    const shared = { matchKey: "g1|489|casual|nonce-1" };
    const d: PvpData = { ...data(), games: ["Dara", "Corvin", "Edda", "Fenn", "Gus"].map((n) => game(n, "Mage", "win", 1, shared)).concat([game("Dara", "Mage", "loss", 5)]) };
    const f = { className: null, band: null, period: "week" as const, mode: null };
    const board = bgBoard(d, f);
    expect(board.games).toBe(2);
    expect(board.byMap.find((m) => m.mapId === 489)).toMatchObject({ games: 2, wins: 1 });
    expect(board.rows.find((r) => r.name === "Dara")).toMatchObject({ games: 2, wins: 1, losses: 1 });
    expect(guildPvp(d, "g1")).toMatchObject({ games: 2, wins: 1 });
  });

  it("builds the match key from the premade id, else guild, map, mode and the end time to ten minutes", async () => {
    const report = (nonce: string | null, minutes: number) => ({ guildId: "g1", mode: "casual", bracket: "60", mapId: 489, outcome: "win", endedAt: new Date(NOW.getTime() - minutes * 60_000), premadeNonce: nonce, character: { name: "Dara", displayName: null, realm: "Doomhowl", className: "Rogue", level: 60 } });
    const loaded = await loadPvpData(fakeDb([], [], [], [report("n1", 60), report("n1", 61), report(null, 120), report(null, 121)]) as never, ["g1"], "forever", NOW);
    const keys = loaded.games.map((g) => g.matchKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).toBe(keys[3]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("shows one row for a person in two public guilds, with the sums, and matches players by full name and realm", async () => {
    const week = [{ memberId: "a", guildId: "g1", kills: 5, deaths: 1, defends: 0, helped: 0 }, { memberId: "b", guildId: "g2", kills: 7, deaths: 2, defends: 0, helped: 0 }];
    const chars = [{ memberId: "a", name: "Dara", displayName: null, realm: "Doomhowl", className: "Rogue", level: 60 }, { memberId: "b", name: "Dara", displayName: null, realm: "Doomhowl", className: "Rogue", level: 60 }];
    const loaded = await loadPvpData(fakeDb(week, [], chars) as never, ["g1", "g2"], "forever", NOW);
    expect(loaded.week).toHaveLength(1);
    expect(loaded.week[0]).toMatchObject({ kills: 12, deaths: 3 });
    expect(playerPvp(data(), "Dar", "Doomhowl").week).toBeNull();
    expect(playerPvp(data(), "Dara", "Elsewhere").week).toBeNull();
  });

  it("uses the same window for the three guild tiles", async () => {
    const mine = guildPvp(data(), "g1");
    expect(mine.week).toMatchObject({ kills: 82, deaths: 19 });
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/guild/quebec-gold");
    expect(res.body).toContain("K/D this week");
  });

  it("a player with PvP but no public dungeon run still has a character page", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/character/Edda-Doomhowl");
    expect(res.status).toBe(200);
    expect(res.body).toContain("12");
    expect(res.body).toContain("PvP leaderboards");
    expect((await get("/leaderboards/character/Nobody-Doomhowl")).status).toBe(404);
  });

  it("a PvP load failure hides the PvP cards and does not break the hub", async () => {
    const { get } = setup(async () => { throw new Error("database down"); });
    const hub = await get("/leaderboards/");
    expect(hub.status).toBe(200);
    expect(hub.body).not.toContain("Latest battlegrounds");
  });
});

describe("PvP leaderboards: pages", () => {
  it("shows the PvP tab with world PvP, hot zones, the battleground ladder, results and a link to the duel ladder", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/");
    expect(res.status).toBe(200);
    for (const text of ["World PvP", "Zone map", "Battleground ladder", "Latest results", "Warsong Gulch", "Stranglethorn Vale", "Dara", "Corvin", "K/D", "Kills this week"]) expect(res.body).toContain(text);
    expect(res.body).toMatch(/href="[^"]*\/leaderboards\/duels\//);
    expect(res.body).toContain('class="on" aria-current="page"');
    expect(res.body).not.toMatch(/<script|onchange=|onclick=/i);
    const main = res.body.slice(res.body.indexOf('class="hub-tabs"'), res.body.indexOf("<footer"));
    expect(main.length).toBeGreaterThan(500);
    expect(main).not.toMatch(/discord|confirm|evidence|verif|limit|checked|cap\b/i);
  });

  it("draws the zone map as links with no script: one marker per lit zone, a details panel, the numbers in a plain table", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/");
    const main = res.body.slice(res.body.indexOf('id="zone-map"'), res.body.indexOf("<footer"));
    expect(main).toContain("<svg");
    expect(main).toContain('href="#zone-1434"');
    expect(main).toContain('id="zone-1434"');
    expect(main).toContain("3 calls for help");
    expect(main).toContain("Most active guilds");
    expect(main).not.toContain("Booty Bay");
    expect(main).not.toContain("Recent calls");
    expect(main).not.toMatch(/class="ev /);
    expect(main).toContain("never by position");
    expect(main).toContain("Colour shows: calls for help");
    expect(main).not.toMatch(/<script|onclick=|onmouseover=|javascript:/i);
    expect(main).toContain("<table");
    // each zone's number on the map equals the cell of its table row
    const onMap = new Map([...main.matchAll(/href="#zone-(\d+)" data-heat="(\d+)"/g)].map((m) => [m[1]!, Number(m[2])]));
    const rows = new Map([...main.matchAll(/<tr><td><a href="#zone-(\d+)">[^<]*<\/a><\/td>.*?<td class="num score">(\d+)<\/td>/g)].map((m) => [m[1]!, Number(m[2])]));
    expect(onMap.size).toBe(2);
    expect(rows).toEqual(onMap);
    expect(onMap.get("1434")).toBe(3);
    expect(main).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(main).not.toContain("<script>alert");
    expect(main).not.toContain('href="#zone-1446"');
    const old = await get("/leaderboards/pvp/?period=all");
    expect(old.body).toContain('href="#zone-1446"');
    expect(old.body).toContain("last 4 weeks");
    const fr = await get("/leaderboards/pvp/", "fr");
    expect(fr.body).toContain("3 appels à l&#39;aide");
    expect(fr.body).not.toContain("Colour shows");
  });

  it("draws zone outlines, cities, the 2:3 crop, an enlarged city target and the sea under any painting", async () => {
    const d: PvpData = { ...data(), calls: [...data().calls, { guildId: "g1", zone: "Stormwind City", mapId: 1453, calledAt: NOW }, { guildId: "g1", zone: "Orgrimmar", mapId: 1454, calledAt: NOW }] };
    const { get } = setup(async () => d);
    const main = (await get("/leaderboards/pvp/")).body;
    const svgs = [...main.matchAll(/<svg viewBox="([\d. -]+)"/g)].map((m) => m[1]!.split(" ").map(Number));
    expect(svgs.length).toBe(2);
    for (const [, , w, h] of svgs) expect(w! / h!).toBeCloseTo(2 / 3, 1);
    for (const continent of ["kalimdor", "eastern"] as const) {
      const v = continentView(continent);
      for (const zone of PVP_ZONES.filter((z) => z.continent === continent)) { const b = zoneBox(zone.id)!; expect(b.x).toBeGreaterThanOrEqual(v.x); expect(b.x + b.w).toBeLessThanOrEqual(v.x + v.w); expect(b.y).toBeGreaterThanOrEqual(v.y); expect(b.y + b.h).toBeLessThanOrEqual(v.y + v.h); }
    }
    expect(main).toMatch(/<path class="r"[^>]*fill-rule="evenodd"/);
    expect(main).toContain('class="sea"');
    expect(main).toContain('href="#zone-1453"');
    expect(main).toContain('href="#zone-1454"');
    expect(main).toMatch(/<a class="z h\d" href="#zone-1453"[^>]*><rect class="hit"/);
    // the biggest zones come first, so a city or small zone drawn later stays on top of them
    expect(main.indexOf('href="#zone-1434"')).toBeLessThan(main.indexOf('href="#zone-1453"'));
    for (const id of Object.keys(ZONE_SHAPES)) expect(ZONE_RECTS[Number(id)], id).toBeDefined();
    expect(Object.keys(ZONE_SHAPES).length).toBeGreaterThan(30);
  });

  it("draws a kill or death point only on the zone it was recorded on", () => {
    const f = { className: null, band: null, period: "week" as const, mode: null };
    const stats = zoneStats(data(), f);
    stats.find((z) => z.zone?.id === 1434)!.dots.push({ mapId: 1434, x: 0.5, y: 0.5, kind: "kill" }, { mapId: 1411, x: 0.5, y: 0.5, kind: "death" });
    const env = { t: (en: string) => en, lang: "en", edition: "forever", duelsOpen: false, table: () => "", person: () => "", guild: () => "", classLabel: (n: string) => n, classSlug: (n: string | null) => n ?? "" };
    const html = zoneMapHtml(env as never, stats, f);
    expect(html.match(/class="ev kill"/g)?.length).toBe(1);
    expect(html).not.toContain('class="ev death"');
  });

  it("logs an unknown zone map id once and remembers at most 200 of them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const many = Array.from({ length: 300 }, (_, i) => ({ guildId: "g1", zone: `Z${i}`, mapId: 90_000 + i, calledAt: NOW }));
    const db = { worldPvpWeek: { findMany: async () => [], groupBy: async () => [] }, worldPvpEvent: { findMany: async () => [], groupBy: async () => [] }, battlegroundReport: { findMany: async () => [] }, character: { findMany: async () => [] }, guildHelpCall: { findMany: async () => many } };
    await loadPvpData(db as never, ["g1"], "forever", NOW);
    await loadPvpData(db as never, ["g1"], "forever", NOW);
    const logged = warn.mock.calls.filter((c) => String(c[0]).includes("unknown zone map id")).length;
    expect(logged).toBeGreaterThan(0); expect(logged).toBeLessThanOrEqual(200);
    warn.mockRestore();
  });

  it("only points at a painting that exists in the site folder", () => {
    for (const [continent, image] of Object.entries(CONTINENT_IMAGES)) if (image) expect(existsSync(`site${image}`), continent).toBe(true);
  });

  it("keeps a visible keyboard focus ring and a tooltip that fits the map for the longest French zone name", async () => {
    const d: PvpData = { ...data(), calls: PVP_ZONES.map((z) => ({ guildId: "g1", zone: z.fr, mapId: z.id, calledAt: NOW })) };
    const { get } = setup(async () => d);
    const main = (await get("/leaderboards/pvp/", "fr")).body;
    expect(main).toContain("a.z:focus-visible .r{");
    const view = main.match(/<svg viewBox="([\d. -]+)"/)![1]!.split(" ").map(Number);
    for (const m of main.matchAll(/<g class="tip"[^>]*><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(view[0]!); expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(view[0]! + view[2]! + 0.5);
    }
  });

  it("is served in French", async () => {
    const { get } = setup(async () => data());
    const res = await get("/leaderboards/pvp/", "fr");
    expect(res.status).toBe(200);
    for (const text of ["PvP mondial", "Carte des zones", "Vallée de Strangleronce", "Classement des champs de bataille", "Derniers résultats", "Goulet des Chanteguerres", "Victimes", "Classement des duels"]) expect(res.body).toContain(text);
    expect(res.body).not.toContain("Zone map");
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
