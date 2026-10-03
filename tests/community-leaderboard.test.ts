import { describe, expect, it, vi } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { COMMUNITY_BOARD_MARKER, communityLeaderboardCard, updateCommunityLeaderboard } from "../src/services/community-leaderboard.js";

const season = { id: "season", name: "Season 1", status: "ACTIVE" };

describe("community podium", () => {
  it("shares medal ranks for ties and keeps spending separate from earned score", () => {
    const card = communityLeaderboardCard({ lang: "fr", discordId: "guild", season, names: new Map([["c", "Kevin"]]), board: [
      { userId: "a", points: 100, balance: 20 }, { userId: "b", points: 100, balance: 100 },
      { userId: "c", points: 50, balance: 50 }, { userId: "zero", points: 0, balance: 0 }
    ] });
    const top = card.embeds[0]!.fields![0]!.value;
    expect(top.match(/🥇/g)).toHaveLength(2);
    expect(top).toContain("🥉 **Kevin**");
    expect(top).not.toContain("<@");
    expect(top).toContain("**100 pts**");
    expect(top).not.toContain("zero");
    expect(card.embeds[0]!.fields![1]!.value).toContain("**250 pts**");
    expect(card.allowed_mentions.parse).toEqual([]);
  });
  it("offers working channel links and commands, without inventing awards before a season", () => {
    const card = communityLeaderboardCard({ lang: "en", discordId: "guild", season: null, board: [], activitiesId: "activities", chatId: "chat" });
    expect(card.components[0]!.components).toHaveLength(2);
    expect(JSON.stringify(card.components)).toContain("https://discord.com/channels/guild/activities");
    expect(JSON.stringify(card.embeds)).not.toContain("/community dice season:");
    const archived = communityLeaderboardCard({ lang: "fr", discordId: "guild", season: { ...season, status: "ENDED" }, board: [] });
    expect(JSON.stringify(archived)).not.toContain("/community dice season:");
  });
  it("fits Discord embed limits with ten ranked members and a full season name", () => {
    const card = communityLeaderboardCard({ lang: "fr", discordId: "guild", season: { ...season, name: "*".repeat(80) }, board: Array.from({ length: 100 }, (_, i) => ({ userId: `${100000000000000000n + BigInt(i)}`, points: 10000 - i, balance: 0 })) });
    let total = 0;
    for (const embed of card.embeds) {
      const fields = embed.fields ?? [];
      expect(embed.description!.length).toBeLessThanOrEqual(4096);
      for (const field of fields) expect(field.value.length).toBeLessThanOrEqual(1024);
      total += (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    }
    expect(total).toBeLessThanOrEqual(6000);
  });
});

function fixture() {
  const category = { id: "category", name: "Communauté", type: ChannelType.GuildCategory, permission_overwrites: [{ id: "guild", type: 0, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() }] };
  const channel = { id: "channel", parent_id: "category", name: "classement", type: ChannelType.GuildText, permission_overwrites: [{ id: "guild", type: 0, allow: PermissionFlagsBits.ViewChannel.toString(), deny: "0" }] };
  const database = { guild: { findUnique: vi.fn(async () => ({ id: "record", settings: { language: "fr" } })) }, communitySeason: { findFirst: vi.fn(async () => null) }, communityPoint: { findMany: vi.fn(async () => []) } };
  const message = { id: "message", author: { id: "bot" }, embeds: [{ footer: { text: COMMUNITY_BOARD_MARKER } }], components: [] };
  const rest = {
    get: vi.fn(async (route: string) => route.includes("/pins") ? { items: [{ message }] } : route.includes("/messages") ? [message] : [category, channel]),
    patch: vi.fn(async (route: string, options: unknown) => { void options; return route.includes("/messages") ? message : channel; }),
    post: vi.fn(async () => message), put: vi.fn(async () => {}), delete: vi.fn(async () => {})
  };
  return { category, channel, database, message, rest };
}

describe("community board maintenance", () => {
  it("renders live nicknames and saved names when Discord cannot resolve a member", async () => {
    const f = fixture();
    f.database.communitySeason.findFirst.mockResolvedValue(season as never);
    f.database.communityPoint.findMany.mockResolvedValue([
      { userId: "one", amount: 44, kind: "AWARD" }, { userId: "two", amount: 32, kind: "AWARD" }
    ] as never);
    const database = { ...f.database, member: { findMany: vi.fn(async () => [
      { discordUserId: "one", displayName: "Old name" }, { discordUserId: "two", displayName: "Saved *name*" }
    ]) } };
    const originalGet = f.rest.get.getMockImplementation()!;
    f.rest.get.mockImplementation(async route => {
      if (route === "/guilds/guild/members/one") return { nick: "Live nickname", user: { username: "Account" } } as never;
      if (route.includes("/members/") || route.startsWith("/users/")) throw new Error("Unavailable");
      return originalGet(route);
    });
    await updateCommunityLeaderboard(f.rest as never, database as never, "guild", "bot");
    const body = (f.rest.patch.mock.calls[0]![1] as { body: { embeds: { fields: { value: string }[] }[] } }).body;
    expect(body.embeds[0]!.fields[0]!.value).toContain("Live nickname");
    expect(body.embeds[0]!.fields[0]!.value).toContain("Saved \\*name\\*");
    expect(body.embeds[0]!.fields[0]!.value).not.toContain("<@");
    await updateCommunityLeaderboard(f.rest as never, database as never, "guild", "bot");
    expect(database.member.findMany).toHaveBeenCalledTimes(1);
    expect(f.rest.get.mock.calls.filter(([route]) => route.includes("/members/"))).toHaveLength(2);
  });

  it("upgrades the existing activity guide in place without a duplicate pinned hub", async () => {
    const { rest, database, category, channel, message } = fixture();
    const hub = { ...channel, id: "activities", name: "activites" };
    const guide = { ...message, id: "guide", embeds: [{ footer: { text: "Guilded 5.0 setup activities" } }] };
    rest.get.mockResolvedValueOnce([category, channel, hub]).mockResolvedValueOnce({ items: [{ message }] } as never).mockResolvedValueOnce({ items: [{ message: guide }] } as never);
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.put).not.toHaveBeenCalled();
    expect(rest.patch).toHaveBeenCalledWith("/channels/activities/messages/guide", expect.objectContaining({ body: expect.objectContaining({ components: expect.any(Array) }) }));
  });
  it("updates the existing pinned board and confines scores to unrestricted Discord seasons in this channel", async () => {
    const { rest, database } = fixture();
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    expect(database.communitySeason.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "record", channelId: "channel", game: "DISCORD", audienceRoleId: null } }));
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.put).not.toHaveBeenCalled();
    expect(rest.patch).toHaveBeenCalledTimes(1);
  });
  it("preserves channel visibility while making the provisioned board read-only", async () => {
    const { rest, database } = fixture();
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot", { categoryId: "category" });
    const body = rest.patch.mock.calls[0]![1] as unknown as { body: { permission_overwrites: { id: string; allow: string; deny: string }[] } };
    const everyone = body.body.permission_overwrites.find(o => o.id === "guild")!;
    expect(BigInt(everyone.allow) & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);
    expect(BigInt(everyone.deny) & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    const bot = body.body.permission_overwrites.find(o => o.id === "bot")!;
    expect(BigInt(bot.allow) & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
  });
  it("refuses ambiguous channels and never creates a channel on periodic refresh", async () => {
    const { rest, database, category, channel } = fixture();
    rest.get.mockResolvedValueOnce([category]);
    expect(await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot")).toBeNull();
    expect(rest.post).not.toHaveBeenCalled();
    rest.get.mockResolvedValueOnce([category, channel, { ...channel, id: "another" }]);
    await expect(updateCommunityLeaderboard(rest as never, database as never, "guild", "bot")).rejects.toThrow("Multiple");
    expect(rest.patch).not.toHaveBeenCalled();
  });
  it("unpins only the old bot-owned guide during explicit provisioning, preserving other pins", async () => {
    const { rest, database, category, channel, message } = fixture();
    rest.get.mockResolvedValueOnce([category, channel]).mockResolvedValueOnce({ items: [
      { message }, { message: { ...message, id: "old", embeds: [{ title: "Classements et participation" }] } },
      { message: { ...message, id: "member", author: { id: "member" }, embeds: [{ title: "Classements et participation" }] } }
    ] } as never);
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot", { categoryId: "category" });
    expect(rest.delete).toHaveBeenCalledExactlyOnceWith("/channels/channel/messages/pins/old");
  });
});
