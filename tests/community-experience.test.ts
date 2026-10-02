import { beforeEach, describe, expect, it, vi } from "vitest";
import { Collection, PermissionFlagsBits } from "discord.js";
import { communityActivityChannel, communityDiceDay, communitySeasonLabel } from "../src/services/community-display.js";
import { communityHubCard, communityHubComponents } from "../src/services/community-panels.js";
import { communityAudience } from "../src/services/community-leaderboard.js";
import { accessibleCommunityPolls, accessibleCommunitySeasons, assertCommunityChannelAudience, resolveCommunitySeason } from "../src/services/community-access.js";
import { communityChoices } from "../src/services/community-choices.js";
import { lotteryConfirmation } from "../src/commands/community.js";

const season = { id: "cmseason", guildId: "guild", game: "DISCORD", name: "Octobre 2026", number: 1, status: "ACTIVE", channelId: "board", announcementChannelId: "activities", audienceRoleId: null };
const member = { user: { bot: false }, roles: { cache: new Collection() }, permissions: { has: () => false } };
const guild = { members: { fetch: vi.fn(async () => member) }, channels: { fetch: vi.fn() } };
const database = { communitySeason: { findFirst: vi.fn(), findMany: vi.fn() }, communityActivity: { findMany: vi.fn() }, poll: { findMany: vi.fn(async () => []) } };

beforeEach(() => {
  vi.clearAllMocks();
  database.communitySeason.findMany.mockResolvedValue([season]);
  database.communitySeason.findFirst.mockResolvedValue(season);
  guild.channels.fetch.mockImplementation(async (id?: string) => id ? { permissionsFor: () => ({ has: () => true }) } : new Collection([["board", { id: "board", permissionsFor: () => ({ has: () => true }) }], ["activities", { id: "activities", permissionsFor: () => ({ has: () => true }) }], ["secret", { id: "secret", permissionsFor: () => ({ has: () => false }) }]]));
});

describe("community member navigation", () => {
  it("uses readable numbered names, without duplicating a legacy Season prefix", () => {
    expect(communitySeasonLabel(season, "fr")).toBe("Saison 1 — Octobre 2026");
    expect(communitySeasonLabel({ name: "Season 1", number: 1 }, "fr")).toBe("Saison 1");
    expect(communitySeasonLabel({ name: "Saison 1 — Automne", number: 1 }, "en")).toBe("Season 1 — Automne");
  });
  it.each([
    ["2026-03-08T05:01:00Z", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01T04:01:00Z", "2026-11-02T05:00:00.000Z"],
    ["2026-10-03T03:59:59Z", "2026-10-03T04:00:00.000Z"]
  ])("calculates next midnight across Toronto clock changes: %s", (now, reset) => {
    expect(communityDiceDay(new Date(now), "America/Toronto").reset.toISOString()).toBe(reset);
  });
  it("pins a working dice action and makes archived dice read-only for everyone", () => {
    const active = communityHubComponents(season, "fr")[0]!.toJSON().components[0]!;
    const ended = communityHubComponents({ ...season, status: "ENDED" }, "fr")[0]!.toJSON().components[0]!;
    expect(active).toMatchObject({ custom_id: "community:hub-dice:cmseason", disabled: false });
    expect(ended).toMatchObject({ disabled: true });
    expect(JSON.stringify(communityHubCard(season, "fr"))).not.toContain("season:cmseason");
    expect(JSON.stringify(communityHubCard(season, "fr"))).toContain("non configurés");
  });
  it("retains original post destinations when a season routes new announcements elsewhere", () => {
    expect(communityActivityChannel({ postedChannelId: "old", season })).toBe("old");
    expect(communityActivityChannel({ season })).toBe("activities");
    expect(communityActivityChannel({ season: { channelId: "legacy" } })).toBe("legacy");
  });
  it("does not broaden visibility when posting the hub into a sibling channel", () => {
    const hidden = { permission_overwrites: [{ id: "everyone", type: 0, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() }] };
    expect(communityAudience(hidden, "bot")).not.toBe(communityAudience({}, "bot"));
    expect(communityAudience({ permission_overwrites: [...hidden.permission_overwrites, { id: "bot", type: 1, allow: "1024", deny: "0" }] }, "bot")).toBe(communityAudience(hidden, "bot"));
  });
  it("filters autocomplete's query by current channel and role visibility", async () => {
    await accessibleCommunitySeasons(database as never, guild as never, "guild", "actor");
    expect(database.communitySeason.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", channelId: { in: ["board", "activities"] }, OR: [{ audienceRoleId: null }, { audienceRoleId: { in: [] } }] } }));
  });
  it("features only open polls in visible community destinations, never another category", async () => {
    await accessibleCommunityPolls(database as never, guild as never, "guild", "actor", { ...season, announcementChannelId: "secret" } as never);
    expect(database.poll.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild", channelId: { in: ["board"] }, closed: false, messageId: { not: null } }) }));
  });
  it("rechecks channel visibility when executing a previously selected season", async () => {
    guild.channels.fetch.mockResolvedValueOnce({ permissionsFor: () => ({ has: () => false }) });
    await expect(resolveCommunitySeason(database as never, guild as never, "guild", "actor", season.id)).rejects.toThrow("Access denied");
  });
  it("blocks routed publication if destination visibility changes after configuration", async () => {
    const privateChannel = { permissionOverwrites: { cache: new Collection([["everyone", { id: "everyone", type: 0, allow: { bitfield: 0n }, deny: { bitfield: PermissionFlagsBits.ViewChannel } }]]) } };
    const publicChannel = { permissionOverwrites: { cache: new Collection() } };
    const live = { client: { user: { id: "bot" } }, channels: { fetch: vi.fn().mockResolvedValueOnce(privateChannel).mockResolvedValueOnce(publicChannel) } };
    await expect(assertCommunityChannelAudience(live as never, "board", "activities")).rejects.toThrow("same visibility");
    expect(live.channels.fetch).toHaveBeenCalledWith("activities", { force: true });
  });
  it("does not guess when no active Discord season is available", async () => {
    database.communitySeason.findMany.mockResolvedValueOnce([{ ...season, status: "ENDED" }]);
    await expect(resolveCommunitySeason(database as never, guild as never, "guild", "actor", null)).rejects.toThrow("No accessible");
  });
  it("offers archive names for wallets and only active Discord seasons for dice", async () => {
    database.communitySeason.findMany.mockResolvedValue([{ ...season, status: "ENDED" }, { ...season, id: "wow", game: "WOW", number: 2 }, { ...season, id: "current", number: 3 }]);
    const dice = await communityChoices(database as never, guild as never, "guild", "actor", "community", "dice", "season", "", "fr");
    expect(dice.map(c => c.value)).toEqual(["current"]);
    const archive = await communityChoices(database as never, guild as never, "guild", "actor", "community", "wallet", "season", "archivée", "fr");
    expect(archive).toEqual([{ name: "DISCORD · Saison 1 — Octobre 2026 · Archivée", value: "cmseason" }]);
  });
  it("binds points purchase confirmation to the displayed total and the purchaser", () => {
    const row = { id: "draw", title: "Tirage", rules: { mode: "POINTS", cost: 10, prize: "Lot", currency: "points", realm: "", winners: 1, maxTickets: 5 } };
    const result = lotteryConfirmation(row as never, 3, "actor", "fr");
    expect(result.content).toContain("**30 points**");
    expect(result.components[0]!.toJSON().components[0]).toMatchObject({ custom_id: "community:buy:draw:3:30:actor" });
    expect(() => lotteryConfirmation(row as never, 6, "actor", "fr")).toThrow();
    expect(() => lotteryConfirmation(row as never, NaN, "actor", "fr")).toThrow();
  });
});
