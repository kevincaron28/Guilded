import { describe, expect, it } from "vitest";
import { applyPvpEvents, parsePvpEvents, purgeOldPvpEvents, PVP_EVENTS_MAX, PVP_EVENTS_PER_MEMBER } from "../src/services/world-pvp-events.js";
import { COMPANION_FEATURES } from "../src/services/standings-feed.js";
import { addonSnapshotSchema } from "../src/integrations/addon.js";

const NOW = new Date("2026-12-10T20:00:00Z");
const t0 = Math.floor(NOW.getTime() / 1000) - 600;

/** Adds the transaction plumbing a fake needs: the callback runs against the fake itself, and the advisory lock is recorded. */
const locks: string[] = [];
const tx = (db: Record<string, unknown>) => ({ $transaction: async (fn: (t: unknown) => unknown) => fn(db), $executeRaw: async (_s: TemplateStringsArray, ...v: unknown[]) => { locks.push(String(v[0])); return []; } });

describe("pvp-events import", () => {
  it("is advertised to the companion", () => { expect(COMPANION_FEATURES).toContain("pvp-events"); });

  it("keeps valid rows, drops malformed and future ones, and takes a position only when both coordinates are given", () => {
    const rows = parsePvpEvents([
      { k: "kill", t: t0, m: 1434, s: 11, x: 0.3123, y: 0.8 },
      { k: "death", t: t0 + 5, m: 1434, s: 12, x: 0.5 },
      { k: "death", t: t0 + 9, m: 1411, s: 13, x: 0.1, y: 0.2, a: 1 },
      { k: "kill", t: t0, m: 1434, s: 14, x: 1.5, y: 0.2 },
      { k: "assist", t: t0, m: 1434, s: 15 },
      { k: "kill", t: Math.floor(NOW.getTime() / 1000) + 86_400, m: 1434, s: 16 },
      { k: "kill", t: t0, m: 0, s: 17 },
      "junk", null
    ], NOW);
    expect(rows.map((r) => r.eventId)).toEqual([11, 12, 13]);
    expect(rows[0]).toMatchObject({ kind: "kill", mapId: 1434, x: 0.3123, y: 0.8, approx: false });
    expect(rows[1]).toMatchObject({ x: null, y: null, approx: false });
    expect(rows[2]).toMatchObject({ approx: true });
    expect(parsePvpEvents("nope", NOW)).toEqual([]);
  });

  it("reads at most 500 rows of an upload", () => {
    const many = Array.from({ length: 800 }, (_, i) => ({ k: "kill", t: t0, m: 1434, s: i + 1 }));
    expect(parsePvpEvents(many, NOW)).toHaveLength(PVP_EVENTS_MAX);
  });

  it("stores rows once (a resent upload changes nothing) and forgets what is older than five weeks", async () => {
    const calls: { create?: { data: unknown[]; skipDuplicates?: boolean }; del?: { where: Record<string, unknown> } } = {};
    const db = { worldPvpEvent: {
      createMany: async (args: { data: unknown[]; skipDuplicates?: boolean }) => { calls.create = args; return { count: 1 }; },
      deleteMany: async (args: { where: Record<string, unknown> }) => { calls.del = args; return { count: 0 }; },
      count: async () => 0
    } } as Record<string, unknown>;
    Object.assign(db, tx(db));
    expect(await applyPvpEvents(db as never, "g1", "m1", [], NOW)).toBe(0);
    expect(calls.create).toBeUndefined();
    const created = await applyPvpEvents(db as never, "g1", "m1", parsePvpEvents([{ k: "kill", t: t0, m: 1434, s: 5, x: 0.5, y: 0.5 }], NOW), NOW);
    expect(created).toBe(1);
    expect(calls.create?.skipDuplicates).toBe(true);
    expect(calls.create?.data[0]).toMatchObject({ guildId: "g1", memberId: "m1", kind: "kill", mapId: 1434, eventId: 5 });
    expect(calls.del?.where).toMatchObject({ guildId: "g1", memberId: "m1" });
  });

  it("is carried by the snapshot schema and defaults to none for an older companion", () => {
    expect(addonSnapshotSchema.shape.pvpEvents.parse(undefined)).toEqual([]);
    expect(addonSnapshotSchema.shape.pvpEvents.safeParse(new Array(501).fill({})).success).toBe(false);
  });

  it("at the per-member cap the oldest rows make room for the new ones, under a per-member lock, and never stores rows older than 35 days", async () => {
    let created: { eventId: number }[] = []; let deleted: unknown = null; let stored = PVP_EVENTS_PER_MEMBER - 2;
    const db: Record<string, unknown> = { worldPvpEvent: {
      deleteMany: async (a: { where: Record<string, unknown> }) => { if (a.where["id"]) deleted = a.where["id"]; return { count: 0 }; },
      createMany: async (a: { data: { eventId: number }[] }) => { created = a.data; stored += a.data.length; return { count: a.data.length }; },
      count: async () => stored,
      findMany: async (a: { take: number; orderBy: unknown }) => { expect(a.orderBy).toEqual([{ at: "asc" }, { id: "asc" }]); return Array.from({ length: a.take }, (_, i) => ({ id: `old${i}` })); }
    } };
    Object.assign(db, tx(db));
    const rows = parsePvpEvents(Array.from({ length: 5 }, (_, i) => ({ k: "kill", t: t0 - i, m: 1434, s: i + 1 })), NOW);
    expect(await applyPvpEvents(db as never, "g1", "m1", rows, NOW)).toBe(5);
    expect(created).toHaveLength(5);                       // the newest rows are kept, none dropped
    expect(deleted).toEqual({ in: ["old0", "old1", "old2"] }); // 2 under cap + 5 = 3 over: the 3 oldest go
    expect(locks.at(-1)).toBe("pvp-events:m1");
    deleted = null; stored = 10;
    await applyPvpEvents(db as never, "g1", "m1", rows, NOW);
    expect(deleted).toBeNull();                              // under the cap nothing is trimmed
    const old = parsePvpEvents([{ k: "kill", t: Math.floor(NOW.getTime() / 1000) - 36 * 86_400, m: 1434, s: 99 }], NOW);
    expect(await applyPvpEvents(db as never, "g1", "m1", old, NOW)).toBe(0);
  });

  it("purges everything older than 35 days for every member, in batches", async () => {
    const wheres: Record<string, unknown>[] = []; let left = 12_000;
    const db = { worldPvpEvent: {
      findMany: async (a: { where: Record<string, unknown>; take: number }) => { wheres.push(a.where); const n = Math.min(a.take, left); return Array.from({ length: n }, (_, i) => ({ id: `r${i}` })); },
      deleteMany: async (a: { where: { id: { in: string[] } } }) => { left -= a.where.id.in.length; return { count: a.where.id.in.length }; }
    } };
    expect(await purgeOldPvpEvents(db as never, NOW)).toBe(12_000);
    expect(wheres).toHaveLength(3);                          // 5000 + 5000 + 2000
    for (const where of wheres) { expect(where).not.toHaveProperty("memberId"); expect(where).not.toHaveProperty("guildId"); expect((where["at"] as { lt: Date }).lt.getTime()).toBe(NOW.getTime() - 35 * 86_400_000); }
  });
});
