import { describe, expect, it, vi } from "vitest";
import { createLootService } from "../src/services/loot.js";

function service(bids: { memberId: string; amount: number; createdAt: Date }[], members: Record<string, { discordUserId: string; isTest: boolean }>) {
  const tx = {
    auction: { findUnique: vi.fn().mockResolvedValue({ id: "a", guildId: "g", itemName: "Ashkandi", status: "ACTIVE", closesAt: new Date(Date.now() + 60_000), minimumBid: 10, bidIncrement: 5, bids }) },
    member: { findUnique: vi.fn(async ({ where }) => where.id === "bidder" ? { id: "bidder", guildId: "g" } : members[where.id] ?? null) },
    auctionBid: { upsert: vi.fn(async ({ create }) => ({ id: "b", ...create })) }
  };
  return createLootService({ $transaction: (work: (value: unknown) => unknown) => work(tx) } as never);
}
const t0 = new Date("2026-11-01T20:00:00Z"), t1 = new Date("2026-11-01T20:00:05Z");

describe("outbid DMs", () => {
  it("names the previous leader when someone else overtakes them", async () => {
    const bid = await service([{ memberId: "first", amount: 20, createdAt: t0 }, { memberId: "second", amount: 20, createdAt: t1 }],
      { first: { discordUserId: "111", isTest: false }, second: { discordUserId: "222", isTest: false } })
      .placeBid({ auctionId: "a", memberId: "bidder", amount: 25 });
    // Ties go to the earliest bid, as closing does: "first" was leading.
    expect(bid.outbid).toEqual({ discordUserId: "111" });
    expect(bid.auction.itemName).toBe("Ashkandi");
  });

  it("says nothing when the leader raises their own bid, on a first bid, or to fake test raiders", async () => {
    expect((await service([{ memberId: "bidder", amount: 20, createdAt: t0 }], {}).placeBid({ auctionId: "a", memberId: "bidder", amount: 30 })).outbid).toBeNull();
    expect((await service([], {}).placeBid({ auctionId: "a", memberId: "bidder", amount: 10 })).outbid).toBeNull();
    expect((await service([{ memberId: "fake", amount: 20, createdAt: t0 }], { fake: { discordUserId: "test-1", isTest: true } })
      .placeBid({ auctionId: "a", memberId: "bidder", amount: 25 })).outbid).toBeNull();
  });
});
