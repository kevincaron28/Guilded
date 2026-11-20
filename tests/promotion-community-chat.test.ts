import { describe, expect, it } from "vitest";
import { ChannelType } from "discord.js";
import { findCommunityChatChannelId, guildChannelLikes, postPromotionCongrats, promotionCongratsChannel, queuePromotionCongrats, spreadSchedule, type ChannelLike } from "../src/services/promotion.js";
import { deliverDiscordJob, enqueueDiscordJob } from "../src/services/discord-jobs.js";

const cat = (id: string, name: string): ChannelLike => ({ id, name, type: ChannelType.GuildCategory });
const text = (id: string, name: string, parentId: string | null): ChannelLike => ({ id, name, type: ChannelType.GuildText, parentId });
const USER = "123456789012345678";

describe("community chat channel lookup", () => {
  it("finds the chat channel inside the Community category, in either language", () => {
    expect(findCommunityChatChannelId([cat("c1", "Community"), text("t1", "community-chat", "c1")])).toBe("t1");
    expect(findCommunityChatChannelId([cat("c1", "Communauté"), text("t1", "activités", "c1"), text("t2", "chat-communauté", "c1")])).toBe("t2");
  });
  it("ignores a same-named channel outside the Community category, voice channels and other names", () => {
    expect(findCommunityChatChannelId([cat("c1", "Community"), cat("c2", "General"), text("t1", "community-chat", "c2"), { id: "v1", name: "community-chat", type: ChannelType.GuildVoice, parentId: "c1" }, text("t3", "activities", "c1")])).toBeNull();
    expect(findCommunityChatChannelId([])).toBeNull();
  });
  it("reads a discord.js channel cache", () => {
    const guild = { channels: { cache: new Map([["c1", { id: "c1", name: "Community", type: 4, parentId: null }], ["t1", { id: "t1", name: "community-chat", type: 0, parentId: "c1" }]]) } };
    expect(findCommunityChatChannelId(guildChannelLikes(guild))).toBe("t1");
    expect(guildChannelLikes({})).toEqual([]);
  });
  it("prefers the chat channel, else announcements, else hall of fame", async () => {
    const db = { communitySeason: { findFirst: async () => ({ announcementChannelId: "ann" }) }, communityHonors: { findUnique: async () => ({ channelId: "fame" }) } } as never;
    const channels = [cat("c1", "Community"), text("t1", "community-chat", "c1")];
    expect(await promotionCongratsChannel(db, "g", channels)).toBe("t1");
    expect(await promotionCongratsChannel(db, "g", [])).toBe("ann");
    const noSeason = { communitySeason: { findFirst: async () => null }, communityHonors: { findUnique: async () => ({ channelId: "fame" }) } } as never;
    expect(await promotionCongratsChannel(noSeason, "g")).toBe("fame");
  });
  it("posts the live congratulations to the chat channel of the guild cache", async () => {
    const jobs = new Map<string, { payload: Record<string, unknown> }>();
    const db = {
      guildSettings: { findUnique: async () => ({ language: "en", promotionCongratsEnabled: true }) },
      communitySeason: { findFirst: async () => null }, communityHonors: { findUnique: async () => ({ channelId: "fame" }) },
      member: { findMany: async () => [{ id: "m1", discordUserId: USER, displayName: "Simon" }] },
      discordJob: { findMany: async () => [], upsert: async ({ where, create }: { where: { guildId_key: { key: string } }; create: { payload: Record<string, unknown> } }) => { jobs.set(where.guildId_key.key, create); return create; } }
    } as never;
    const guild = { members: {}, channels: { cache: new Map([["c1", { id: "c1", name: "Community", type: 4 }], ["t1", { id: "t1", name: "community-chat", type: 0, parentId: "c1" }]]) } } as never;
    expect(await postPromotionCongrats(db, guild, "g", [{ name: "Halidor", rankName: "Member", memberId: "m1" }])).toBe(1);
    expect([...jobs.values()][0]!.payload["channelId"]).toBe("t1");
  });
});

describe("spread backfill", () => {
  it("spaces card i of n evenly, the first right away", () => {
    const start = new Date("2026-11-20T10:00:00Z");
    expect(spreadSchedule(4, 8, start).map((d) => d!.toISOString())).toEqual(["2026-11-20T10:00:00.000Z", "2026-11-20T12:00:00.000Z", "2026-11-20T14:00:00.000Z", "2026-11-20T16:00:00.000Z"]);
    expect(spreadSchedule(3, 0, start)).toEqual([undefined, undefined, undefined]);
    expect(spreadSchedule(0, 5, start)).toEqual([]);
  });
  it("queues a card job with its own release time and the worker waits for it", async () => {
    let row: Record<string, unknown> | null = null;
    const db = { discordJob: {
      findUnique: async () => row ? { ...row } : null, findMany: async () => [],
      upsert: async ({ create }: { create: Record<string, unknown> }) => { row = { id: "j", revision: 1, status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedUntil: null, leaseToken: null, ...create }; return row; },
      updateMany: async ({ where, data }: { where: { nextAttemptAt?: { lte: Date } }; data: Record<string, unknown> }) => {
        if (where.nextAttemptAt && (row!["nextAttemptAt"] as Date) > where.nextAttemptAt.lte) return { count: 0 };
        row = { ...row!, ...data, attempts: 1 }; return { count: 1 };
      }
    } } as never;
    const later = new Date(Date.now() + 3_600_000);
    expect(await queuePromotionCongrats(db, "g", "chan", "en", { userId: USER, memberName: "Simon", name: "Halidor", rankName: "Member", at: new Date() }, later)).toBe(true);
    expect(row!["nextAttemptAt"]).toEqual(later);
    expect(await deliverDiscordJob(db, "j", async () => { throw new Error("too early"); })).toBe(false);
    expect(await deliverDiscordJob(db, "j", async () => {}, new Date(later.getTime() + 1))).toBe(true);
  });
  it("without a release time the job is due immediately (live path unchanged)", async () => {
    let created: Record<string, unknown> = {};
    const db = { discordJob: { upsert: async ({ create }: { create: Record<string, unknown> }) => { created = create; return create; } } } as never;
    await enqueueDiscordJob(db, "g", "k", "MESSAGE", {});
    expect("nextAttemptAt" in created).toBe(false);
  });
});
