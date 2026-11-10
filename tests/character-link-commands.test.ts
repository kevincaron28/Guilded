import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    character: { findMany: vi.fn(), delete: vi.fn() },
    unclaimedCharacter: { findMany: vi.fn(), findFirst: vi.fn() },
    characterLinkConflict: { findMany: vi.fn(async () => [] as unknown[]) },
    member: { findMany: vi.fn(async () => [] as unknown[]) },
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run("tx"))
  },
  detach: vi.fn(),
  officerMove: vi.fn(),
  hasPermission: vi.fn(() => true),
  context: vi.fn(async () => ({ guildId: "g1", memberId: "m1" })),
  block: vi.fn(),
  log: vi.fn(),
  claim: vi.fn(),
  linkUnclaimed: vi.fn(),
  autoLink: vi.fn(),
  ensureMember: vi.fn(async () => ({ id: "m2x" }))
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/permissions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/permissions.js")>();
  return { ...actual, hasPermission: mocks.hasPermission };
});
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.context, guildService: { ensureMember: mocks.ensureMember } }));
vi.mock("../src/services/character-verify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/character-verify.js")>();
  return { ...actual, blockVerifiedCharacter: mocks.block };
});
vi.mock("../src/services/character-autolink.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/character-autolink.js")>();
  return { ...actual, claimCharacter: mocks.claim, linkUnclaimed: mocks.linkUnclaimed, autoLinkUnclaimed: mocks.autoLink };
});
vi.mock("../src/services/character-move.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/character-move.js")>();
  return { ...actual, detachCharacter: mocks.detach, officerMoveCharacter: mocks.officerMove };
});
vi.mock("../src/services/housekeeping.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/housekeeping.js")>();
  return { ...actual, postToLogChannel: mocks.log };
});

import { executeCharacter } from "../src/commands/character.js";

const ray = { id: "c1", name: "Ray", realm: "Forever", gameEdition: "forever", memberId: "m1", member: { displayName: "Ray" } };
const kev = { id: "c2", name: "Kevchar", realm: "Forever", gameEdition: "forever", memberId: "m2", member: { displayName: "Kev" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.context.mockResolvedValue({ guildId: "g1", memberId: "m1" });
  mocks.block.mockResolvedValue(undefined);
  mocks.log.mockResolvedValue(undefined);
  mocks.prisma.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run("tx"));
  mocks.prisma.characterLinkConflict.findMany.mockResolvedValue([]);
  mocks.prisma.member.findMany.mockResolvedValue([]);
});

function interaction(sub: string, values: Record<string, unknown> = {}) {
  return {
    guild: { id: "d1" }, guildId: "d1", member: { id: "u1" }, user: { id: "u1", username: "rayuser" },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => values[name] ?? null,
      getUser: () => values["player"] ?? null,
      getBoolean: () => null,
      getInteger: () => null
    },
    reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn()
  };
}

describe("Discord character link commands", () => {
  it("lets an officer move a linked or an unlinked character to another member, and lists what waits for them", async () => {
    mocks.prisma.character.findMany.mockResolvedValue([kev, { ...ray, id: "c9", name: "Old Ray", detachedAt: new Date(), member: { displayName: "Unlinked characters" } }]);
    mocks.officerMove.mockResolvedValue({ character: { isMain: false }, fromMemberId: "m2", wasDetached: false });
    const move = interaction("move", { name: "Kevchar", player: { id: "u9", username: "sam" } });
    await executeCharacter(move as never);
    expect(mocks.officerMove).toHaveBeenCalledWith(expect.anything(), "c2", "m2x");
    expect(move.reply.mock.calls[0]?.[0].content).toContain("Moved **Kevchar** from Kev to sam as an alt");
    expect(mocks.log).toHaveBeenCalledWith(move.guild, "rayuser moved Kevchar from Kev to sam (history kept).");

    const back = interaction("move", { name: "Old Ray", player: { id: "u9", username: "sam" } });
    await executeCharacter(back as never);
    expect(mocks.officerMove).toHaveBeenLastCalledWith(expect.anything(), "c9", "m2x");
    expect(back.reply.mock.calls[0]?.[0].content).toContain("from the unlinked characters to sam");

    // Already theirs: nothing to do.
    mocks.officerMove.mockClear();
    mocks.ensureMember.mockResolvedValueOnce({ id: "m2" });
    const same = interaction("move", { name: "Kevchar", player: { id: "u2", username: "kev" } });
    await executeCharacter(same as never);
    expect(mocks.officerMove).not.toHaveBeenCalled();
    await expect(executeCharacter(interaction("move", { name: "Nobody", player: { id: "u9", username: "sam" } }) as never)).rejects.toThrow(/No character called/);

    mocks.hasPermission.mockReturnValue(false);
    const denied = interaction("move", { name: "Kevchar", player: { id: "u9", username: "sam" } });
    await executeCharacter(denied as never);
    expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Only Officers and Guild Masters can do that." }));

    mocks.hasPermission.mockReturnValue(true);
    mocks.prisma.unclaimedCharacter.findMany.mockResolvedValue([]);
    mocks.prisma.character.findMany.mockResolvedValue([{ name: "Old Ray", displayName: null }]);
    mocks.prisma.characterLinkConflict.findMany.mockResolvedValue([{ ownerMemberId: "m1", claimantMemberId: "m2", character: { name: "Shared", displayName: null } }]);
    mocks.prisma.member.findMany.mockResolvedValue([{ id: "m1", discordUserId: "111" }, { id: "m2", discordUserId: "222" }]);
    const list = interaction("unclaimed");
    await executeCharacter(list as never);
    const content = list.reply.mock.calls[0]?.[0].content as string;
    expect(content).toContain("Shared: linked to <@111>, claimed by <@222>");
    expect(content).toContain("/officer character move");
    expect(content).toContain("**Unlinked, history kept:** Old Ray");
  });

  it("lets a member unlink their own character and blocks the verify code from linking it back", async () => {
    mocks.prisma.character.findMany.mockResolvedValue([ray]);
    const interactionOwn = interaction("unlink", { name: "Ray" });
    await executeCharacter(interactionOwn as never);
    // Detached, never deleted: the history stays with the row.
    expect(mocks.detach).toHaveBeenCalledWith("tx", "c1");
    expect(mocks.prisma.character.delete).not.toHaveBeenCalled();
    expect(interactionOwn.reply.mock.calls[0]?.[0].content).toContain("Nothing was deleted");
    expect(mocks.block).toHaveBeenCalledWith(expect.anything(), "g1", "m1", "Ray", "Forever", "forever", false);
    expect(mocks.log).toHaveBeenCalledWith(interactionOwn.guild, expect.stringContaining("unlinked their character"));
    expect(interactionOwn.reply.mock.calls[0]?.[0].content).toContain("Unlinked **Ray**");
    expect(interactionOwn.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
  });

  it("lets an officer unlink someone else's character so that member's uploads cannot relink it", async () => {
    mocks.prisma.character.findMany.mockResolvedValue([kev]);
    const unlink = interaction("unlink", { name: "Kevchar" });
    await executeCharacter(unlink as never);
    expect(mocks.block).toHaveBeenCalledWith(expect.anything(), "g1", "m2", "Kevchar", "Forever", "forever", true);
    expect(mocks.log).toHaveBeenCalledWith(unlink.guild, expect.stringContaining("unlinked Kevchar from Kev"));
    expect(unlink.reply.mock.calls[0]?.[0].content).toContain("from Kev");
    expect(unlink.reply.mock.calls[0]?.[0].content).toContain("won't relink");
  });

  it("refuses a member unlinking someone else, an unknown name, and an ambiguous name", async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.prisma.character.findMany.mockResolvedValue([kev]);
    await expect(executeCharacter(interaction("unlink", { name: "Kevchar" }) as never)).rejects.toThrow(/Only Officers/);
    expect(mocks.prisma.character.delete).not.toHaveBeenCalled();
    expect(mocks.block).not.toHaveBeenCalled();

    mocks.hasPermission.mockReturnValue(true);
    mocks.prisma.character.findMany.mockResolvedValue([]);
    await expect(executeCharacter(interaction("unlink", { name: "Nobody" }) as never)).rejects.toThrow(/No linked character/);

    mocks.prisma.character.findMany.mockResolvedValue([ray, { ...ray, id: "c3", realm: "Other" }]);
    await expect(executeCharacter(interaction("unlink", { name: "Ray" }) as never)).rejects.toThrow(/Several characters/);
    expect(mocks.prisma.character.delete).not.toHaveBeenCalled();
  });

  it("claims a reported character and surfaces a conflict", async () => {
    mocks.claim.mockResolvedValue({ row: { name: "Ray", displayName: null, className: "Priest", level: 60 }, isMain: true });
    const claim = interaction("claim", { name: "Ray" });
    await executeCharacter(claim as never);
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), "g1", "m1", "Ray");
    expect(claim.reply.mock.calls[0]?.[0].content).toContain("Linked **Ray**");
    expect(claim.reply.mock.calls[0]?.[0].content).toContain("your main");

    mocks.claim.mockRejectedValue(new Error("Ray is already linked to Kev. /character list shows what is linked."));
    await expect(executeCharacter(interaction("claim", { name: "Ray" }) as never)).rejects.toThrow(/already linked to Kev/);
  });

  it("limits officer link, autolink and the unclaimed list to officers", async () => {
    mocks.hasPermission.mockReturnValue(false);
    for (const sub of ["link", "autolink", "unclaimed"]) {
      const denied = interaction(sub, { name: "Ray", player: { id: "u2", username: "sam" } });
      await executeCharacter(denied as never);
      expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Only Officers and Guild Masters can do that." }));
    }
    expect(mocks.linkUnclaimed).not.toHaveBeenCalled();
    expect(mocks.autoLink).not.toHaveBeenCalled();

    mocks.hasPermission.mockReturnValue(true);
    mocks.prisma.unclaimedCharacter.findMany.mockResolvedValue([]);
    mocks.prisma.character.findMany.mockResolvedValue([]);
    const empty = interaction("unclaimed");
    await executeCharacter(empty as never);
    expect(empty.reply.mock.calls[0]?.[0].content).toMatch(/Every character the addons reported is linked/);

    mocks.prisma.unclaimedCharacter.findFirst.mockResolvedValue(null);
    await expect(executeCharacter(interaction("link", { name: "Missing", player: { id: "u2", username: "sam" } }) as never)).rejects.toThrow(/No unclaimed character/);

    const row = { id: "u1", name: "Ray", realm: "Forever", className: "Priest" };
    mocks.prisma.unclaimedCharacter.findFirst.mockResolvedValue(row);
    mocks.linkUnclaimed.mockResolvedValue({ isMain: false });
    const linked = interaction("link", { name: "Ray", player: { id: "u2", username: "sam" } });
    await executeCharacter(linked as never);
    expect(mocks.ensureMember).toHaveBeenCalledWith("g1", "u2", "sam");
    expect(mocks.linkUnclaimed).toHaveBeenCalledWith(expect.anything(), "m2x", row, { confirmed: true });
    expect(linked.reply.mock.calls[0]?.[0].content).toContain("Linked **Ray** to sam as an alt");

    mocks.autoLink.mockResolvedValue([{ character: "Amy", member: "Amy" }]);
    const auto = interaction("autolink");
    await executeCharacter(auto as never);
    expect(auto.deferReply).toHaveBeenCalled();
    expect(mocks.autoLink).toHaveBeenCalledWith(auto.guild, expect.anything(), "g1");
    expect(auto.editReply).toHaveBeenCalledWith({ content: "Linked Amy to Amy." });

    mocks.autoLink.mockResolvedValue([]);
    const none = interaction("autolink");
    await executeCharacter(none as never);
    expect(none.editReply.mock.calls[0]?.[0].content).toMatch(/Nothing matched by name/);
  });
});
