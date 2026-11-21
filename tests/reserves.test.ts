import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { applyReserves, describeReserves } from "../src/services/reserves.js";

// What WoW writes for the reserve list of Modules/Reserve.lua (array tables use bracketed keys).
const LUA = (reserves: string) => `
GuildedDB = {
  ["guildKey"] = "Quebec Gold-Forever",
  ["reserves"] = ${reserves},
  ["exports"] = { ["2026-10-01T19:00:00Z"] = true },
}
`;

const ACTIVE = `{
  ["host"] = "Boss", ["open"] = true, ["limit"] = 2, ["title"] = "Onyxia night", ["updatedAt"] = "2026-10-01T18:00:00Z",
  ["names"] = { [19364] = "Ashkandi", [17063] = "Band of Accuria" },
  ["entries"] = { ["Ann"] = { [1] = 19364, [2] = 17063 }, ["Bob"] = { [1] = 19364 }, ["Cy"] = { [1] = 555 } },
}`;

describe("companion export of the reserve list", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  async function exportOf(reserves: string) {
    dir = await mkdtemp(join(tmpdir(), "qg-reserves-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, LUA(reserves), "utf8");
    return readAddonExport(file, "Forever");
  }

  it("sends every reserve with its item name, and the bot's schema accepts it", async () => {
    const result = await exportOf(ACTIVE);
    const snapshot = parseAddonSnapshot(result);
    expect(snapshot.reserves).toMatchObject({ by: "Boss", title: "Onyxia night", limit: 2, open: true, active: true });
    expect(snapshot.reserves?.at.toISOString()).toBe("2026-10-01T18:00:00.000Z");
    const rows = snapshot.reserves!.entries.map((entry) => `${entry.character}:${entry.itemId}:${entry.itemName}:${entry.realm}`).sort();
    expect(rows).toEqual([
      "Ann:17063:Band of Accuria:Forever", "Ann:19364:Ashkandi:Forever", "Bob:19364:Ashkandi:Forever", "Cy:555:Item 555:Forever"
    ]);
  });

  it("sends a cleared list as empty, so Discord forgets the old one", async () => {
    const cleared = `{ ["open"] = false, ["limit"] = 1, ["title"] = "Old", ["updatedAt"] = "2026-10-01T20:00:00Z", ["entries"] = {}, ["names"] = {} }`;
    const snapshot = parseAddonSnapshot(await exportOf(cleared));
    expect(snapshot.reserves).toMatchObject({ active: false, open: false, title: "", entries: [] });
  });

  it("sends nothing when there was never a list, or when it has no timestamp", async () => {
    expect((await exportOf(`{ ["entries"] = {} }`)).reserves).toBeUndefined();
  });
});

// A tiny in-memory stand-in for the two tables.
function fakeDb() {
  let list: { guildId: string; title: string; perPlayer: number; open: boolean; active: boolean; keeper: string; syncedAt: Date } | null = null;
  let rows: { guildId: string; character: string; realm: string; itemId: number; itemName: string }[] = [];
  const db = {
    reserveList: {
      findUnique: async () => list,
      upsert: async ({ create, update }: { create: NonNullable<typeof list>; update: Partial<NonNullable<typeof list>> }) => { list = list ? { ...list, ...update } : create; return list; }
    },
    itemReserve: {
      deleteMany: async () => { rows = []; },
      createMany: async ({ data }: { data: typeof rows }) => { rows = [...rows, ...data]; },
      findMany: async () => [...rows].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.character.localeCompare(b.character))
    }
  };
  return { db, rows: () => rows, list: () => list };
}

const base = (over: Record<string, unknown> = {}) => parseAddonSnapshot({
  source: "Guilded", exportedAt: "2026-10-01T19:00:00Z",
  reserves: {
    at: "2026-10-01T18:00:00Z", by: "Boss", title: "Onyxia night", limit: 1, open: true, active: true,
    entries: [
      { character: "Ann", realm: "F", itemId: 19364, itemName: "Ashkandi" },
      { character: "Bob", realm: "F", itemId: 19364, itemName: "Ashkandi" },
      { character: "Bob", realm: "F", itemId: 19364, itemName: "Ashkandi" }
    ], ...over
  }
}).reserves;

describe("applyReserves", () => {
  it("stores the list and replaces the old one", async () => {
    const { db, rows, list } = fakeDb();
    expect(await applyReserves(db as never, "g1", base())).toEqual({ applied: true, entries: 3 });
    expect(list()).toMatchObject({ keeper: "Boss", title: "Onyxia night", perPlayer: 1, open: true, active: true });
    expect(await applyReserves(db as never, "g1", base({ at: "2026-10-01T19:00:00Z", entries: [{ character: "Cy", realm: "F", itemId: 5, itemName: "Ring" }] })))
      .toEqual({ applied: true, entries: 1 });
    expect(rows().map((row) => row.character)).toEqual(["Cy"]);
  });

  it("ignores an older or identical copy, and an export without reserves", async () => {
    const { db, rows } = fakeDb();
    await applyReserves(db as never, "g1", base({ at: "2026-10-01T19:00:00Z" }));
    expect((await applyReserves(db as never, "g1", base({ at: "2026-10-01T18:00:00Z", entries: [] }))).applied).toBe(false);
    expect((await applyReserves(db as never, "g1", base({ at: "2026-10-01T19:00:00Z", entries: [] }))).applied).toBe(false);
    expect((await applyReserves(db as never, "g1", undefined)).applied).toBe(false);
    expect(rows()).toHaveLength(3);
  });

  it("a cleared list empties the table and marks it inactive", async () => {
    const { db, rows, list } = fakeDb();
    await applyReserves(db as never, "g1", base());
    await applyReserves(db as never, "g1", base({ at: "2026-10-02T18:00:00Z", active: false, open: true, entries: [{ character: "Zed", realm: "F", itemId: 1, itemName: "X" }] }));
    expect(rows()).toEqual([]);
    expect(list()).toMatchObject({ active: false, open: false });
  });
});

describe("describeReserves", () => {
  const NOW = new Date("2026-10-01T18:30:00Z");

  it("says when there is no list", async () => {
    expect(await describeReserves(fakeDb().db as never, "g1")).toMatch(/No soft-reserve list is open/);
  });

  it("groups by item, shows the list's settings, and narrows by item or character", async () => {
    const { db } = fakeDb();
    await applyReserves(db as never, "g1", base({ entries: [
      { character: "Bob", realm: "F", itemId: 19364, itemName: "Ashkandi" },
      { character: "Ann", realm: "F", itemId: 19364, itemName: "Ashkandi" },
      { character: "Ann", realm: "F", itemId: 17063, itemName: "Band of Accuria" }
    ] }));
    const all = await describeReserves(db as never, "g1", undefined, NOW);
    expect(all).toContain("**Soft reserves** — Onyxia night · 1 per player · open · kept by Boss · synced 30 min ago");
    expect(all).toContain("• **Ashkandi** — Ann, Bob");
    expect(all).toContain("• **Band of Accuria** — Ann");
    const item = await describeReserves(db as never, "g1", "ashk", NOW);
    expect(item).toContain("Ashkandi");
    expect(item).not.toContain("Band of Accuria");
    const character = await describeReserves(db as never, "g1", "ann", NOW);
    expect(character).toContain("Band of Accuria");
    expect(await describeReserves(db as never, "g1", "nothing", NOW)).toContain('Nothing matches "nothing".');
  });

  it("stays under Discord's message limit", async () => {
    const { db } = fakeDb();
    const entries = Array.from({ length: 200 }, (_, i) => ({ character: `Player${i}`, realm: "F", itemId: 1000 + i, itemName: `A rather long item name number ${i}` }));
    await applyReserves(db as never, "g1", base({ entries }));
    const text = await describeReserves(db as never, "g1", undefined, NOW);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("more item(s)");
  });
});
