import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    guildRankRole: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    guildSettings: { upsert: vi.fn(), findUnique: vi.fn() }
  },
  hasPermission: vi.fn(() => true),
  context: vi.fn(async (): Promise<{ guildId: string; memberId: string } | null> => ({ guildId: "g1", memberId: "m1" })),
  sync: vi.fn(),
  preview: vi.fn(async () => ({ skipped: null, roles: [], lose: 0, changes: 0 }))
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.context }));
vi.mock("../src/services/rank-roles.js", () => ({ syncRankRoles: mocks.sync, previewRankRoles: mocks.preview, formatRankRolePreview: () => "PREVIEW TEXT" }));

import { executeRankRoles, handleRankRolesButton } from "../src/commands/rank-roles.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.context.mockResolvedValue({ guildId: "g1", memberId: "m1" });
});

function interaction(sub: string, values: Record<string, unknown> = {}) {
  return {
    guild: { id: "d1" }, guildId: "d1", member: { id: "officer" }, user: { id: "officer" },
    options: {
      getSubcommand: () => sub,
      getInteger: (name: string) => values[name] ?? null,
      getBoolean: (name: string) => values[name] ?? null,
      getRole: () => values["role"] ?? null
    },
    reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn()
  };
}

function button(customId: string) {
  return {
    customId, guild: { id: "d1", name: "Guild", roles: { cache: new Map([["gm", { id: "gm" }]]) } }, guildId: "d1", member: { id: "officer" }, user: { id: "officer" },
    update: vi.fn(), reply: vi.fn()
  };
}

describe("/mod rankroles", () => {
  it("does nothing without a guild and refuses a member who is not an officer", async () => {
    mocks.context.mockResolvedValue(null);
    const missing = interaction("list");
    await executeRankRoles(missing as never);
    expect(missing.reply).not.toHaveBeenCalled();

    mocks.context.mockResolvedValue({ guildId: "g1", memberId: "m1" });
    mocks.hasPermission.mockReturnValue(false);
    const denied = interaction("set", { rank: 0, role: { id: "role1", managed: false } });
    await executeRankRoles(denied as never);
    expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Only officers can set rank roles.", flags: MessageFlags.Ephemeral }));
    expect(mocks.prisma.guildRankRole.upsert).not.toHaveBeenCalled();
  });

  it("maps a rank, rejects @everyone and managed roles, and can unmap it", async () => {
    const everyone = interaction("set", { rank: 0, role: { id: "d1", managed: false } });
    await executeRankRoles(everyone as never);
    expect(everyone.reply.mock.calls[0]?.[0].content).toMatch(/not @everyone/);
    expect(mocks.prisma.guildRankRole.upsert).not.toHaveBeenCalled();

    const managed = interaction("set", { rank: 1, role: { id: "bot", managed: true } });
    await executeRankRoles(managed as never);
    expect(managed.reply.mock.calls[0]?.[0].content).toMatch(/bot role/);

    // 9.1: set previews who would get the role and saves nothing until Confirm.
    mocks.prisma.guildRankRole.findMany.mockResolvedValue([{ rankIndex: 0, discordRoleId: "old" }, { rankIndex: 3, discordRoleId: "raider" }]);
    mocks.prisma.guildSettings.findUnique.mockResolvedValue(null);
    const set = interaction("set", { rank: 0, role: { id: "gm", managed: false } });
    await executeRankRoles(set as never);
    expect(mocks.prisma.guildRankRole.upsert).not.toHaveBeenCalled();
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), set.guild, [{ rankIndex: 3, discordRoleId: "raider" }, { rankIndex: 0, discordRoleId: "gm" }]);
    const shown = set.editReply.mock.calls[0]?.[0];
    expect(shown.content).toContain("Preview: rank 0 → <@&gm>");
    expect(shown.content).toContain("PREVIEW TEXT");
    expect(JSON.stringify(shown.components)).toContain("rankroles:set:0:gm");
    expect(JSON.stringify(shown.components)).toContain("rankroles:cancel");

    // Confirm saves it (re-checking the officer role); Cancel changes nothing.
    const confirm = button("rankroles:set:0:gm");
    await handleRankRolesButton(confirm as never);
    expect(mocks.prisma.guildRankRole.upsert).toHaveBeenCalledWith({
      where: { guildId_rankIndex: { guildId: "g1", rankIndex: 0 } },
      create: { guildId: "g1", rankIndex: 0, discordRoleId: "gm", createdBy: "officer" },
      update: { discordRoleId: "gm", createdBy: "officer" }
    });
    expect(confirm.update.mock.calls[0]?.[0].content).toContain("Rank 0 now gives <@&gm>");
    mocks.prisma.guildRankRole.upsert.mockClear();
    const cancel = button("rankroles:cancel");
    await handleRankRolesButton(cancel as never);
    expect(cancel.update.mock.calls[0]?.[0].content).toMatch(/Nothing was changed/);
    mocks.hasPermission.mockReturnValue(false);
    const stranger = button("rankroles:set:0:gm");
    await handleRankRolesButton(stranger as never);
    expect(stranger.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Only officers can set rank roles." }));
    expect(mocks.prisma.guildRankRole.upsert).not.toHaveBeenCalled();
    mocks.hasPermission.mockReturnValue(true);

    const removed = interaction("remove", { rank: 0 });
    await executeRankRoles(removed as never);
    expect(mocks.prisma.guildRankRole.deleteMany).toHaveBeenCalledWith({ where: { guildId: "g1", rankIndex: 0 } });
    expect(removed.reply.mock.calls[0]?.[0].content).toMatch(/no longer mapped/);
  });

  it("turns the sync on or off and lists the mappings", async () => {
    const off = interaction("enabled", { on: false });
    await executeRankRoles(off as never);
    expect(mocks.prisma.guildSettings.upsert).toHaveBeenCalledWith({ where: { guildId: "g1" }, create: { guildId: "g1", rankRolesEnabled: false }, update: { rankRolesEnabled: false } });
    expect(off.reply.mock.calls[0]?.[0].content).toMatch(/off/);

    // 9.1: turning them back on with ranks mapped previews first; Confirm turns them on.
    mocks.prisma.guildSettings.upsert.mockClear();
    mocks.prisma.guildSettings.findUnique.mockResolvedValue({ rankRolesEnabled: false });
    mocks.prisma.guildRankRole.findMany.mockResolvedValue([{ rankIndex: 1, discordRoleId: "officer" }]);
    const on = interaction("enabled", { on: true });
    await executeRankRoles(on as never);
    expect(mocks.prisma.guildSettings.upsert).not.toHaveBeenCalled();
    expect(on.editReply.mock.calls[0]?.[0].content).toContain("Preview: turning rank roles on");
    expect(JSON.stringify(on.editReply.mock.calls[0]?.[0].components)).toContain("rankroles:enable");
    const enable = button("rankroles:enable");
    await handleRankRolesButton(enable as never);
    expect(mocks.prisma.guildSettings.upsert).toHaveBeenCalledWith({ where: { guildId: "g1" }, create: { guildId: "g1", rankRolesEnabled: true }, update: { rankRolesEnabled: true } });
    // Already on: nothing to preview.
    mocks.prisma.guildSettings.findUnique.mockResolvedValue(null);
    const already = interaction("enabled", { on: true });
    await executeRankRoles(already as never);
    expect(already.reply.mock.calls[0]?.[0].content).toBe("Rank roles are already on.");

    mocks.prisma.guildRankRole.findMany.mockResolvedValue([]);
    mocks.prisma.guildSettings.findUnique.mockResolvedValue(null);
    const empty = interaction("list");
    await executeRankRoles(empty as never);
    expect(empty.reply.mock.calls[0]?.[0].content).toContain("Rank roles are **on**.");
    expect(empty.reply.mock.calls[0]?.[0].content).toMatch(/No rank is mapped/);

    mocks.prisma.guildRankRole.findMany.mockResolvedValue([{ rankIndex: 0, discordRoleId: "gm" }]);
    mocks.prisma.guildSettings.findUnique.mockResolvedValue({ rankRolesEnabled: false });
    const listed = interaction("list");
    await executeRankRoles(listed as never);
    expect(listed.reply.mock.calls[0]?.[0].content).toContain("**off**");
    expect(listed.reply.mock.calls[0]?.[0].content).toContain("Rank 0 → <@&gm>");
  });

  it("previews by default, applies when asked, and reports an empty or skipped result", async () => {
    mocks.sync.mockResolvedValue({ changes: [{ discordUserId: "u1", add: ["officer"], remove: ["member"] }], applied: 0, failed: 0, skipped: null });
    const preview = interaction("sync", { apply: false });
    await executeRankRoles(preview as never);
    expect(preview.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), preview.guild, { dryRun: true });
    expect(preview.editReply.mock.calls[0]?.[0].content).toMatch(/nothing was changed/);
    expect(preview.editReply.mock.calls[0]?.[0].content).toContain("<@u1>");
    expect(preview.editReply.mock.calls[0]?.[0].content).toContain("+<@&officer>");
    expect(preview.editReply.mock.calls[0]?.[0].content).toContain("−<@&member>");

    mocks.sync.mockResolvedValue({ changes: [{ discordUserId: "u1", add: ["officer"], remove: [] }], applied: 2, failed: 1, skipped: null });
    const applied = interaction("sync", { apply: true });
    await executeRankRoles(applied as never);
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), applied.guild, { dryRun: false });
    expect(applied.editReply.mock.calls[0]?.[0].content).toContain("Changed 2 member(s), 1 failed");

    mocks.sync.mockResolvedValue({ changes: [], applied: 0, failed: 0, skipped: null });
    const ready = interaction("sync");
    await executeRankRoles(ready as never);
    expect(ready.editReply.mock.calls[0]?.[0].content).toBe("Everyone already has the right rank role.");

    mocks.sync.mockResolvedValue({ changes: [], applied: 0, failed: 0, skipped: "A mapped role no longer exists. Map that rank again." });
    const skipped = interaction("sync", { apply: true });
    await executeRankRoles(skipped as never);
    expect(skipped.editReply.mock.calls[0]?.[0].content).toMatch(/no longer exists/);
  });
});
