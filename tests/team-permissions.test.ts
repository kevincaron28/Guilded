import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  leader: false,
  context: vi.fn(async () => ({ guildId: "guild", memberId: "member" })),
  prisma: {
    guildSettings: { findUnique: vi.fn(async () => ({ language: "en" })) },
    activityCore: { findFirst: vi.fn() },
    activitySession: { findFirst: vi.fn() }
  },
  guildService: { ensureGuild: vi.fn(async () => ({ id: "guild" })), ensureMember: vi.fn() }
}));
vi.mock("../src/database.js", () => ({ prisma: state.prisma }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: state.context, guildService: state.guildService }));
vi.mock("../src/permissions.js", () => ({ hasPermission: () => state.leader }));
import { executeTeam, handleTeamButton } from "../src/commands/team.js";

function interaction(sub: string) {
  const member = { id: "user" };
  const channel = { isTextBased: () => true, isThread: () => false, send: vi.fn(), permissionsFor: () => ({ has: () => false }) };
  return { guild: { id: "discord", name: "Guild", members: { fetch: vi.fn(async () => member) }, channels: { fetch: vi.fn(async () => channel) } },
    guildId: "discord", user: { id: "user" }, options: { getSubcommand: () => sub, getString: () => "core" },
    deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn() };
}

describe("team management permissions", () => {
  beforeEach(() => { vi.clearAllMocks(); state.leader = false; });
  it.each(["create", "member", "schedule", "session", "attendance", "lineup", "archive"])("requires fresh leadership for %s", async sub => {
    const i = interaction(sub);
    await expect(executeTeam(i as never)).rejects.toThrow(/Raid Leader/);
    expect(i.guild.members.fetch).toHaveBeenCalledWith("user");
    expect(state.prisma.activityCore.findFirst).not.toHaveBeenCalled();
    expect(state.prisma.activitySession.findFirst).not.toHaveBeenCalled();
  });
  it("does not expose a private roster through /team show", async () => {
    state.prisma.activityCore.findFirst.mockResolvedValue({ id: "core", channelId: "private", members: [] });
    const i = interaction("show");
    await expect(executeTeam(i as never)).rejects.toThrow(/cannot view/);
    expect(i.editReply).not.toHaveBeenCalled();
  });
  it("rejects a button replayed in another channel", async () => {
    state.prisma.activitySession.findFirst.mockResolvedValue({ id: "session", core: { channelId: "private" } });
    const i = { ...interaction(""), customId: "team:session:TANK", channelId: "public" };
    await expect(handleTeamButton(i as never)).rejects.toThrow(/not found in this channel/);
    expect(state.guildService.ensureMember).not.toHaveBeenCalled();
  });
});
