import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  byIdOrName: vi.fn(), remove: vi.fn(), cleanup: vi.fn(), removeRoster: vi.fn(), count: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: { epgpTransaction: { count: mocks.count } } }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g", memberId: "m" }), guildService: {}
}));
vi.mock("../src/services/raid-core.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/raid-core.js")>(),
  createRaidCoreService: () => ({ byIdOrName: mocks.byIdOrName, remove: mocks.remove }),
  removeCoreRosterMessage: mocks.removeRoster
}));
vi.mock("../src/services/core-channels.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/core-channels.js")>(), deleteCoreDiscord: mocks.cleanup
}));

const { coreCommand, executeCore } = await import("../src/commands/core.js");
const core = {
  id: "c", name: "Tuesday MC", separatePool: false, roleId: "role", categoryId: "category",
  rosterChannelId: "roster", signupChannelId: "signups", lootChannelId: "loot", raidLogChannelId: "reports",
  chatChannelId: "chat", voiceChannelId: "voice", rosterMessageId: "message"
};
function interaction() {
  return {
    guild: { id: "discord-guild" },
    member: { permissions: { has: () => true } },
    options: { getSubcommand: () => "delete", getString: () => "Tuesday MC", getBoolean: vi.fn(() => null) },
    deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn()
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.byIdOrName.mockResolvedValue(core);
  mocks.remove.mockResolvedValue(core);
  mocks.cleanup.mockResolvedValue({ removed: 8, failed: [] });
  mocks.count.mockResolvedValue(0);
});

describe("/core delete", () => {
  it("automatically removes Discord resources before deleting the core record", async () => {
    const command = interaction();
    await executeCore(command as never);
    expect(command.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mocks.cleanup).toHaveBeenCalledWith(command.guild, core);
    expect(mocks.cleanup.mock.invocationCallOrder[0]!).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
    expect(mocks.remove).toHaveBeenCalledWith("g", "c");
    expect(command.options.getBoolean).not.toHaveBeenCalled();
    expect(command.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("Removed 8") });
    const deletion = coreCommand.toJSON().options?.find(option => option.name === "delete");
    expect(deletion && "options" in deletion ? deletion.options?.map(option => option.name) : []).toEqual(["core"]);
  });

  it("keeps the database core and roster on partial cleanup and explains how to retry", async () => {
    mocks.cleanup.mockResolvedValue({ removed: 5, failed: ["role role"] });
    const command = interaction();
    await executeCore(command as never);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.removeRoster).not.toHaveBeenCalled();
    expect(command.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("The core was kept") });
    expect(command.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("role role") });
  });

  it("also cleans older cores with only linked channel IDs", async () => {
    mocks.byIdOrName.mockResolvedValue({ ...core, categoryId: null, roleId: null });
    await executeCore(interaction() as never);
    expect(mocks.cleanup).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
  });

  it("deletes cores without Discord resources", async () => {
    mocks.byIdOrName.mockResolvedValue({ ...core, categoryId: null, roleId: null, rosterChannelId: null,
      signupChannelId: null, lootChannelId: null, raidLogChannelId: null, chatChannelId: null, voiceChannelId: null });
    await executeCore(interaction() as never);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
  });

  it("preserves the existing point-pool guard before touching Discord resources", async () => {
    mocks.byIdOrName.mockResolvedValue({ ...core, separatePool: true });
    mocks.count.mockResolvedValue(2);
    await expect(executeCore(interaction() as never)).rejects.toThrow("own point pool");
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
