import { describe, expect, it, vi } from "vitest";
import { createLootService } from "../src/services/loot.js";
import { createApplicationService } from "../src/services/application.js";

describe("loot and application validation", () => {
  it("rejects invalid auction settings before database access", async () => {
    const service = createLootService({} as never);
    await expect(service.createAuction({
      guildId: "guild", itemName: "Sword", minimumBid: 0, bidIncrement: 5,
      durationSeconds: 60, createdBy: "officer"
    })).rejects.toThrow("Minimum bid must be positive");
  });

  it("rejects invalid bids before database access", async () => {
    const service = createLootService({} as never);
    await expect(service.placeBid({ auctionId: "auction", memberId: "member", amount: 0 }))
      .rejects.toThrow("Bid must be a positive integer");
  });

  it("allows a member with no prior GP history to place a valid bid", async () => {
    // Regression test: GP is a lifetime cost tracker (it only grows when you
    // win loot), not a spendable balance. placeBid must never require an
    // existing GP balance, or nobody could ever place a first bid.
    const bid = { id: "bid1", auctionId: "auction1", memberId: "member1", amount: 15 };
    const tx = {
      auction: {
        findUnique: vi.fn().mockResolvedValue({
          id: "auction1", guildId: "guild", status: "ACTIVE",
          closesAt: new Date(Date.now() + 60_000), minimumBid: 10, bidIncrement: 5, bids: []
        })
      },
      member: { findUnique: vi.fn().mockResolvedValue({ id: "member1", guildId: "guild" }) },
      auctionBid: { upsert: vi.fn().mockResolvedValue(bid) }
    };
    const database = { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)) } as never;
    const service = createLootService(database);
    await expect(service.placeBid({ auctionId: "auction1", memberId: "member1", amount: 15 }))
      .resolves.toEqual(bid);
    expect(tx.auctionBid.upsert).toHaveBeenCalled();
  });

  it("awards loot to the top bidder without re-checking their GP balance", async () => {
    const award = { id: "award1", itemName: "Sword", amount: 20, memberId: "member1" };
    const tx = {
      auction: {
        findUnique: vi.fn().mockResolvedValue({
          id: "auction1", guildId: "guild", itemName: "Sword", status: "ACTIVE",
          bids: [{ memberId: "member1", amount: 20 }]
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      epgpTransaction: {
        create: vi.fn().mockResolvedValue({ id: "tx1" }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { epAmount: 100, gpAmount: 40 } })
      },
      lootAward: { create: vi.fn().mockResolvedValue(award) }
    };
    const database = { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)) } as never;
    const service = createLootService(database);
    const result = await service.closeAuction("auction1", "officer");
    expect(result.award).toEqual(award);
    expect(tx.epgpTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gpAmount: 20 })
    }));
    // Loot history keeps the winner's totals from before the award and who closed it.
    expect(tx.lootAward.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ epBefore: 100, gpBefore: 40, awardedBy: "officer" })
    }));
  });

  it("rejects incomplete applications before database access", async () => {
    const service = createApplicationService({} as never);
    await expect(service.create({
      guildId: "guild", memberId: "member", character: "Ace", className: "",
      spec: "Holy", experience: "Raids", availability: "Evenings"
    })).rejects.toThrow("className is required");
  });
});
