import { describe, expect, it, vi } from "vitest";
import { createLootService } from "../src/services/loot.js";

function fake(memberGuild = "g1") {
  const created: Record<string, unknown>[] = [];
  const tx = {
    member: { findUnique: async () => ({ id: "m1", guildId: memberGuild, displayName: "Kev" }) },
    epgpTransaction: {
      aggregate: async () => ({ _sum: { epAmount: 100, gpAmount: 40 } }),
      create: vi.fn(async ({ data }) => { created.push({ kind: "gp", ...data }); return data; })
    },
    lootAward: { create: vi.fn(async ({ data }) => { created.push({ kind: "award", ...data }); return { ...data, member: { displayName: "Kev" } }; }) }
  };
  return { created, tx, db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
}

describe("direct loot award (loot council)", () => {
  it("records the award with no GP transaction when the price is 0", async () => {
    const { db, created, tx } = fake();
    const award = await createLootService(db as never).awardDirect({ guildId: "g1", memberId: "m1", itemName: " Sulfuras ", gp: 0, awardedBy: "officer" });
    expect(award.itemName).toBe("Sulfuras");
    expect(tx.epgpTransaction.create).not.toHaveBeenCalled();
    expect(created).toEqual([expect.objectContaining({ kind: "award", amount: 0, epBefore: 100, gpBefore: 40 })]);
  });

  it("charges GP when a price is given, and links both records", async () => {
    const { db, created } = fake();
    await createLootService(db as never).awardDirect({ guildId: "g1", memberId: "m1", itemName: "Helm", gp: 50, awardedBy: "officer", bossName: "Rag" });
    expect(created.map((row) => row["kind"])).toEqual(["gp", "award"]);
    expect(created[0]).toMatchObject({ gpAmount: 50, type: "ITEM_AWARD", reason: "Loot award: Helm" });
    expect(created[1]).toMatchObject({ amount: 50, bossName: "Rag" });
  });

  it("refuses a player from another guild, an empty item and a negative price", async () => {
    const service = createLootService(fake("other").db as never);
    await expect(service.awardDirect({ guildId: "g1", memberId: "m1", itemName: "Helm", gp: 0, awardedBy: "o" })).rejects.toThrow(/not in this guild/);
    await expect(createLootService(fake().db as never).awardDirect({ guildId: "g1", memberId: "m1", itemName: " ", gp: 0, awardedBy: "o" })).rejects.toThrow(/Item name/);
    await expect(createLootService(fake().db as never).awardDirect({ guildId: "g1", memberId: "m1", itemName: "Helm", gp: -1, awardedBy: "o" })).rejects.toThrow(/GP must be/);
  });
});
