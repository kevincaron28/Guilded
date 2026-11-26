import { describe, expect, it, vi } from "vitest";
import { cancelCraftRequestFor, craftingFor, requestCraftFor } from "../src/services/mobile-crafting.js";

const recipes = [
  { itemKey: 6450, itemName: "Heavy Silk Bandage", profession: "First Aid", character: "Mira" },
  { itemKey: 6450, itemName: "Heavy Silk Bandage", profession: "Premiers soins", character: "aelira" },
  { itemKey: 6450, itemName: "Heavy Silk Bandage", profession: "First Aid", character: "Mira" },
  { itemKey: 13446, itemName: "Major Healing Potion", profession: "Alchemy", character: "Borin" }
];
function db(member: unknown = { id: "m1", guildId: "g1" }) {
  return {
    member: { findFirst: vi.fn().mockResolvedValue(member) },
    recipeKnown: { findMany: vi.fn(async ({ where }: { where: { itemKey?: number } }) => where.itemKey ? recipes.filter((r) => r.itemKey === where.itemKey) : recipes) },
    craftRequest: {
      findMany: vi.fn().mockResolvedValue([{ id: "r1", item: "Runecloth Bag", quantity: 2, status: "CLAIMED", requesterId: "m1", crafterCharacter: "Cindra", crafter: null, createdAt: new Date("2026-11-24T12:00:00Z") }]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new", ...data }))
    }
  };
}

describe("crafting from the phone", () => {
  it("groups the guild's known recipes by item with each crafter once, and lists my open requests", async () => {
    const answer = await craftingFor(db() as never, "user", "123456", "heal");
    expect(answer.items).toEqual([
      { itemKey: 6450, itemName: "Heavy Silk Bandage", profession: "First Aid", crafters: ["aelira", "Mira"] },
      { itemKey: 13446, itemName: "Major Healing Potion", profession: "Alchemy", crafters: ["Borin"] }
    ]);
    expect(answer.requests).toEqual([{ id: "r1", item: "Runecloth Bag", quantity: 2, status: "CLAIMED", crafter: "Cindra", mine: true, createdAt: "2026-11-24T12:00:00.000Z" }]);
  });
  it("does not search under two letters, and answers nothing to a non-member", async () => {
    const database = db();
    expect((await craftingFor(database as never, "user", "123456", "h")).items).toEqual([]);
    expect(database.recipeKnown.findMany).not.toHaveBeenCalled();
    expect(await craftingFor(db(null) as never, "user", "123456", "heal")).toEqual({ items: [], requests: [] });
  });
  it("creates a request for a known recipe through the craft service, with the asked crafter's exact name", async () => {
    const database = db();
    const outcome = await requestCraftFor(database as never, "user", { guildDiscordId: "123456", itemKey: 6450, quantity: 5, character: "AELIRA", note: " for Thursday " });
    expect(outcome).toEqual({ status: "ok", id: "new", guildId: "g1", guildDiscordId: "123456", asked: "aelira" });
    expect(database.craftRequest.create.mock.calls[0]![0].data).toMatchObject({ guildId: "g1", requesterId: "m1", item: "Heavy Silk Bandage", profession: "First Aid", quantity: 5, itemKey: 6450, askedCharacter: "aelira", note: "for Thursday", materialsProvided: false });
  });
  it("refuses an unknown recipe, a crafter who does not know it, bad numbers and the craft service's own limits", async () => {
    expect(await requestCraftFor(db() as never, "user", { guildDiscordId: "123456", itemKey: 1 })).toEqual({ status: "gone" });
    expect(await requestCraftFor(db() as never, "user", { guildDiscordId: "123456", itemKey: 6450, character: "Borin" })).toEqual({ status: "invalid" });
    expect(await requestCraftFor(db() as never, "user", { guildDiscordId: "123456", itemKey: 6450, quantity: 0 })).toEqual({ status: "invalid" });
    expect(await requestCraftFor(db() as never, "user", { guildDiscordId: "123456", itemKey: "6450" })).toEqual({ status: "invalid" });
    const full = db();
    full.craftRequest.count.mockResolvedValue(10);
    expect(await requestCraftFor(full as never, "user", { guildDiscordId: "123456", itemKey: 6450 })).toEqual({ status: "refused", message: "You already have 10 open craft requests." });
  });
});

describe("cancelling a craft request from the phone", () => {
  const open = (requesterId: string, status = "OPEN") => {
    const database = db();
    const row = { id: "r1", guildId: "g1", requesterId, crafterId: null, status };
    return { ...database, craftRequest: { ...database.craftRequest, findFirst: vi.fn(async () => row), update: vi.fn(async () => row) } };
  };
  it("cancels my own open request", async () => {
    const database = open("m1");
    expect(await cancelCraftRequestFor(database as never, "user", { guildDiscordId: "123456", id: "r1" })).toEqual({ status: "ok", id: "r1", guildId: "g1", guildDiscordId: "123456", memberId: "m1" });
    expect(database.craftRequest.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "CANCELLED" } });
  });
  it("refuses someone else's request, a closed one, a bad id and a non-member", async () => {
    const other = open("m2");
    expect(await cancelCraftRequestFor(other as never, "user", { guildDiscordId: "123456", id: "r1" })).toMatchObject({ status: "refused" });
    expect(other.craftRequest.update).not.toHaveBeenCalled();
    expect(await cancelCraftRequestFor(open("m1", "DONE") as never, "user", { guildDiscordId: "123456", id: "r1" })).toMatchObject({ status: "refused" });
    expect(await cancelCraftRequestFor(open("m1") as never, "user", { guildDiscordId: "123456", id: 7 })).toEqual({ status: "invalid" });
    expect(await cancelCraftRequestFor(db(null) as never, "user", { guildDiscordId: "123456", id: "r1" })).toEqual({ status: "gone" });
  });
});
