import { ChannelType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BOARD_LOCK, boardChannelIds, planBoardLock, repairBoardPermissions } from "../src/services/board-permissions.js";

const EVERYONE = "g1", MEMBER = "r-member", OFFICER = "r-officer", BOT = "bot1";
const SEND = PermissionFlagsBits.SendMessages;

describe("planBoardLock", () => {
  it("denies write, reactions and threads for @everyone and the member role, and gives the bot what it needs", () => {
    const edits = planBoardLock([], EVERYONE, MEMBER, BOT);
    for (const id of [EVERYONE, MEMBER]) expect(edits.find(e => e.id === id)!.deny & BOARD_LOCK).toBe(BOARD_LOCK);
    const bot = edits.find(e => e.id === BOT)!;
    expect(bot.allow & SEND).toBe(SEND);
    expect(bot.allow & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);
  });

  it("removes a role-level Send Messages allow, which is how a read-only channel stayed writable", () => {
    const edits = planBoardLock([{ id: MEMBER, allow: SEND | PermissionFlagsBits.ViewChannel, deny: 0n }], EVERYONE, MEMBER, BOT);
    const member = edits.find(e => e.id === MEMBER)!;
    expect(member.allow & SEND).toBe(0n);
    expect(member.allow & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel); // viewing is untouched
    expect(member.deny & SEND).toBe(SEND);
  });

  it("strips grants from other roles without denying them (officers keep their own permissions)", () => {
    const edits = planBoardLock([{ id: OFFICER, allow: SEND, deny: 0n }], EVERYONE, MEMBER, BOT);
    const officer = edits.find(e => e.id === OFFICER)!;
    expect(officer.allow & SEND).toBe(0n);
    expect(officer.deny).toBe(0n);
  });

  it("changes nothing for a channel that is already locked", () => {
    const locked = [
      { id: EVERYONE, allow: 0n, deny: BOARD_LOCK },
      { id: MEMBER, allow: PermissionFlagsBits.ViewChannel, deny: BOARD_LOCK },
      { id: BOT, allow: SEND | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.AttachFiles, deny: 0n }
    ];
    expect(planBoardLock(locked, EVERYONE, MEMBER, BOT)).toEqual([]);
  });

  it("frees the bot from a deny on its own overwrite", () => {
    const edits = planBoardLock([{ id: BOT, allow: 0n, deny: SEND }], EVERYONE, null, BOT);
    expect(edits.find(e => e.id === BOT)!.deny & SEND).toBe(0n);
  });
});

describe("boardChannelIds", () => {
  it("lists the board channels and never the groups, guide or dungeon signup channels", () => {
    expect(boardChannelIds({ raceBoardChannelId: "a", duelBoardChannelId: "b", bgStatsChannelId: "c", bgResultsChannelId: "d", whosWhoChannelId: "e", bgGroupsChannelId: "g", guideChannelId: "h" }))
      .toEqual(["a", "b", "c", "d", "e"]);
    expect(boardChannelIds({ raceBoardChannelId: "x", whosWhoChannelId: "x" })).toEqual(["x"]);
    expect(boardChannelIds({ raceBoardChannelId: "guide", guideChannelId: "guide" })).toEqual([]);
    expect(boardChannelIds(null)).toEqual([]);
  });
});

describe("repairBoardPermissions", () => {
  const overwrite = (id: string, allow: bigint, deny: bigint, type = 0) => ({ id, type, allow: { bitfield: allow }, deny: { bitfield: deny } });
  function fixture(overwrites: ReturnType<typeof overwrite>[], settings: Record<string, unknown>) {
    const set = vi.fn(async () => undefined);
    const channel = { type: ChannelType.GuildText, permissionOverwrites: { cache: new Map(overwrites.map(o => [o.id, o])), set } };
    const fetch = vi.fn(async (id: string) => id === "race" || id === "duel" ? channel : null);
    const guild = { id: EVERYONE, members: { me: { id: BOT } }, channels: { fetch }, roles: { cache: new Map() } };
    const db = { guildSettings: { findUnique: vi.fn(async () => ({ memberRoleId: MEMBER, ...settings })) } };
    return { guild: guild as never, db: db as never, set, fetch };
  }

  it("locks a writable board channel in one call and reports it", async () => {
    const f = fixture([overwrite(MEMBER, SEND, 0n)], { raceBoardChannelId: "race" });
    const note = await repairBoardPermissions(f.guild, f.db, "g", "en");
    expect(note).toContain("<#race>");
    expect(f.set).toHaveBeenCalledTimes(1);
    const sent = (f.set.mock.calls[0] as unknown as [Array<{ id: string; allow: bigint; deny: bigint }>])[0];
    expect(sent.find(o => o.id === MEMBER)!.allow & SEND).toBe(0n);
    expect(sent.find(o => o.id === EVERYONE)!.deny & SEND).toBe(SEND);
  });

  it("does nothing for a server with no board channels, and never touches another channel", async () => {
    const f = fixture([], { bgGroupsChannelId: "groups" });
    expect(await repairBoardPermissions(f.guild, f.db, "g", "en")).toBe("");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
  });

  it("says so in French and warns when Discord refuses", async () => {
    const f = fixture([], { duelBoardChannelId: "duel" });
    f.set.mockRejectedValueOnce(new Error("Missing Permissions"));
    const note = await repairBoardPermissions(f.guild, f.db, "g", "fr");
    expect(note).toContain("<#duel>");
    expect(note).toContain("Gérer les rôles");
  });
});
