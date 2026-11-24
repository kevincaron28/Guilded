import { describe, expect, it, vi } from "vitest";
import { FEED_DAYS, guildFeedFor } from "../src/services/mobile-guild-feed.js";

const now = new Date("2026-11-24T20:00:00Z");
function db(member: unknown = { guildId: "g1" }) {
  return {
    member: { findFirst: vi.fn().mockResolvedValue(member) },
    guildEventEntry: { findMany: vi.fn().mockResolvedValue([
      { kind: "join", actor: "Aelira", target: null, rank: null, at: new Date("2026-11-24T10:00:00Z") },
      { kind: "promote", actor: "Mira", target: "Borin", rank: "Officer", at: new Date("2026-11-23T10:00:00Z") },
      { kind: "quit", actor: "Cindra", target: null, rank: null, at: new Date("2026-11-22T10:00:00Z") }
    ]) },
    guildBankTransaction: { findMany: vi.fn().mockResolvedValue([
      { kind: "money", actor: "Borin", itemName: null, count: null, amount: 50000n, at: new Date("2026-11-24T12:00:00Z") },
      { kind: "item", actor: "Aelira", itemName: "Linen Cloth", count: 20, amount: null, at: new Date("2026-11-21T12:00:00Z") },
      { kind: "money", actor: "Nobody", itemName: null, count: null, amount: 0n, at: new Date("2026-11-21T12:00:00Z") }
    ]) },
    raidKill: { findMany: vi.fn().mockResolvedValue([{ bossName: "Lucifron", instanceName: "Molten Core", killedAt: new Date("2026-11-24T15:00:00Z") }]) }
  };
}

describe("guild activity feed for the phone", () => {
  it("merges the guild log, bank gifts and raid kills, newest first", async () => {
    const feed = await guildFeedFor(db() as never, "user", "123456", () => true, now);
    expect(feed.days).toBe(FEED_DAYS);
    expect(feed.items.map((item) => [item.kind, item.actor])).toEqual([
      ["raidKill", "Lucifron"], ["donation", "Borin"], ["join", "Aelira"], ["promote", "Mira"], ["leave", "Cindra"], ["donation", "Aelira"]
    ]);
    expect(feed.items[1]).toMatchObject({ copper: 50000 });
    expect(feed.items[3]).toMatchObject({ target: "Borin", rank: "Officer" });
    expect(feed.items[5]).toMatchObject({ item: "Linen Cloth", count: 20 });
  });
  it("reads only the member's own guild, the last two weeks, deposits only", async () => {
    const database = db();
    await guildFeedFor(database as never, "user", "123456", () => true, now);
    expect(database.member.findFirst.mock.calls[0]![0].where).toMatchObject({ discordUserId: "user", status: "ACTIVE", guild: { discordId: "123456" } });
    expect(database.guildEventEntry.findMany.mock.calls[0]![0].where).toMatchObject({ guildId: "g1", at: { gte: new Date(now.getTime() - FEED_DAYS * 86_400_000) } });
    expect(database.guildBankTransaction.findMany.mock.calls[0]![0].where).toMatchObject({ type: { equals: "deposit" } });
  });
  it("answers an empty feed to a non-member, a bad server id or a server the bot is not allowed in", async () => {
    expect((await guildFeedFor(db(null) as never, "user", "123456", () => true, now)).items).toEqual([]);
    const database = db();
    expect((await guildFeedFor(database as never, "user", "abc", () => true, now)).items).toEqual([]);
    expect((await guildFeedFor(database as never, "user", "123456", () => false, now)).items).toEqual([]);
    expect(database.member.findFirst).not.toHaveBeenCalled();
  });
});
