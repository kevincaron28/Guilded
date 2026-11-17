import { describe, expect, it, vi } from "vitest";
import { selectWarmupTargets, warmStandings, type WarmupRow } from "../src/services/standings-warmup.js";

const now = Date.UTC(2026, 10, 17, 12);
const row = (guildId: string, memberId: string, minutesAgo: number | null): WarmupRow => ({ guildId, memberId, discordUserId: `u-${memberId}`, guildDiscordId: `d-${guildId}`, lastUsedAt: minutesAgo === null ? null : new Date(now - minutesAgo * 60_000) });

describe("selectWarmupTargets", () => {
  it("takes the most recent member of each guild, newest guilds first", () => {
    const out = selectWarmupTargets([row("g1", "a", 30), row("g2", "b", 5), row("g1", "c", 10)], now);
    expect(out.map((t) => [t.guildId, t.memberId, t.actorId])).toEqual([["g2", "b", "u-b"], ["g1", "c", "u-c"]]);
  });
  it("skips old, never-used and future rows and caps the guild count", () => {
    expect(selectWarmupTargets([row("g1", "a", 7 * 60), row("g2", "b", null), row("g3", "c", -30)], now)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => row(`g${i}`, `m${i}`, i + 1));
    expect(selectWarmupTargets(many, now, 3).map((t) => t.guildId)).toEqual(["g0", "g1", "g2"]);
  });
});

describe("warmStandings", () => {
  const prismaWith = (rows: unknown[]) => ({ companionCredential: { findMany: vi.fn(async () => rows) } }) as never;
  const credential = (guildId: string, minutesAgo: number) => ({ memberId: `m-${guildId}`, lastUsedAt: new Date(now - minutesAgo * 60_000), member: { discordUserId: `u-${guildId}`, guildId, guild: { discordId: `d-${guildId}` } } });

  it("builds one guild at a time and keeps going after a failure", async () => {
    const order: string[] = [];
    const build = vi.fn(async (t: { guildId: string }) => { order.push(t.guildId); if (t.guildId === "g1") throw new Error("boom"); });
    const result = await warmStandings(prismaWith([credential("g1", 1), credential("g2", 2)]), { build, now: () => now, sleep: async () => undefined });
    expect(order).toEqual(["g1", "g2"]);
    expect(result).toEqual({ warmed: 1, failed: 1 });
  });
  it("never throws when the lookup fails", async () => {
    const prisma = { companionCredential: { findMany: async () => { throw new Error("db down"); } } } as never;
    await expect(warmStandings(prisma, { build: async () => undefined, now: () => now })).resolves.toEqual({ warmed: 0, failed: 0 });
  });
});
