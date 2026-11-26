import { beforeEach, describe, expect, it, vi } from "vitest";

const closeAuction = vi.fn();
const notify = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/services/loot.js", () => ({ createLootService: () => ({ closeAuction }) }));
vi.mock("../src/services/notify.js", () => ({ notify, notifications: { lootAwarded: () => "awarded" } }));

const { AUTO_CLOSE_WINDOW_MS, runAuctionAutoClose } = await import("../src/services/auction-close.js");

const now = new Date("2026-12-09T20:00:00Z");
const send = vi.fn().mockResolvedValue(undefined);
const client = { guilds: { fetch: vi.fn().mockResolvedValue({ channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) } }) } };
const auction = (id: string, language = "en") => ({ id, guildId: "guild", itemName: "Ashkandi", createdBy: "officer", channelId: "loot", guild: { discordId: "g", settings: { language } } });

describe("auction auto-close", () => {
  beforeEach(() => { closeAuction.mockReset(); send.mockClear(); notify.mockClear(); });

  it("only looks at auctions that just ran out, so old open ones are never awarded by surprise", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await runAuctionAutoClose(client as never, { auction: { findMany } } as never, now);
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({ status: "ACTIVE", closesAt: { lte: now, gte: new Date(now.getTime() - AUTO_CLOSE_WINDOW_MS) } });
  });

  it("awards the winner and says so where the auction started", async () => {
    closeAuction.mockResolvedValue({ auction: { raidId: null }, award: { itemName: "Ashkandi", amount: 40, member: { discordUserId: "123", displayName: "Someone" } } });
    const database = { auction: { findMany: vi.fn().mockResolvedValue([auction("a1")]) } };
    expect(await runAuctionAutoClose(client as never, database as never, now)).toBe(1);
    expect(closeAuction).toHaveBeenCalledWith("a1", "officer");
    expect(send).toHaveBeenCalledWith({ content: "Auction closed. **Ashkandi** awarded to <@123> for **40 GP**.", allowedMentions: { parse: [] } });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("answers in French and carries on when one auction cannot be closed", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    closeAuction.mockRejectedValueOnce(new Error("Auction was already closed")).mockResolvedValueOnce({ auction: { raidId: null }, award: null });
    const database = { auction: { findMany: vi.fn().mockResolvedValue([auction("a1"), auction("a2", "fr")]) } };
    expect(await runAuctionAutoClose(client as never, database as never, now)).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].content).toBe("Enchère **Ashkandi** terminée sans offre.");
    expect(notify).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});
