import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { monthlyRookie, rememberRookieJoin, rookieMemberLookup } from "../src/services/monthly-rookie.js";
import { monthlyHonorsMessage } from "../src/services/community-honors.js";
import type { Guild } from "discord.js";

const season = { id: "oct", createdAt: new Date("2026-10-01T04:00:00Z"), endedAt: new Date("2026-11-01T04:00:00Z") };
const board = [{ userId: "a", points: 40, balance: 5 }, { userId: "b", points: 30, balance: 30 }];
const fresh = new Date("2026-10-04T12:00:00Z");
function fixture() {
  const joins = new Map<string, Date>();
  const db = {
    communityHonorAward: { findMany: vi.fn(async () => [] as { userId: string }[]) },
    communityParticipationDay: { findMany: vi.fn(async () => ["a", "b"].flatMap(userId => ["2026-10-02", "2026-10-03", "2026-10-04"].map(day => ({ userId, day, messages: 2, reactions: 1, voiceMs: 1_200_000 })))) },
    communityPoint: { findMany: vi.fn(async () => [] as { userId: string; createdAt: Date; amount: number; kind: string }[]) },
    member: { findMany: vi.fn(async () => [] as { discordUserId: string }[]) },
    communityRookieMembership: {
      upsert: vi.fn(async ({ create }: { create: { userId: string; joinedAt: Date } }) => { if (!joins.has(create.userId)) joins.set(create.userId, create.joinedAt); }),
      updateMany: vi.fn(async ({ where, data }: { where: { userId: string }; data: { joinedAt: Date } }) => { if (joins.get(where.userId)! > data.joinedAt) joins.set(where.userId, data.joinedAt); }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { guildId_userId: { userId: string } } }) => ({ joinedAt: joins.get(where.guildId_userId.userId)! }))
    }
  };
  const lookup = vi.fn(async () => fresh as Date | null);
  const run = (rows = board) => monthlyRookie(db as unknown as Prisma.TransactionClient, "guild", season, rows, "America/Toronto", lookup);
  return { db, joins, lookup, run };
}

describe("monthly newcomer recognition", () => {
  it("chooses earned points, records Discord tenure, and includes a bilingual activity recap", async () => {
    const f = fixture();
    const rookie = await f.run();
    expect(rookie).toMatchObject({ userId: "a", points: 40, activeDays: 3, messages: 6, reactions: 3, voiceHours: 1 });
    expect(f.joins.get("a")).toEqual(fresh);
    for (const lang of ["en", "fr"] as const) {
      const message = monthlyHonorsMessage(lang, { name: "October", number: 1 }, board, new Map([["a", "Alice"]]), rookie);
      expect(JSON.stringify(message)).toContain("Alice");
      expect(message.embeds[0]!.fields!.at(-1)!.name).toBe(lang === "fr" ? "🐣 Recrue du mois" : "🐣 Rookie of the month");
    }
  });

  it("excludes previous monthly winners, but legacy weekly mentions do not count", async () => {
    const f = fixture();
    f.db.communityHonorAward.findMany.mockResolvedValue([{ userId: "a" }]);
    expect((await f.run())?.userId).toBe("b");
    expect(f.db.communityHonorAward.findMany).toHaveBeenCalledWith({ where: { guildId: "guild", kind: "MONTH_ROOKIE" }, select: { userId: true } });
  });

  it("rejects veterans and future joins, retains old tenure across rejoining, and accepts the 60-day boundary", async () => {
    const f = fixture();
    f.joins.set("a", new Date("2025-01-01T00:00:00Z"));
    expect((await f.run())?.userId).toBe("b");
    const boundary = new Date(season.endedAt.getTime() - 60 * 86_400_000);
    f.joins.clear(); f.lookup.mockResolvedValue(boundary);
    expect((await f.run())?.userId).toBe("a");
    f.joins.clear(); f.lookup.mockResolvedValue(new Date(boundary.getTime() - 1));
    expect(await f.run()).toBeNull();
    f.joins.clear(); f.lookup.mockResolvedValue(season.endedAt);
    expect(await f.run()).toBeNull();
  });

  it("requires three distinct guild-time days; spending never creates an active day", async () => {
    const f = fixture();
    f.db.communityParticipationDay.findMany.mockResolvedValue([]);
    f.db.communityPoint.findMany.mockResolvedValue([
      { userId: "a", kind: "AWARD", amount: 10, createdAt: new Date("2026-10-03T03:30:00Z") },
      { userId: "a", kind: "AWARD", amount: 10, createdAt: new Date("2026-10-03T04:30:00Z") },
      { userId: "a", kind: "AWARD", amount: 10, createdAt: new Date("2026-10-03T12:30:00Z") },
      { userId: "a", kind: "SPEND", amount: -10, createdAt: new Date("2026-10-04T12:30:00Z") }
    ]);
    expect(await f.run()).toBeNull();
    f.db.communityPoint.findMany.mockResolvedValue([
      ...await f.db.communityPoint.findMany(),
      { userId: "a", kind: "AWARD", amount: 10, createdAt: new Date("2026-10-04T12:30:00Z") }
    ]);
    expect((await f.run())?.activeDays).toBe(3);
  });

  it("skips absent members, bots through lookup, test accounts, and zero scores", async () => {
    const f = fixture();
    f.lookup.mockResolvedValue(null);
    expect(await f.run()).toBeNull();
    f.lookup.mockResolvedValue(fresh);
    f.db.member.findMany.mockResolvedValue([{ discordUserId: "a" }, { discordUserId: "b" }]);
    expect(await f.run()).toBeNull();
    expect(await f.run([{ userId: "a", points: 0, balance: 10 }])).toBeNull();
  });

  it("breaks ties by active days, then join date, then stable Discord id", async () => {
    const f = fixture();
    const tied = board.map(row => ({ ...row, points: 40 }));
    f.joins.set("b", new Date("2026-10-02T12:00:00Z"));
    expect((await f.run(tied))?.userId).toBe("b");
    const activity = await f.db.communityParticipationDay.findMany();
    f.db.communityParticipationDay.findMany.mockResolvedValue([...activity, { userId: "a", day: "2026-10-05", messages: 1, reactions: 0, voiceMs: 0 }]);
    expect((await f.run(tied))?.userId).toBe("a");
  });

  it("does not silently discard a candidate when Discord fails temporarily", async () => {
    const fetch = vi.fn().mockRejectedValue({ code: 50013 });
    const lookup = rookieMemberLookup({ members: { fetch } } as unknown as Guild);
    await expect(lookup("a")).rejects.toMatchObject({ code: 50013 });
    fetch.mockRejectedValue({ code: 10007 });
    expect(await lookup("a")).toBeNull();
    fetch.mockResolvedValue({ user: { bot: true }, joinedAt: fresh });
    expect(await lookup("a")).toBeNull();
  });

  it("retains the earliest join when recording a repeated join event", async () => {
    const f = fixture();
    const db = f.db as unknown as Prisma.TransactionClient;
    await rememberRookieJoin(db, "guild", "a", fresh);
    await rememberRookieJoin(db, "guild", "a", new Date("2026-10-15T00:00:00Z"));
    expect(f.joins.get("a")).toEqual(fresh);
  });
});
