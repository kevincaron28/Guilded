import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

const mocks = vi.hoisted(() => ({
  requireGuildContext: vi.fn(), getSettings: vi.fn(), cooperative: vi.fn(), recap: vi.fn(), hasPermission: vi.fn(), saveQuestion: vi.fn(), reviewQuestion: vi.fn(), saveGoal: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.requireGuildContext,
  guildService: { getSettings: mocks.getSettings } }));
vi.mock("../src/services/cooperative-goal.js", () => ({ cooperativeGoalStatus: mocks.cooperative, saveCooperativeGoal: mocks.saveGoal }));
vi.mock("../src/services/weekly-question-store.js", () => ({ saveWeeklyQuestion: mocks.saveQuestion, reviewWeeklyQuestion: mocks.reviewQuestion, pauseWeeklyQuestion: vi.fn(), actOnWeeklyQuestion: vi.fn() }));
vi.mock("../src/services/personal-weekly-recap.js", () => ({ personalWeeklyRecap: mocks.recap, personalWeeklyRecapEmbed: () => ({ title: "private recap" }) }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.hasPermission }));

import { executeDungeon, dungeonCommand } from "../src/commands/dungeon.js";
import { executeStats, statsCommand } from "../src/commands/stats.js";
import { executePoll, pollCommand } from "../src/commands/poll.js";

function interaction() {
  return { user: { id: "actor" }, options: { getSubcommand: () => "together", getBoolean: (name: string) => name === "personal" ? true : null, getInteger: () => null, getString: () => null },
    deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn(), followUp: vi.fn(), channel: { send: vi.fn() } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireGuildContext.mockResolvedValue({ guildId: "guild", memberId: "member" });
  mocks.getSettings.mockResolvedValue({ language: "en" });
  mocks.cooperative.mockResolvedValue({ status: "active", goal: { target: 10, metric: "dungeons", edition: "forever", startsAt: new Date(0), endsAt: new Date(86400000) }, value: 2, progress: { participants: 4 }, complete: false, ended: false });
  mocks.reviewQuestion.mockResolvedValue({ plan: { paused: false }, settings: { question: "Which dungeon next?", options: [], minute: 1140, weekday: 5, timezone: "America/Toronto", channelId: "123456789012345678" }, review: { id: "review", weekKey: "2026-10-26" }, occurrence: null });
  mocks.recap.mockResolvedValue({});
  mocks.hasPermission.mockReturnValue(true);
});

describe("private preview command integration with mocked Discord/database", () => {
  it("uses the authenticated guild and responds ephemerally without a channel post", async () => {
    const i = interaction(); await executeDungeon(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.cooperative).toHaveBeenCalledWith({}, "guild");
    expect(i.editReply.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(i.channel.send).not.toHaveBeenCalled(); expect(i.reply).not.toHaveBeenCalled();
    expect(i.editReply.mock.calls[0]![0].embeds[0].toJSON().description).toContain("2/10 different dungeons");
  });
  it("never falls back to public guild stats for personal recap", async () => {
    const i = interaction(); await executeStats(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.recap).toHaveBeenCalledWith({}, "guild", "actor");
    expect(i.reply).not.toHaveBeenCalled(); expect(i.channel.send).not.toHaveBeenCalled();
  });
  it("refuses contradictory filters and stops when guild authorization fails", async () => {
    const i = interaction(); i.options.getInteger = () => 14 as never;
    await executeStats(i as never); expect(mocks.recap).not.toHaveBeenCalled();
    mocks.requireGuildContext.mockResolvedValue(null);
    await executeDungeon(i as never); expect(mocks.cooperative).not.toHaveBeenCalled();
  });
  it("displays unsupported/truncated progress honestly in French", async () => {
    mocks.getSettings.mockResolvedValue({ language: "fr" });
    for (const progress of [{ status: "scope-changed" }, { status: "too-many-runs" }]) {
      mocks.cooperative.mockResolvedValue(progress);
      const i = interaction(); await executeDungeon(i as never);
      const embed = i.editReply.mock.calls[0]![0].embeds[0].toJSON();
      expect(embed.title).toContain("Jouer ensemble");
      expect(embed.description).not.toContain("undefined");
    }
  });
  it("previews the moderator's weekly question without posting, scheduling or storing a poll", async () => {
    const i = { ...interaction(), member: { id: "actor" }, guild: { members: { me: { id: "bot" } } }, channelId: "123456789012345678",
      channel: { permissionsFor: () => ({ has: () => true }), send: vi.fn() },
      options: { getSubcommand: () => "weekly-preview", getInteger: () => 5, getString: (name: string) => ({ time: "19:00", question: "Which dungeon next?" } as Record<string, string>)[name] ?? null } };
    await executePoll(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(i.editReply.mock.calls[0]![0].embeds[0].toJSON().footer.text).toContain("/automation question");
    expect(mocks.saveQuestion).toHaveBeenCalled();
    expect(i.channel.send).not.toHaveBeenCalled();
    mocks.hasPermission.mockReturnValue(false);
    const denied = { ...i, reply: vi.fn() }; await executePoll(denied as never);
    expect(denied.reply.mock.calls[0]![0].content).toContain("Only Officers");
  });
  it("keeps modified slash command definitions below Discord limits", () => {
    type Node = { name?: string; description?: string; value?: unknown; options?: Node[]; choices?: Node[] };
    const size = (node: Node): number => (node.name?.length ?? 0) + (node.description?.length ?? 0) + (typeof node.value === "string" ? node.value.length : 0)
      + [...(node.options ?? []), ...(node.choices ?? [])].reduce((sum, child) => sum + size(child), 0);
    for (const command of [dungeonCommand, statsCommand, pollCommand]) {
      expect(size(command.toJSON() as Node)).toBeLessThanOrEqual(3900);
      expect(command.toJSON().options!.length).toBeLessThanOrEqual(25);
    }
  });
});
