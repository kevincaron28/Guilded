import { describe, expect, it } from "vitest";
import { reserveRequestsToLua } from "../companion/standings-format.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { NO_LIST, parseReserveItem, placeReserve, removeReserve, reserveRequestsForAddon, settleReserveRequests } from "../src/services/reserve-requests.js";
import { describeReserves } from "../src/services/reserves.js";

const NOW = new Date("2026-12-08T18:00:00Z");

type Row = { id: string; guildId: string; memberId: string; character: string; realm: string; itemId: number | null; itemName: string; remove: boolean; createdAt: Date };
type Listed = { guildId: string; character: string; realm: string; itemId: number; itemName: string };

const text = (value: unknown) => String(value ?? "").toLowerCase();
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const rule = want as { equals?: unknown; in?: unknown[]; gte?: Date; gt?: number };
      if (rule.equals !== undefined) return text(row[key]) === text(rule.equals);
      if (rule.in) return rule.in.includes(row[key]);
      if (rule.gte) return (row[key] as Date) >= rule.gte;
      if (rule.gt !== undefined) return Number(row[key]) > rule.gt;
    }
    return row[key] === want;
  });
}

function fakeDb(options: { perPlayer?: number; open?: boolean; listed?: Listed[] } = {}) {
  const list = { guildId: "g", title: "MC", perPlayer: options.perPlayer ?? 1, open: options.open ?? true, active: true, keeper: "Boss", syncedAt: NOW };
  const listed = options.listed ?? [];
  let rows: Row[] = [];
  let next = 0;
  const table = <T extends Record<string, unknown>>(all: () => T[]) => ({
    findFirst: async ({ where }: { where: Record<string, unknown> }) => all().find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => all().filter((row) => matches(row, where))
  });
  const db = {
    reserveList: { findUnique: async () => list },
    itemReserve: table(() => listed),
    recipeKnown: table(() => [] as Record<string, unknown>[]),
    reserveRequest: {
      ...table(() => rows),
      count: async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)).length,
      create: async ({ data }: { data: Omit<Row, "id"> }) => { const row = { id: `request${++next}`, ...data }; rows.push(row); return row; },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => { rows = rows.filter((row) => !where.id.in.includes(row.id)); }
    }
  };
  return { db: db as never, rows: () => rows, list };
}

const ann = (item: string) => ({ guildId: "g", memberId: "m", character: "Ann Smith", realm: "", item });
const snapshot = (over: Record<string, unknown>) => parseAddonSnapshot({
  source: "Guilded", exportedAt: NOW.toISOString(),
  reserves: { at: new Date(NOW.getTime() + 60_000).toISOString(), by: "Boss", title: "MC", limit: 1, open: true, active: true, entries: [], ...over }
}).reserves!;

describe("parseReserveItem", () => {
  it("reads item links, Wowhead addresses, numbers and names", () => {
    expect(parseReserveItem("|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r")).toEqual({ itemId: 19364, name: "Ashkandi" });
    expect(parseReserveItem("https://www.wowhead.com/classic/item=17063/band-of-accuria")).toEqual({ itemId: 17063, name: "Band Of Accuria" });
    expect(parseReserveItem("17063")).toEqual({ itemId: 17063, name: "" });
    expect(parseReserveItem("  [Mystery   Blade] ")).toEqual({ itemId: null, name: "Mystery Blade" });
  });
});

describe("reserve requests", () => {
  it("needs an open list", async () => {
    await expect(placeReserve(fakeDb({ open: false }).db, ann("17063"), NOW)).rejects.toThrow(NO_LIST);
  });

  it("with one per player, a new request replaces the waiting one", async () => {
    const f = fakeDb();
    expect(await placeReserve(f.db, ann("item:19364"), NOW)).toMatchObject({ kind: "requested", itemId: 19364, replaced: false });
    expect(await placeReserve(f.db, ann("Mystery Blade"), NOW)).toMatchObject({ kind: "requested", itemId: null, replaced: true });
    expect(f.rows().map((row) => row.itemName)).toEqual(["Mystery Blade"]);
    await expect(placeReserve(f.db, ann("mystery blade"), NOW)).rejects.toThrow("already reserved");
  });

  it("with two per player, refuses a third and counts what is already on the list", async () => {
    const f = fakeDb({ perPlayer: 2, listed: [{ guildId: "g", character: "Ann Smith", realm: "", itemId: 1000, itemName: "Ring" }] });
    await placeReserve(f.db, ann("item:19364"), NOW);
    await expect(placeReserve(f.db, ann("item:17063"), NOW)).rejects.toThrow("You already have 2 reserves. Remove one first.");
  });

  it("cancels a waiting request, asks the keeper to remove a listed one, and can take that back", async () => {
    const f = fakeDb({ perPlayer: 2, listed: [{ guildId: "g", character: "Ann Smith", realm: "", itemId: 1000, itemName: "Ring" }] });
    await placeReserve(f.db, ann("item:19364"), NOW);
    expect(await removeReserve(f.db, ann("19364"), NOW)).toMatchObject({ kind: "cancelled" });
    expect(await removeReserve(f.db, ann("Ring"), NOW)).toMatchObject({ kind: "removal", itemId: 1000 });
    expect(f.rows()).toMatchObject([{ remove: true, itemId: 1000 }]);
    expect(await placeReserve(f.db, ann("Ring"), NOW)).toMatchObject({ kind: "kept" });
    expect(f.rows()).toEqual([]);
    await expect(removeReserve(f.db, ann("Boots"), NOW)).rejects.toThrow("no reserve");
  });

  it("hands waiting requests to the keeper's companion and shows them in Discord", async () => {
    const f = fakeDb({ perPlayer: 2 });
    await placeReserve(f.db, ann("19364"), NOW);
    const feed = await reserveRequestsForAddon(f.db, "g", NOW);
    expect(feed).toEqual([{ id: "request1", name: "Ann Smith", op: "ADD", item: 19364, itemName: "", at: NOW.getTime() / 1000 }]);
    const lua = reserveRequestsToLua(feed.map((row) => ({ ...row, id: "abcdef123" })), NOW.toISOString()).join("\n");
    expect(lua).toContain('{ id = "abcdef123", name = "Ann Smith", op = "ADD", item = 19364, itemName = "", at = ');
    expect(reserveRequestsToLua(undefined, "")).toEqual(["GuildedReserveRequests = nil"]);
    expect(await describeReserves(f.db, "g", undefined, NOW, "fr")).toContain("En attente du /reload du responsable du butin");
  });

  it("forgets requests the game now shows, and the ones a locked list can no longer take", async () => {
    const f = fakeDb({ perPlayer: 2 });
    await placeReserve(f.db, ann("19364"), NOW);
    await placeReserve(f.db, ann("17063"), NOW);
    const db = f.db as unknown as Parameters<typeof settleReserveRequests>[0];
    await settleReserveRequests(db, "g", snapshot({ entries: [{ character: "Ann Smith", realm: "R", itemId: 19364, itemName: "Ashkandi" }] }), NOW);
    expect(f.rows().map((row) => row.itemId)).toEqual([17063]);
    await settleReserveRequests(db, "g", snapshot({ open: false }), NOW);
    expect(f.rows()).toEqual([]);
  });
});
