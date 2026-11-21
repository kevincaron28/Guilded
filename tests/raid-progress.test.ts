/* eslint-disable @typescript-eslint/no-explicit-any -- minimal in-memory database fakes */
import { describe, expect, it, vi } from "vitest";
import { applyRaidKills, buildRaidBoard, checkRaidKill, parseRaidKills, raidBoardBody, raidBoardJson, RAIDS_OPEN_AT, type BoardGuild, type BoardKill, type RaidKillUpload } from "../src/services/raid-progress.js";
import { exportRaidKills } from "../companion/lua-export-content.mjs";

const NOW = new Date("2026-12-10T12:00:00Z");
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const kill = (over: Partial<RaidKillUpload> = {}): RaidKillUpload => ({ ref: "RK-1", instanceId: 9001, instance: "Test Raid", encounterId: 1, boss: "Boss One", difficultyId: 14, groupSize: 10, guildCount: 9,
  guildNames: ["Alice", "Bea"], at: at("2026-12-10T10:00:00Z"), ...over });

describe("raid kill checks", () => {
  it("accepts a guild raid and refuses pugs, future and stale kills", () => {
    expect(checkRaidKill(kill(), NOW, "member").ok).toBe(true);
    expect(checkRaidKill(kill({ guildCount: 3 }), NOW, "member")).toEqual({ ok: false, reason: "not-guild-raid" });
    expect(checkRaidKill(kill({ guildCount: 11 }), NOW, "member")).toEqual({ ok: false, reason: "not-guild-raid" });
    expect(checkRaidKill(kill({ at: at("2026-12-11T10:00:00Z") }), NOW, "member")).toEqual({ ok: false, reason: "future" });
    expect(checkRaidKill(kill({ at: at("2026-09-01T10:00:00Z") }), NOW, "member")).toEqual({ ok: false, reason: "old" });
  });
  it("lets an unsigned device speak only for a kill its own character was in", () => {
    expect(checkRaidKill(kill(), NOW, "device", new Set(["alice"])).ok).toBe(true);
    expect(checkRaidKill(kill(), NOW, "device", new Set(["stranger"]))).toEqual({ ok: false, reason: "reporter-not-in-kill" });
  });
  it("drops malformed rows one by one", () => {
    expect(parseRaidKills([kill(), { ref: "x" }, null, kill({ ref: "RK-2" })])).toHaveLength(2);
  });
});

describe("raid board", () => {
  const guilds = new Map<string, BoardGuild>([["a", { id: "a", name: "Alpha", slug: "alpha" }], ["b", { id: "b", name: "Beta", slug: null }]]);
  const row = (guildId: string, encounterId: number, iso: string, reporters = 1): BoardKill => ({ guildId, instanceId: 9001, instanceName: "Test Raid", encounterId, bossName: `Boss ${encounterId}`,
    difficultyId: 14, difficultyName: "Normal", killedAt: new Date(iso), reporters });
  it("ranks by bosses, then the earlier last kill, and finds the first kill of each boss", () => {
    const board = buildRaidBoard([row("a", 1, "2026-12-09T20:00:00Z"), row("a", 2, "2026-12-10T20:00:00Z"), row("b", 1, "2026-12-09T19:00:00Z"), row("b", 2, "2026-12-10T19:00:00Z"),
      row("b", 2, "2026-12-11T19:00:00Z"), row("zzz", 3, "2026-12-09T10:00:00Z")], guilds);
    expect(board.rows.map((r) => [r.guild.name, r.bosses])).toEqual([["Beta", 2], ["Alpha", 2]]);
    expect(board.firsts.map((f) => [f.encounterId, f.guild.name])).toEqual([[1, "Beta"], [2, "Beta"]]);
    expect(board.rows[0]!.worldFirsts).toBe(2);
    expect(board.totalKills).toBe(5);
  });
  it("shows the Raids open 9 December empty state before and after the opening, in both languages", () => {
    const empty = buildRaidBoard([], guilds);
    const en = raidBoardBody(empty, { t: (e) => e, lang: "en", now: new Date("2026-11-20T00:00:00Z") });
    expect(en).toContain("Raids open 9 December");
    const fr = raidBoardBody(empty, { t: (_e, f) => f, lang: "fr", now: new Date("2026-11-20T00:00:00Z") });
    expect(fr).toContain("Les raids ouvrent le 9 décembre");
    expect(raidBoardBody(empty, { t: (e) => e, lang: "en", now: NOW })).toContain("No raid kill has been recorded yet");
    expect(raidBoardJson(empty, new Date("2026-11-20T00:00:00Z"))).toMatchObject({ open: false, opensAt: RAIDS_OPEN_AT.toISOString(), guilds: [], firsts: [] });
  });
  it("renders escaped names", () => {
    const evil = new Map<string, BoardGuild>([["a", { id: "a", name: "<b>x</b>", slug: null }]]);
    expect(raidBoardBody(buildRaidBoard([row("a", 1, "2026-12-09T20:00:00Z")], evil), { t: (e) => e, lang: "en", now: NOW })).not.toContain("<b>x</b>");
  });
});

describe("applying kills", () => {
  function fakeDb() {
    const rows: any[] = [];
    const db = { raidKill: {
      count: async () => rows.length,
      findFirst: async ({ where }: any) => rows.find((r) => r.guildId === where.guildId && r.encounterId === where.encounterId && r.killedAt >= where.killedAt.gte && r.killedAt <= where.killedAt.lte) ?? null,
      update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; r.reporters += data.reporters.increment; },
      create: async ({ data }: any) => { rows.push({ id: `id${rows.length}`, reporters: 1, ...data }); }
    } };
    return { db: db as any, rows };
  }
  it("stores a kill once, counts another member's report as a witness, and is idempotent", async () => {
    const { db, rows } = fakeDb();
    expect(await applyRaidKills(db, { guildId: "g", trust: "member", kills: [kill()], now: NOW })).toMatchObject({ stored: 1 });
    expect(await applyRaidKills(db, { guildId: "g", trust: "member", kills: [kill()], now: NOW })).toMatchObject({ stored: 0, confirmed: 0 });
    expect(await applyRaidKills(db, { guildId: "g", trust: "member", kills: [kill({ at: at("2026-12-10T10:00:20Z") })], now: NOW })).toMatchObject({ confirmed: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reporters).toBe(2);
  });
  it("refuses a pug raid", async () => {
    const { db, rows } = fakeDb();
    expect(await applyRaidKills(db, { guildId: "g", trust: "member", kills: [kill({ guildCount: 3 })], now: NOW })).toMatchObject({ stored: 0, refused: 1 });
    expect(rows).toHaveLength(0);
  });
});

describe("companion export", () => {
  it("whitelists the addon's kills and drops malformed rows", () => {
    const rows = exportRaidKills({ raidProgress: { kills: {
      a: { ref: "RK-1", instanceId: 9001, instance: "Test Raid", encounterId: 1, boss: "B|oss", difficultyId: 14, groupSize: 10, guildCount: 9, guildNames: ["Alice"], at: 1800000000, durationSec: 300, extra: "x" },
      b: { ref: "bad" } } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("extra");
    expect(rows[0]!.boss).toBe("B oss");
  });
});

describe("raid board wiring", () => {
  it("is in the hub tabs and the Worker forwards its page and JSON to the bot", async () => {
    const { hubTabs } = await import("../src/services/leaderboard-hub.js");
    expect(hubTabs((e: string) => e, "en", "raids")).toContain("/leaderboards/raids/");
    const worker = (await import("../worker/index.mjs")).default;
    const upstream = vi.fn(async () => new Response("ok", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", upstream);
    for (const path of ["/forever/leaderboards/raids/", "/forever/leaderboards/raids.json"]) {
      await worker.fetch(new Request(`https://guilded.kcaron.top${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: vi.fn(async () => new Response("website")) } });
      expect(String((upstream.mock.calls.at(-1) as unknown[])[0])).toContain(path.replace("/forever", ""));
    }
    vi.unstubAllGlobals();
  });
  it("is a static sitemap page", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('"leaderboards/raids/"');
  });
});
