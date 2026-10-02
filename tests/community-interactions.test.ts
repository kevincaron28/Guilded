import { beforeEach, describe, expect, it, vi } from "vitest";
import { Collection, PermissionFlagsBits } from "discord.js";

const mocks = vi.hoisted(() => ({
  enterLottery: vi.fn(async () => ({ quantity: 3, status: "CONFIRMED" })), create: vi.fn(),
  activity: vi.fn(), season: vi.fn(), ensureGuild: vi.fn(async () => ({ id: "guild" })),
  settings: vi.fn(async () => ({ language: "fr", timezone: "America/Toronto" }))
}));
vi.mock("../src/database.js", () => ({ prisma: { communityActivity: { findFirst: mocks.activity }, communitySeason: { findFirst: mocks.season } } }));
vi.mock("../src/commands/context.js", () => ({ guildService: { ensureGuild: mocks.ensureGuild, getSettings: mocks.settings }, requireGuildContext: vi.fn() }));
vi.mock("../src/services/community.js", () => ({ createCommunityService: () => ({ enterLottery: mocks.enterLottery, create: mocks.create }) }));

import { handleCommunityButton, handleCommunityModal } from "../src/commands/community.js";
import { handleCommunityHub } from "../src/commands/community-hub.js";
import { dispatchDiscordJob } from "../src/services/discord-jobs.js";

const season = { id: "season", guildId: "guild", game: "DISCORD", status: "ACTIVE", channelId: "board", announcementChannelId: "activities", audienceRoleId: null };
const row = { id: "draw", season, postedChannelId: "activities", title: "Tirage", rules: { mode: "POINTS", cost: 10, prize: "Lot", currency: "points", realm: "", winners: 1, maxTickets: 5 } };
const member = { user: { bot: false }, roles: { cache: new Collection() }, permissions: { has: () => false } };
const channel = { permissionsFor: () => ({ has: () => true }) };

function interaction(customId: string) {
  return {
    customId, channelId: "activities", user: { id: "actor" },
    guild: { id: "discord", name: "Guild", members: { fetch: vi.fn(async () => member) }, channels: { fetch: vi.fn(async () => channel) } },
    deferReply: vi.fn(), editReply: vi.fn(), showModal: vi.fn(), fields: { getTextInputValue: vi.fn(() => "3") },
    isButton: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false, isModalSubmit: () => true
  };
}
beforeEach(() => { vi.clearAllMocks(); mocks.activity.mockResolvedValue(row); mocks.season.mockResolvedValue(season); });

describe("persistent community interactions", () => {
  it("blocks a queued reminder if its destination becomes more public", async () => {
    mocks.activity.mockResolvedValue({ ...row, status: "OPEN" });
    const source = { permissionOverwrites: { cache: new Collection([["everyone", { id: "everyone", type: 0, allow: { bitfield: 0n }, deny: { bitfield: PermissionFlagsBits.ViewChannel } }]]) } };
    const target = { permissionOverwrites: { cache: new Collection() } };
    const guild = { client: { user: { id: "bot" } }, channels: { fetch: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(target) } };
    await expect(dispatchDiscordJob(guild as never, { kind: "MESSAGE", guildId: "guild", key: "community-reminder:draw", payload: { channelId: "activities" } } as never)).rejects.toThrow("same visibility");
    expect(guild.channels.fetch).toHaveBeenCalledTimes(2);
  });
  it("collects a points ticket quantity without spending, then spends only on explicit confirmation", async () => {
    const form = interaction("community:tickets:draw");
    await handleCommunityModal(form as never);
    expect(mocks.enterLottery).not.toHaveBeenCalled();
    expect(form.editReply.mock.calls[0]![0].content).toContain("30 points");
    const confirm = interaction("community:buy:draw:3:30:actor");
    await handleCommunityButton(confirm as never);
    expect(mocks.enterLottery).toHaveBeenCalledExactlyOnceWith("guild", "draw", "actor", 3);
    expect(confirm.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });
  it.each(["community:buy:draw:3:30:other", "community:buy:draw:3:10:actor", "community:buy:draw:0:0:actor"])("rejects altered confirmations: %s", async id => {
    await expect(handleCommunityButton(interaction(id) as never)).rejects.toThrow("Invalid confirmation");
    expect(mocks.enterLottery).not.toHaveBeenCalled();
  });
  it("rechecks destination access before a confirmed purchase", async () => {
    const button = interaction("community:buy:draw:3:30:actor");
    button.guild.channels.fetch.mockResolvedValueOnce(channel).mockResolvedValueOnce({ permissionsFor: () => ({ has: () => false }) });
    await expect(handleCommunityButton(button as never)).rejects.toThrow("Access denied");
    expect(mocks.enterLottery).not.toHaveBeenCalled();
  });
  it("rechecks officer authority at template submission, even with an old valid form", async () => {
    await expect(handleCommunityHub(interaction("community:hub-create-quiz:season") as never)).rejects.toThrow("Access denied");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
