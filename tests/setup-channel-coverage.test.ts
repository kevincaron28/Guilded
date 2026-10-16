import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from "discord.js";
const mocks = vi.hoisted(() => ({ count: vi.fn(async () => 0), cores: vi.fn(async () => []) }));
vi.mock("../src/database.js", () => ({ prisma: {
  raidCore: { findMany: mocks.cores }, ...Object.fromEntries(["member", "character", "raid", "epgpTransaction", "lootAward", "addonImport", "dungeonRun"].map(key => [key, { count: mocks.count }]))
} }));
import { gatherImpact } from "../src/commands/uninstall.js";
import { ALL_CHANNELS, createSectionChannels, organizeChannels, repairCraftBoardPermissions, withGameGate } from "../src/commands/setup.js";
import { guildService } from "../src/commands/context.js";
import { channelSpec } from "../src/setup-names.js";
const channel = (id: string, name: string, parentId: string | null = null, type = ChannelType.GuildText) => ({ id, name, parentId, type, isTextBased: () => false,
  setName: vi.fn(async () => undefined), setParent: vi.fn(async () => undefined), edit: vi.fn(async () => undefined),
  permissionOverwrites: { cache: new Collection<string, { id: string; type: 0; allow: PermissionsBitField; deny: PermissionsBitField }>(), set: vi.fn(async () => undefined), edit: vi.fn(async () => undefined) } });
function fakeGuild(channels: ReturnType<typeof channel>[]) {
  const cache = new Collection(channels.map(c => [c.id, c]));
  return { id: "discord", channels: { cache, fetch: vi.fn(async (id?: string) => id ? cache.get(id) : cache), create: vi.fn() }, roles: { everyone: { id: "everyone" }, cache: new Collection(), fetch: vi.fn() }, members: { me: null } };
}
beforeEach(() => vi.restoreAllMocks());
describe("setup and reset channel coverage", () => {
  it("includes FAQ in fresh setup with member posting enabled", () => {
    expect(ALL_CHANNELS).toContain("answerChannelId");
    expect(channelSpec("answerChannelId", "en")).toMatchObject({ name: "bot-faq", access: "open" });
    expect(channelSpec("answerChannelId", "fr").name).toBe("bot-faq");
  });
  it("includes renamed configured signup, guide and FAQ channels in the deletion preview", async () => {
    const guild = fakeGuild([channel("raid", "custom-signups"), channel("guide", "member-help"), channel("faq", "ask-anything"), channel("manual", "general"), channel("welcome", "welcome")]);
    const impact = await gatherImpact(guild as never, "guild", { raidSignupChannelId: "raid", guideChannelId: "guide", answerChannelId: "faq", notifyChannelId: "manual", welcomeChannelId: "welcome", welcomeRoleIds: [] } as never);
    expect(impact.removableChannels.map(c => c.id)).toEqual(["raid", "guide", "faq"]);
    expect(impact.keptChannels).toEqual(["<#manual>", "<#welcome>"]);
  });
  it("recovers old reset leftovers only in recognized bot categories", async () => {
    const guild = fakeGuild([channel("category", "⚜️ Guilded", null, ChannelType.GuildCategory), channel("raidcategory", "⚔️ Raids", null, ChannelType.GuildCategory), channel("guide", "guilded-addon", "category"), channel("faq", "bot-faq", "category"), channel("raid", "raid-inscription", "raidcategory"), channel("manual", "bot-faq")]);
    const impact = await gatherImpact(guild as never, "guild", { welcomeRoleIds: [] } as never);
    expect(impact.removableChannels.map(c => c.id)).toEqual(["guide", "faq", "raid"]);
  });
  it("setup reuses the surviving FAQ instead of creating a duplicate and saves its link", async () => {
    const guild = fakeGuild([channel("category", "⚜️ Guilded", null, ChannelType.GuildCategory), channel("faq", "bot-faq", "category")]);
    vi.spyOn(guildService, "getSettings").mockResolvedValue({} as never);
    const save = vi.spyOn(guildService, "updateSettings").mockResolvedValue({} as never);
    await createSectionChannels(guild as never, "guild", ["answerChannelId"], "en");
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("guild", { answerChannelId: "faq" });
  });
  it("setup creates and saves a missing FAQ channel", async () => {
    const guild = fakeGuild([channel("category", "⚜️ Guild", null, ChannelType.GuildCategory)]);
    guild.channels.create.mockResolvedValue(channel("faq", "bot-faq", "category"));
    vi.spyOn(guildService, "getSettings").mockResolvedValue({} as never);
    const save = vi.spyOn(guildService, "updateSettings").mockResolvedValue({} as never);
    await createSectionChannels(guild as never, "guild", ["answerChannelId"], "fr");
    expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ name: "bot-faq", type: ChannelType.GuildText, parent: "category" }));
    expect(save).toHaveBeenCalledWith("guild", { answerChannelId: "faq" });
    expect(guild.channels.cache.get("category")?.setName).toHaveBeenCalledWith("⚜️ Guilded");
    expect(guild.channels.cache.get("category")?.permissionOverwrites.edit).toHaveBeenCalledWith("everyone", { ViewChannel: true, ReadMessageHistory: true });
    const created = guild.channels.create.mock.calls[0]?.[0] as { permissionOverwrites: { id: string; allow: bigint[] }[] };
    const everyone = created.permissionOverwrites.find(entry => entry.id === "everyone");
    expect(new PermissionsBitField(everyone?.allow).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages])).toBe(true);
  });
  it("keeps the shared guide readable on a server whose default channels are hidden", async () => {
    const guild = fakeGuild([channel("category", "⚜️ Guilded", null, ChannelType.GuildCategory)]);
    guild.channels.create.mockResolvedValue(channel("guide", "guilded-guide", "category"));
    vi.spyOn(guildService, "getSettings").mockResolvedValue({} as never);
    vi.spyOn(guildService, "updateSettings").mockResolvedValue({} as never);
    await createSectionChannels(guild as never, "guild", ["guideChannelId"], "fr");
    const created = guild.channels.create.mock.calls[0]?.[0] as { permissionOverwrites: { id: string; allow?: bigint[]; deny?: bigint[] }[] };
    const everyone = created.permissionOverwrites.find(entry => entry.id === "everyone");
    expect(new PermissionsBitField(everyone?.allow).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])).toBe(true);
    expect(new PermissionsBitField(everyone?.deny).has(PermissionFlagsBits.SendMessages)).toBe(true);
    expect(channelSpec("notifyChannelId", "fr").category).toBe("raid");
  });
  it("organizing game channels preserves their role restrictions", async () => {
    const signup = channel("raid", "inscriptions-raid", "category");
    signup.permissionOverwrites.cache.set("everyone", { id: "everyone", type: 0, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) });
    signup.permissionOverwrites.cache.set("wow", { id: "wow", type: 0, allow: new PermissionsBitField(PermissionFlagsBits.ViewChannel), deny: new PermissionsBitField() });
    const guild = fakeGuild([channel("category", "⚔️ Raids", null, ChannelType.GuildCategory), signup]);
    vi.spyOn(guildService, "getSettings").mockResolvedValue({ raidSignupChannelId: "raid" } as never);
    await organizeChannels(guild as never, "guild", "fr");
    expect(signup.edit).toHaveBeenCalledWith(expect.objectContaining({ permissionOverwrites: [
      { id: "everyone", type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
      { id: "wow", type: 0, allow: PermissionFlagsBits.ViewChannel, deny: 0n }
    ] }));
  });
  it("craft-board repair does not undo an everyone visibility deny", async () => {
    const board = channel("board", "tableau-artisanat", "category", ChannelType.GuildForum);
    board.permissionOverwrites.cache.set("everyone", { id: "everyone", type: 0, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) });
    await repairCraftBoardPermissions(fakeGuild([board]) as never, "board");
    const edits = board.permissionOverwrites.edit.mock.calls as unknown as [string, Record<string, boolean>][];
    expect(edits[0]?.[1]).toMatchObject({ SendMessages: false, SendMessagesInThreads: true });
    expect(edits[0]?.[1]).not.toHaveProperty("ViewChannel");
    expect(edits[0]?.[1]).not.toHaveProperty("ReadMessageHistory");
  });
});
describe("setup follows the server's own layout", () => {
  const view = PermissionFlagsBits.ViewChannel;
  // Quebec Gold's shape: WoW channels in the server's own categories, hidden behind a "World of Warcraft" role.
  function gatedServer() {
    const chat = channel("chat", "💬 Chat WoW", null, ChannelType.GuildCategory);
    const signup = channel("raid", "inscriptions-raid", "chat");
    signup.permissionOverwrites.cache.set("everyone", { id: "everyone", type: 0, allow: new PermissionsBitField(), deny: new PermissionsBitField(view) });
    signup.permissionOverwrites.cache.set("wow", { id: "wow", type: 0, allow: new PermissionsBitField(view), deny: new PermissionsBitField() });
    signup.permissionOverwrites.cache.set("officer", { id: "officer", type: 0, allow: new PermissionsBitField([view, PermissionFlagsBits.SendMessages]), deny: new PermissionsBitField() });
    const guild = fakeGuild([chat, signup]);
    guild.roles.cache = new Collection([["wow", { id: "wow", name: "World of Warcraft" }], ["officer", { id: "officer", name: "Officier" }]]) as never;
    return guild;
  }

  it("creates a missing raid channel next to the others, behind the same game role", async () => {
    const guild = gatedServer();
    guild.channels.create.mockResolvedValue(channel("roster", "cores-de-raid", "chat"));
    vi.spyOn(guildService, "getSettings").mockResolvedValue({ raidSignupChannelId: "raid" } as never);
    vi.spyOn(guildService, "updateSettings").mockResolvedValue({} as never);
    await createSectionChannels(guild as never, "guild", ["coreChannelId"], "fr");
    const created = guild.channels.create.mock.calls[0]?.[0] as { parent: string; permissionOverwrites: { id: string; allow?: bigint; deny?: bigint }[] };
    expect(created.parent).toBe("chat");
    const entry = (id: string) => created.permissionOverwrites.find((o) => o.id === id);
    expect(new PermissionsBitField(entry("everyone")?.deny).has([view, PermissionFlagsBits.SendMessages])).toBe(true);
    expect(new PermissionsBitField(entry("wow")?.allow).has(view)).toBe(true);
    expect(new PermissionsBitField(entry("officer")?.allow).has([view, PermissionFlagsBits.SendMessages])).toBe(true);
  });

  it("keeps today's defaults on a new server", async () => {
    const guild = fakeGuild([]);
    guild.channels.create.mockResolvedValueOnce(channel("cat", "⚔️ Raids WoW", null, ChannelType.GuildCategory)).mockResolvedValueOnce(channel("roster", "cores-de-raid", "cat"));
    vi.spyOn(guildService, "getSettings").mockResolvedValue({} as never);
    vi.spyOn(guildService, "updateSettings").mockResolvedValue({} as never);
    await createSectionChannels(guild as never, "guild", ["coreChannelId"], "fr");
    expect(guild.channels.create.mock.calls[0]?.[0]).toMatchObject({ name: "⚔️ Raids WoW", type: ChannelType.GuildCategory });
    const created = guild.channels.create.mock.calls[1]?.[0] as { parent: string; permissionOverwrites: { id: string; deny?: bigint[] }[] };
    expect(created.parent).toBe("cat");
    expect(new PermissionsBitField(created.permissionOverwrites.find((o) => o.id === "everyone")?.deny).has(view)).toBe(false);
  });

  it("organize leaves channels in categories the server chose and moves loose ones next to them", async () => {
    const guild = gatedServer();
    const loose = channel("notify", "guilded-annonces", null);
    guild.channels.cache.set("notify", loose);
    vi.spyOn(guildService, "getSettings").mockResolvedValue({ raidSignupChannelId: "raid", notifyChannelId: "notify" } as never);
    const result = await organizeChannels(guild as never, "guild", "fr");
    expect(guild.channels.cache.get("raid")?.edit).not.toHaveBeenCalled();
    expect(loose.edit).toHaveBeenCalledWith(expect.objectContaining({ parent: "chat" }));
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(result).toContain("<#raid>");
  });

  it("game gate hides from everyone and lets the game role and existing roles see", () => {
    const gated = withGameGate([{ id: "everyone", deny: [PermissionFlagsBits.SendMessages] }, { id: "officer", allow: [PermissionFlagsBits.SendMessages] }], "everyone", ["wow"]);
    expect(new PermissionsBitField(gated[0]!.deny).has([view, PermissionFlagsBits.SendMessages])).toBe(true);
    expect(new PermissionsBitField(gated[1]!.allow).has([view, PermissionFlagsBits.SendMessages])).toBe(true);
    expect(gated[2]).toMatchObject({ id: "wow" });
    expect(withGameGate([], "everyone", [])).toEqual([{ id: "everyone", allow: 0n, deny: view }]);
  });
});
