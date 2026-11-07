import { describe, expect, it, vi } from "vitest";
import { applyOrderActions, craftOrdersForAddon, parseAddonOrderActions, resolveItemKey } from "../src/services/craft-orders.js";
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
