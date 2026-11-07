import { describe, expect, it, vi } from "vitest";
import { exportWorldPvp } from "../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import {
  REPEAT_VICTIM_LIMIT, WEEKLY_KILL_CAP, applyWorldPvpUpload, cappedCounts, parseWorldPvpUpload, weekKeyOf, weekRange,
  worldPvpCard, worldPvpEmbed, worldPvpStandings
} from "../src/services/world-pvp.js";

// World PvP board (docs/WORLD_PVP.md stages 2 and 3).
const NOW = new Date("2026-11-11T12:00:00Z"); // a Wednesday, the day after the Tuesday reset
const KEY = weekKeyOf(NOW);
const inWeek = (hours: number) => Math.floor(weekRange(KEY).from.getTime() / 1000) + hours * 3600;

describe("weeks", () => {
  it("start on Tuesday 15:00 UTC, like the addon", () => {
    const { from, to } = weekRange(KEY);
    expect(from.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);
    expect(weekKeyOf(new Date("2026-11-10T14:59:59Z"))).toBe(KEY - 1);
    expect(weekKeyOf(new Date("2026-11-10T15:00:00Z"))).toBe(KEY);
  });
});

describe("anti-farming caps", () => {
  const base = { kills: 50, defends: 10, responded: 8, recent: [] as { n: string; at: number }[] };
  it("passes honest numbers through", () => {
    expect(cappedCounts(base, 20)).toEqual({ kills: 50, defends: 8, helped: 8 });
  });
  it("caps weekly kills", () => {
    expect(cappedCounts({ ...base, kills: 5000 }, 20).kills).toBe(WEEKLY_KILL_CAP);
  });
  it("takes off kills of one victim beyond the repeat limit", () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({ n: i % 2 ? "Thug" : "thug", at: 1 }));
    expect(cappedCounts({ ...base, recent }, 20).kills).toBe(50 - (8 - REPEAT_VICTIM_LIMIT));
  });
  it("limits calls answered to calls other guildmates made, and defends to calls answered", () => {
    expect(cappedCounts(base, 3)).toEqual({ kills: 50, defends: 3, helped: 3 });
    expect(cappedCounts(base, 0)).toEqual({ kills: 50, defends: 0, helped: 0 });
  });
  it("never counts more defends than kills", () => {
    expect(cappedCounts({ ...base, kills: 2, defends: 9, responded: 9 }, 50).defends).toBe(2);
  });
});

describe("upload parsing", () => {
  it("takes the first valid block and drops malformed ones", () => {
    expect(parseWorldPvpUpload([{ weekKey: "x" }, { weekKey: KEY, kills: 3, defends: 1, responded: 1, recent: [] }])?.kills).toBe(3);
    expect(parseWorldPvpUpload([{ weekKey: KEY, kills: -1, defends: 0, responded: 0 }])).toBeNull();
    expect(parseWorldPvpUpload("nope")).toBeNull();
  });
  it("is accepted by the addon snapshot schema and exported from the saved variables", () => {
    const exported = exportWorldPvp({ worldPvp: { weekKey: KEY, week: { kills: 4, defends: 1, responded: 2, deaths: 9 },
      recent: { 1: { n: "Thu|g", at: inWeek(1), d: 1 }, 2: { n: "", at: inWeek(2) }, 3: { n: "Old", at: 5 } } } });
    expect(exported.worldPvp).toEqual([{ weekKey: KEY, kills: 4, defends: 1, responded: 2, recent: [{ n: "Thu g", at: inWeek(1), d: 1 }] }]);
    expect(JSON.stringify(exported)).not.toContain("deaths");
    expect(exportWorldPvp({})).toEqual({});
    expect(exportWorldPvp({ worldPvp: { weekKey: KEY, week: { kills: 0 } } })).toEqual({});
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW.toISOString(), ...exported });
    expect(parseWorldPvpUpload(snapshot.worldPvp)?.responded).toBe(2);
  });
});

function fakeDb(options: { enabled?: boolean; calls?: number; existing?: { kills: number; defends: number; helped: number } | null; guild?: string } = {}) {
  const rows: Record<string, unknown>[] = [];
  const upsert = vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { rows.push(options.existing ? update : create); });
  return {
    rows, upsert,
    db: {
      guildSettings: { findUnique: vi.fn(async () => ({ worldPvpEnabled: options.enabled ?? true })) },
      member: { findUnique: vi.fn(async () => ({ guildId: options.guild ?? "g1" })) },
      guildHelpCall: { count: vi.fn(async () => options.calls ?? 10) },
      worldPvpWeek: { findUnique: vi.fn(async () => options.existing ?? null), upsert }
    } as never
  };
}
const upload = (extra: Record<string, unknown> = {}) => parseWorldPvpUpload([{ weekKey: KEY, kills: 12, defends: 2, responded: 3, recent: [{ n: "Thug", at: inWeek(2) }], ...extra }]);

describe("applying an upload", () => {
  it("stores the capped week", async () => {
    const f = fakeDb();
    expect(await applyWorldPvpUpload(f.db, "g1", "m1", upload(), NOW)).toBe(true);
    expect(f.rows[0]).toMatchObject({ weekKey: KEY, kills: 12, defends: 2, helped: 3 });
  });
  it("only raises numbers and skips a repeat upload", async () => {
    const same = fakeDb({ existing: { kills: 12, defends: 2, helped: 3 } });
    expect(await applyWorldPvpUpload(same.db, "g1", "m1", upload(), NOW)).toBe(false);
    const higher = fakeDb({ existing: { kills: 20, defends: 0, helped: 3 } });
    expect(await applyWorldPvpUpload(higher.db, "g1", "m1", upload(), NOW)).toBe(true);
    expect(higher.rows[0]).toMatchObject({ kills: 20, defends: 2, helped: 3 });
  });
  it("refuses a future week, an old week, another guild's member and a server with the board off", async () => {
    expect(await applyWorldPvpUpload(fakeDb().db, "g1", "m1", upload({ weekKey: KEY + 1 }), NOW)).toBe(false);
    expect(await applyWorldPvpUpload(fakeDb().db, "g1", "m1", upload({ weekKey: KEY - 2 }), NOW)).toBe(false);
    expect(await applyWorldPvpUpload(fakeDb({ guild: "other" }).db, "g1", "m1", upload(), NOW)).toBe(false);
    expect(await applyWorldPvpUpload(fakeDb({ enabled: false }).db, "g1", "m1", upload(), NOW)).toBe(false);
    expect(await applyWorldPvpUpload(fakeDb().db, "g1", "m1", null, NOW)).toBe(false);
  });
  it("counts no helped or defends when nobody in the guild called", async () => {
    const f = fakeDb({ calls: 0 });
    await applyWorldPvpUpload(f.db, "g1", "m1", upload(), NOW);
    expect(f.rows[0]).toMatchObject({ kills: 12, defends: 0, helped: 0 });
  });
});

describe("board", () => {
  const names = new Map([["a", "Dude Lebowski"], ["b", "Walter Sobchak"], ["c", "Donny"]]);
  const standings = worldPvpStandings([
    { memberId: "a", kills: 5, defends: 1, helped: 2 }, { memberId: "b", kills: 5, defends: 3, helped: 0 },
    { memberId: "c", kills: 0, defends: 0, helped: 0 }, { memberId: "gone", kills: 1, defends: 0, helped: 0 }
  ], names);
  const data = { weekKey: KEY, standings };

  it("ranks by kills, then defends, then calls answered, and leaves out empty rows", () => {
    expect(standings.map(s => s.name)).toEqual(["Walter Sobchak", "Dude Lebowski", "?"]);
  });
  it("draws the shared ladder layout and never shows deaths", () => {
    const card = worldPvpCard(data, "en", new Map(), NOW);
    expect(card.ladder?.columns.map(c => c.label)).toEqual(["Kills", "Def.", "Helped"]);
    expect(card.ladder?.boards[0]?.rows[0]).toMatchObject({ rank: 1, name: "Walter Sobchak", values: ["5", "3", "0"] });
    expect(JSON.stringify(card).toLowerCase()).not.toContain("death");
    expect(worldPvpCard(data, "fr", new Map(), NOW).title).toBe("JcJ en monde ouvert");
  });
  it("has an embed with a text table, or with the card image, or an empty note", () => {
    const text = worldPvpEmbed(data, "en", "g1").toJSON();
    expect(text.fields?.[0]?.value).toContain("Walter Sobchak — 5 kills · 3 defends · 0 answered");
    const withImage = worldPvpEmbed(data, "en", "g1", "world-pvp.png").toJSON();
    expect(withImage.image?.url).toBe("attachment://world-pvp.png");
    expect(withImage.fields).toBeUndefined();
    expect(worldPvpEmbed({ weekKey: KEY, standings: [] }, "fr", "g1").toJSON().description).toContain("Aucune activité");
    expect(text.footer?.text).toContain("Guilded world PvP");
  });
});
