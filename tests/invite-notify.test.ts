import { describe, expect, it, vi } from "vitest";
import { notifyInviters, onlineInviters } from "../src/services/invite-notify.js";

const now = new Date("2026-11-07T12:00:00Z");
function setup(opts: { enabled?: boolean; online?: { name: string; rankIndex: number }[]; linked?: { name: string; id: string }[]; claim?: number; roles?: { id: string; name: string }[] } = {}) {
  const send = vi.fn(async (options: unknown) => { void options; return { id: "note1" }; });
  const database = {
    guildSettings: { findUnique: vi.fn(async () => ({ inviteNotifyEnabled: opts.enabled ?? true, language: "en" })) },
    inviteRequest: { updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => { void args; return { count: opts.claim ?? 1 }; }) },
    guildRosterEntry: { findMany: vi.fn(async () => opts.online ?? []) },
    character: { findMany: vi.fn(async () => (opts.linked ?? []).map((l) => ({ name: l.name, member: { discordUserId: l.id } }))) }
  };
  const discordGuild = { roles: { fetch: vi.fn(async () => new Map((opts.roles ?? [{ id: "r1", name: "Officer" }]).map((r) => [r.id, r]))) } };
  const run = () => notifyInviters(database as never, { guildId: "g1", discordGuild: discordGuild as never, channel: { send }, requestMessageId: "m1", requesterId: "req", displayName: "Amy Archer", now });
  return { database, send, run };
}

describe("tagging the people who can invite", () => {
  it("tags at most three online guild members of any rank (most recent first), never the requester, with no other mentions", async () => {
    const online = ["A One", "B Two", "C Three", "D Four", "Req Self"].map((name, rankIndex) => ({ name, rankIndex: rankIndex + 3 }));
    const linked = [["A One", "u1"], ["B Two", "u2"], ["C Three", "u3"], ["D Four", "u4"], ["Req Self", "req"]].map(([name, id]) => ({ name: name!, id: id! }));
    const { run, send, database } = setup({ online, linked });
    expect(await run()).toBe("people");
    const call = send.mock.calls[0]![0] as { content: string; allowedMentions: { users: string[]; parse: string[] } };
    expect(call.allowedMentions).toEqual({ parse: [], users: ["u1", "u2", "u3"] });
    expect(call.content).toContain("<@u1> <@u2> <@u3>");
    expect(call.content).not.toContain("req");
    // the tag message is remembered so it can be edited when the character joins
    expect(database.inviteRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { notifyMessageId: "note1" } }));
  });
  it("falls back to the officer role once when nobody linked is online", async () => {
    const { run, send } = setup({ online: [{ name: "Ghost", rankIndex: 0 }] });
    expect(await run()).toBe("role");
    expect(send.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [], roles: ["r1"] } });
  });
  it("does nothing when switched off, when already tagged, or when there is no officer role", async () => {
    const off = setup({ enabled: false }); expect(await off.run()).toBe("none"); expect(off.send).not.toHaveBeenCalled();
    const again = setup({ claim: 0, online: [{ name: "A One", rankIndex: 0 }], linked: [{ name: "A One", id: "u1" }] }); expect(await again.run()).toBe("none"); expect(again.send).not.toHaveBeenCalled();
    const noRole = setup({ roles: [{ id: "x", name: "Member" }] }); expect(await noRole.run()).toBe("none");
  });
  it("asks the roster for any rank seen online in the last minutes", async () => {
    const { database } = setup();
    await onlineInviters(database as never, "g1", "req", now);
    const where = (database.guildRosterEntry.findMany.mock.calls[0] as unknown as [{ where: { rankIndex?: unknown; lastOnlineAt: { gte: Date } } }])[0].where;
    expect(where.rankIndex).toBeUndefined();
    expect(where.lastOnlineAt.gte.getTime()).toBe(now.getTime() - 10 * 60 * 1000);
  });
});
