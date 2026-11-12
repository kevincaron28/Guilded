import { describe, expect, it, vi } from "vitest";
import { applyOrderActions, applyOrderRequests, craftOrdersForAddon, parseAddonOrderActions, parseAddonOrderRequests, REQUEST_LIMITS, resolveItemKey } from "../src/services/craft-orders.js";
import { craftOrdersToLua, standingsToLua } from "../companion/standings-format.mjs";
import { exportCraftOrders } from "../companion/lua-export-content.mjs";

// Crafting orders in game (docs/plans/CRAFTING_ORDERS.md): Discord requests in the standings feed, and
// claims / finishes / give-backs from the addon applied with the Discord buttons' rules.

const NOW = new Date("2026-11-07T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "req_shirt01", item: "Brown Linen Shirt", itemKey: 2580, quantity: 2, profession: "Tailoring", status: "OPEN", note: "Tip 5g | soon", materialsProvided: false,
  createdAt: new Date("2026-11-07T10:00:00Z"), claimedAt: null, doneAt: null, crafterCharacter: null, askedCharacter: null,
  requester: { displayName: "Ann Walker" }, crafter: null, ...over
});

describe("the feed part", () => {
  it("lists open and claimed requests, then the ones done in the last day, cleaned for the addon", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([row(), row({ id: "req_cloak04", status: "CLAIMED", itemKey: null, crafter: { displayName: "Eve" }, crafterCharacter: "Eve Stone", claimedAt: new Date("2026-11-07T11:00:00Z") })])
      .mockResolvedValueOnce([row({ id: "req_done005", status: "DONE", doneAt: new Date("2026-11-07T11:30:00Z") })]);
    const db = { guildSettings: { findUnique: async () => ({ craftOrdersInGame: true }) }, craftRequest: { findMany } };
    const feed = await craftOrdersForAddon(db as never, "g1", NOW);
    expect(feed.enabled).toBe(true);
    expect(feed.orders.map((o) => `${o.id}:${o.status}`)).toEqual(["req_shirt01:OPEN", "req_cloak04:CLAIMED", "req_done005:DONE"]);
    expect(feed.orders[0]).toMatchObject({ key: 2580, qty: 2, prof: "Tailoring", by: "Ann Walker", mats: false, note: "Tip 5g soon", at: 1794045600 });
    expect(feed.orders[1]).toMatchObject({ crafter: "Eve", character: "Eve Stone" });
    expect(feed.orders[1]).not.toHaveProperty("key");
    expect(findMany.mock.calls[1]![0].where.doneAt.gte).toEqual(new Date("2026-11-06T12:00:00Z"));
  });
  it("says off, with no orders, when officers turned it off", async () => {
    const db = { guildSettings: { findUnique: async () => ({ craftOrdersInGame: false }) }, craftRequest: { findMany: vi.fn() } };
    expect(await craftOrdersForAddon(db as never, "g1")).toEqual({ enabled: false, orders: [] });
    expect(db.craftRequest.findMany).not.toHaveBeenCalled();
  });
  it("is written for the addon as GuildedOrders, and as off", () => {
    const lua = craftOrdersToLua({ enabled: true, orders: [{ id: "req_shirt01", key: 2580, item: "Brown \"Linen\" Shirt", qty: 2, status: "OPEN", by: "Ann", mats: true, at: 1762509600 },
      { id: "bad id!", status: "OPEN" }, { id: "req_x00001", status: "CANCELLED" }] }, "2026-11-07T12:00:00.000Z").join("\n");
    expect(lua).toContain('GuildedOrders = { at = "2026-11-07T12:00:00.000Z", orders = {');
    expect(lua).toContain('{ id = "req_shirt01", key = 2580, item = "Brown \\"Linen\\" Shirt", qty = 2, prof = "", status = "OPEN", by = "Ann"');
    expect(lua).toContain("mats = true");
    expect(lua.match(/\{ id = /g)).toHaveLength(1);
    expect(craftOrdersToLua({ enabled: false }, "x")).toEqual(['GuildedOrders = { at = "x", off = true }']);
    expect(craftOrdersToLua(undefined, "x")).toEqual(["GuildedOrders = nil"]);
    expect(standingsToLua({ standings: [], updatedAt: "s", craftOrders: { enabled: true, orders: [] } })).toContain('GuildedOrders = { at = "s", orders = {');
  });
});

describe("actions from the game", () => {
  it("exports own and heard actions from the saved variables, field by field", () => {
    const exported = exportCraftOrders({ craftOrders: {
      actions: { req_shirt01: { order: "req_shirt01", action: "claim", character: "Lebowski Holyroller", at: 1799999000, ordersAt: "x" }, bad: { order: "bad", action: "steal", character: "x", at: 1 } },
      heard: { "req_belt002@Ann": { order: "req_belt002", action: "done", character: "Ann Walker", at: 1799999100, name: "Ann Walker" } }
    } });
    expect(exported).toEqual({
      craftOrderActions: [{ order: "req_shirt01", action: "claim", character: "Lebowski Holyroller", at: 1799999000 }],
      craftOrderRelayActions: [{ order: "req_belt002", action: "done", character: "Ann Walker", at: 1799999100, name: "Ann Walker" }]
    });
    expect(exportCraftOrders({})).toEqual({});
  });
  it("parses only well-formed rows, and relayed ones need the sender", () => {
    expect(parseAddonOrderActions([{ order: "req_shirt01", action: "claim", character: "Leb", at: 1799999000 }, { order: "x", action: "claim", character: "Leb", at: 1799999000 },
      { order: "req_shirt01", action: "steal", character: "Leb", at: 1799999000 }, { order: "req_shirt01", action: "done", character: "L|eb", at: 1799999000 }])).toHaveLength(1);
    expect(parseAddonOrderActions([{ order: "req_shirt01", action: "claim", character: "Leb", at: 1799999000 }], true)).toHaveLength(0);
  });

  function fakeDb(requests: Record<string, { status: string; requesterId: string; crafterId: string | null }>, enabled = true) {
    const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    return {
      updates,
      db: {
        guildSettings: { findUnique: async () => ({ craftOrdersInGame: enabled }) },
        character: { findMany: async () => [{ name: "Ann", displayName: "Ann Walker", memberId: "m-ann" }, { name: "Up", displayName: "Uploader", memberId: "m-up" }] },
        craftRequest: {
          findFirst: async ({ where }: { where: { id: string } }) => requests[where.id] ? { id: where.id, ...requests[where.id]! } : null,
          updateMany: async (args: { where: { id: string; status: string; crafterId?: string }; data: Record<string, unknown> }) => {
            const current = requests[args.where.id]!;
            if (current.status !== args.where.status || (args.where.crafterId && current.crafterId !== args.where.crafterId)) return { count: 0 };
            updates.push(args);
            Object.assign(current, { status: args.data["status"], crafterId: args.data["crafterId"] === undefined ? current.crafterId : args.data["crafterId"] });
            return { count: 1 };
          }
        }
      }
    };
  }

  it("claims, finishes and gives back with the buttons' rules, in time order, and only once", async () => {
    const { db, updates } = fakeDb({
      a: { status: "OPEN", requesterId: "m-req", crafterId: null },
      b: { status: "CLAIMED", requesterId: "m-req", crafterId: "m-up" },
      c: { status: "CLAIMED", requesterId: "m-req", crafterId: "m-other" },
      d: { status: "OPEN", requesterId: "m-up", crafterId: null }
    });
    const own = [
      { order: "a", action: "done" as const, character: "Up Ward", at: 1799999002 },
      { order: "a", action: "claim" as const, character: "Up Ward", at: 1799999001 },
      { order: "b", action: "release" as const, character: "Up Ward", at: 1799999003 },
      { order: "c", action: "done" as const, character: "Up Ward", at: 1799999004 }, // someone else's claim: ignored
      { order: "d", action: "claim" as const, character: "Up Ward", at: 1799999005 } // own request: ignored
    ];
    const changes = await applyOrderActions(db as never, "g1", "m-up", own, [], NOW);
    expect(changes.map((c) => `${c.requestId}:${c.action}`)).toEqual(["a:claim", "a:done", "b:release"]);
    expect(updates[0]!.data).toMatchObject({ status: "CLAIMED", crafterId: "m-up", crafterCharacter: "Up Ward", claimSource: "game" });
    expect(updates[2]!.data).toMatchObject({ status: "OPEN", crafterId: null, crafterCharacter: null });
    // The same upload again changes nothing.
    expect(await applyOrderActions(db as never, "g1", "m-up", own, [], NOW)).toEqual([]);
  });

  it("counts a relayed action for the linked sender only, never for the uploader, and does nothing when off", async () => {
    const { db } = fakeDb({ a: { status: "OPEN", requesterId: "m-req", crafterId: null }, b: { status: "OPEN", requesterId: "m-req", crafterId: null } });
    const relayed = [
      { order: "a", action: "claim" as const, character: "Ann Walker", at: 1799999001, name: "Ann Walker" },
      { order: "b", action: "claim" as const, character: "Up", at: 1799999001, name: "Uploader" },
      { order: "b", action: "claim" as const, character: "Zed", at: 1799999001, name: "Stranger" }
    ];
    expect((await applyOrderActions(db as never, "g1", "m-up", [], relayed, NOW)).map((c) => `${c.requestId}:${c.memberId}`)).toEqual(["a:m-ann"]);
    const off = fakeDb({ a: { status: "OPEN", requesterId: "m-req", crafterId: null } }, false);
    expect(await applyOrderActions(off.db as never, "g1", "m-up", [{ order: "a", action: "claim", character: "Up", at: 1799999001 }], [], NOW)).toEqual([]);
  });

  it("finds the recipe of a typed item: an id, a Wowhead link, or exactly one recorded name", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ itemKey: 2580 }]).mockResolvedValueOnce([{ itemKey: 1 }, { itemKey: 2 }]);
    const db = { recipeKnown: { findMany } };
    expect(await resolveItemKey(db as never, "g1", "19019")).toBe(19019);
    expect(await resolveItemKey(db as never, "g1", "https://www.wowhead.com/classic/item=2589")).toBe(2589);
    expect(await resolveItemKey(db as never, "g1", "brown linen shirt")).toBe(2580);
    expect(await resolveItemKey(db as never, "g1", "Two names")).toBeNull();
    expect(findMany.mock.calls[0]![0].where.itemName).toEqual({ equals: "brown linen shirt", mode: "insensitive" });
  });
});

// Requests made in game (9.2): parsed row by row, created once, only for a confirmed character of an active member.
describe("requests made in game", () => {
  const at = Math.floor(NOW.getTime() / 1000) - 600;
  const good = (over: Record<string, unknown> = {}) => ({ ref: "ref-0001", item: "Brown Linen Shirt", key: 2580, prof: "Tailoring", qty: 2, note: "Tip | soon", mats: true, asked: "Eve Stone", character: "Ann Walker", at, ...over });
  const parsed = { ref: "ref-0001", item: "Brown Linen Shirt", qty: 2, mats: true, character: "Ann Walker", at, key: 2580, prof: "Tailoring", note: "Tip soon", asked: "Eve Stone" };

  it("parses only well-formed rows, ignores ids, and relayed ones need the sender", () => {
    expect(parseAddonOrderRequests([good(), { ...good(), memberId: "m9", discordId: "123", userId: "x" }])).toEqual([parsed, parsed]);
    for (const bad of [null, "x", { ...good(), ref: "a b" }, { ...good(), item: "x" }, { ...good(), key: 0 }, { ...good(), qty: 500 }, { ...good(), qty: 1.5 }, { ...good(), at: 5 }, { ...good(), character: "A|B" }]) {
      expect(parseAddonOrderRequests([bad])).toEqual([]);
    }
    expect(parseAddonOrderRequests([good()], true)).toEqual([]);
    expect(parseAddonOrderRequests([good({ name: "Ann Walker" })], true)).toHaveLength(1);
  });

  // A small in-memory database: Ann (m1) and Bo (m2) officer-confirmed, Cy (m3) reported only, Dee (m4) and Eli (m5) both holding "Twin Name".
  function fake(over: { off?: boolean; open?: number } = {}) {
    const created: Array<Record<string, unknown>> = [];
    const chars = [
      { id: "c1", name: "Ann Walker", displayName: null, realm: "Forever", gameEdition: "forever", memberId: "m1", confirmedAt: null, linkEvidence: "officer" },
      { id: "c2", name: "Bo Stone", displayName: null, realm: "Forever", gameEdition: "forever", memberId: "m2", confirmedAt: null, linkEvidence: "officer" },
      { id: "c3", name: "Cy Reed", displayName: null, realm: "Forever", gameEdition: "forever", memberId: "m3", confirmedAt: null, linkEvidence: null },
      { id: "c4", name: "Twin Name", displayName: null, realm: "Forever", gameEdition: "forever", memberId: "m4", confirmedAt: null, linkEvidence: "officer" },
      { id: "c5", name: "Twin Name", displayName: null, realm: "Forever", gameEdition: "forever", memberId: "m5", confirmedAt: null, linkEvidence: "officer" }
    ];
    let seq = 0;
    const db = {
      guildSettings: { findUnique: async () => ({ craftOrdersInGame: !over.off }) },
      character: { findMany: async () => chars },
      characterVerifyClaim: { findMany: async () => [] },
      guildRosterEntry: { findMany: async () => [] },
      recipeKnown: { findMany: async () => [] },
      craftRequest: {
        findFirst: async ({ where }: { where: { gameRef: string } }) => created.find((r) => r["gameRef"] === where.gameRef) ?? null,
        count: async ({ where }: { where: { requesterId: string } }) => (over.open ?? 0) + created.filter((r) => r["requesterId"] === where.requesterId).length,
        create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: `req_new${++seq}` }; }
      }
    };
    return { db: db as never, created };
  }
  const parse = (rows: unknown[], relayed = false) => parseAddonOrderRequests(rows, relayed);

  it("creates an own request for a confirmed character of the uploader, with the addon's recipe key", async () => {
    const { db, created } = fake();
    const made = await applyOrderRequests(db, "g1", "m1", parse([good()]), [], NOW);
    expect(made).toEqual([{ id: "req_new1", memberId: "m1", relayed: false }]);
    expect(created[0]).toMatchObject({ guildId: "g1", requesterId: "m1", item: "Brown Linen Shirt", quantity: 2, itemKey: 2580, profession: "Tailoring", materialsProvided: true, askedCharacter: "Eve Stone", gameRef: "ref-0001", relayedById: null });
  });

  it("never reads an id from the addon: an own request must name a character of the uploader", async () => {
    const { db, created } = fake();
    expect(await applyOrderRequests(db, "g1", "m2", parse([good({ memberId: "m1" })]), [], NOW)).toEqual([]);
    expect(created).toEqual([]);
  });

  it("creates a relayed request for another member's confirmed character, marked with the uploader", async () => {
    const { db, created } = fake();
    const made = await applyOrderRequests(db, "g1", "m2", [], parse([good({ name: "Ann Walker" })], true), NOW);
    expect(made).toEqual([{ id: "req_new1", memberId: "m1", relayed: true }]);
    expect(created[0]).toMatchObject({ requesterId: "m1", relayedById: "m2", gameRef: "ref-0001" });
    const other = fake();
    expect(await applyOrderRequests(other.db, "g1", "m1", [], parse([good({ name: "Ann Walker" })], true), NOW)).toEqual([]);
  });

  it("refuses a reported-only character and a name two members could claim", async () => {
    const { db, created } = fake();
    expect(await applyOrderRequests(db, "g1", "m3", parse([good({ character: "Cy Reed" })]), [], NOW)).toEqual([]);
    expect(await applyOrderRequests(db, "g1", "m2", [], parse([good({ ref: "ref-0002", character: "Cy Reed", name: "Cy Reed" })], true), NOW)).toEqual([]);
    expect(await applyOrderRequests(db, "g1", "m1", [], parse([good({ ref: "ref-0003", character: "Twin Name", name: "Twin Name" })], true), NOW)).toEqual([]);
    expect(created).toEqual([]);
  });

  it("creates each ref once, even when the upload is resent", async () => {
    const { db, created } = fake();
    await applyOrderRequests(db, "g1", "m1", parse([good()]), [], NOW);
    expect(await applyOrderRequests(db, "g1", "m1", parse([good()]), [], NOW)).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it("allows five open requests per member, counted for relayed ones too", async () => {
    const full = fake({ open: REQUEST_LIMITS.open });
    expect(await applyOrderRequests(full.db, "g1", "m1", parse([good()]), [], NOW)).toEqual([]);
    expect(await applyOrderRequests(full.db, "g1", "m2", [], parse([good({ name: "Ann Walker" })], true), NOW)).toEqual([]);
    const { db, created } = fake();
    const rows = Array.from({ length: 8 }, (_, i) => good({ ref: `ref-100${i}` }));
    await applyOrderRequests(db, "g1", "m1", parse(rows), [], NOW);
    expect(created).toHaveLength(5);
  });

  it("does nothing when crafting orders in game are off, and drops rows that are too old or in the future", async () => {
    const off = fake({ off: true });
    expect(await applyOrderRequests(off.db, "g1", "m1", parse([good()]), [], NOW)).toEqual([]);
    const { db, created } = fake();
    await applyOrderRequests(db, "g1", "m1", parse([good({ ref: "ref-old001", at: at - 4 * 86400 }), good({ ref: "ref-new001", at: at + 7200 })]), [], NOW);
    expect(created).toEqual([]);
  });
});
