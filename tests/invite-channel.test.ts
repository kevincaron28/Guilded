import { afterEach, describe, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
import { completeInvitesFromRoster, findWowRoleId, handleInviteMessage, handleInviteReaction, handleWowRoleGiven, markPostsDone } from "../src/services/invite-channel.js";

vi.mock("../src/permissions.js", () => ({ hasPermission: (member: { officer?: boolean }) => Boolean(member.officer) }));
afterEach(() => { vi.useRealTimers(); delete process.env["FEATURE_PREVIEW_GUILD_IDS"]; });

const LF = String.fromCharCode(10);
const settings = { guildId: "g1", language: "en", inviteChannelId: "chan", inviteWowRoleId: null as string | null };
function database() {
  const requests: Record<string, unknown>[] = [];
  const dms: string[] = [];
  return {
    requests, dms,
    guildSettings: { findFirst: vi.fn(async ({ where }: { where: { inviteChannelId?: string } }) => where.inviteChannelId === "chan" ? settings : null), findMany: vi.fn(async () => [settings]) },
    inviteRequest: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { requests.push(create); return create; }),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => requests[0] ? { nameKey: requests[0]["nameKey"], status: "PENDING" } : null),
      findMany: vi.fn(async () => requests.map((r, i) => ({ id: `i${i}`, channelId: "chan", messageId: r["messageId"], displayName: r["displayName"] }))),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    inviteDm: { findUnique: vi.fn(async (): Promise<unknown> => null), create: vi.fn(async ({ data }: { data: { discordUserId: string } }) => { dms.push(data.discordUserId); }) },
    member: { findFirst: vi.fn(async (): Promise<unknown> => null) },
    character: { count: vi.fn(async () => 0) }
  };
}
const post = (content: string, extra: Record<string, unknown> = {}) => ({
  guildId: "guild", channelId: "chan", id: "m1", content, author: { id: "u1", bot: false }, webhookId: null, member: { officer: false },
  react: vi.fn(async () => undefined), reply: vi.fn(async () => ({ delete: vi.fn(async () => undefined) })), ...extra
});

describe("a post in the invite channel", () => {
  it("records a full name and reacts with eyes", async () => {
    const db = database(); const message = post("Lebowski Holyroller");
    expect(await handleInviteMessage(message as never, db as never)).toBe("recorded");
    expect(db.requests[0]).toMatchObject({ guildId: "g1", displayName: "Lebowski Holyroller", nameKey: "lebowski holyroller", discordUserId: "u1", messageId: "m1" });
    expect(message.react).toHaveBeenCalledWith("👀");
  });
  it("answers an unreadable post with a hint that deletes itself", async () => {
    vi.useFakeTimers();
    const del = vi.fn(async () => undefined);
    const message = post("can I join?", { reply: vi.fn(async () => ({ delete: del })) });
    expect(await handleInviteMessage(message as never, database() as never)).toBe("hinted");
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("First Last") }));
    expect(del).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(del).toHaveBeenCalled();
  });
  it("lets officers chat without hints, and ignores bots, other channels and a switched-off queue", async () => {
    expect(await handleInviteMessage(post("see you tonight", { member: { officer: true } }) as never, database() as never)).toBe("ignored");
    expect(await handleInviteMessage(post("Amy Archer", { author: { id: "b", bot: true } }) as never, database() as never)).toBe("ignored");
    expect(await handleInviteMessage(post("Amy Archer", { channelId: "other" }) as never, database() as never)).toBe("ignored");
    const off = database(); off.guildSettings.findFirst = vi.fn(async () => null);
    expect(await handleInviteMessage(post("Amy Archer") as never, off as never)).toBe("ignored");
  });
  it("does nothing outside the preview servers while the preview list is set", async () => {
    process.env["FEATURE_PREVIEW_GUILD_IDS"] = "someone-else";
    const db = database();
    expect(await handleInviteMessage(post("Amy Archer") as never, db as never)).toBe("ignored");
    expect(db.requests).toHaveLength(0);
  });
});

describe("check marks", () => {
  const client = (target: { react: ReturnType<typeof vi.fn>; reactions: unknown }) => ({
    user: { id: "bot" },
    channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, messages: { fetch: vi.fn(async () => target) } })) },
    guilds: { cache: new Map([["guild", { members: { fetch: vi.fn(async (id: string) => ({ officer: id === "officer" })) } }]]) }
  });
  it("adds the check mark and removes the bot's eyes", async () => {
    const remove = vi.fn(async () => undefined);
    const p = { react: vi.fn(async () => undefined), reactions: { cache: new Map([["👀", { users: { remove } }]]) } };
    expect(await markPostsDone(client(p) as never, [{ id: "i", channelId: "chan", messageId: "m1", displayName: "A B" }])).toBe(1);
    expect(p.react).toHaveBeenCalledWith("✅");
    expect(remove).toHaveBeenCalledWith("bot");
  });
  it("an officer's check mark finishes the name; a member's, or another emoji, does not", async () => {
    const db = database(); await handleInviteMessage(post("Amy Archer") as never, db as never);
    const p = { react: vi.fn(async () => undefined), reactions: { cache: new Map() } };
    const reaction = (name: string) => ({ emoji: { name }, message: { guildId: "guild", channelId: "chan", id: "m1" } });
    expect(await handleInviteReaction(client(p) as never, db as never, reaction("✅") as never, { id: "member", bot: false } as never)).toBe(0);
    expect(await handleInviteReaction(client(p) as never, db as never, reaction("👍") as never, { id: "officer", bot: false } as never)).toBe(0);
    expect(db.inviteRequest.updateMany).not.toHaveBeenCalled();
    expect(await handleInviteReaction(client(p) as never, db as never, reaction("✅") as never, { id: "officer", bot: false } as never)).toBe(1);
    expect(db.inviteRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "INVITED", invitedBy: "officer" }) }));
  });
  it("a roster upload marks names done automatically, but only in preview servers", async () => {
    const db = database(); await handleInviteMessage(post("Amy Archer") as never, db as never);
    const p = { react: vi.fn(async () => undefined), reactions: { cache: new Map() } };
    expect(await completeInvitesFromRoster(client(p) as never, db as never, { id: "g1", discordId: "guild" }, ["Amy Archer"])).toBe(1);
    process.env["FEATURE_PREVIEW_GUILD_IDS"] = "other";
    expect(await completeInvitesFromRoster(client(p) as never, db as never, { id: "g1", discordId: "guild" }, ["Amy Archer"])).toBe(0);
  });
});

describe("the World of Warcraft role DM", () => {
  it("finds the chosen role, else one named like World of Warcraft", () => {
    expect(findWowRoleId([{ id: "1", name: "Raiders" }, { id: "2", name: "World of Warcraft" }], null)).toBe("2");
    expect(findWowRoleId([{ id: "1", name: "WoW" }, { id: "2", name: "World of Warcraft" }], "1")).toBe("1");
    expect(findWowRoleId([{ id: "1", name: "Path of Exile" }], null)).toBeNull();
    expect(findWowRoleId([{ id: "1", name: "WoW" }], "gone")).toBe("1");
  });
  const members = (before: string[], after: string[]) => {
    const all = new Collection([["r1", { id: "r1", name: "World of Warcraft" }], ["r2", { id: "r2", name: "Other" }]]);
    const make = (ids: string[]) => ({ roles: { cache: new Collection(ids.map((id) => [id, all.get(id)!])) } });
    const send = vi.fn(async (...args: unknown[]) => { void args; });
    return { before: { partial: false, ...make(before) }, after: { id: "u1", user: { bot: false }, guild: { id: "guild", name: "Québec Gold", roles: { cache: all } }, ...make(after), send }, send };
  };
  it("sends one DM linking the channel when the role is given", async () => {
    const { before, after, send } = members([], ["r1"]); const db = database();
    expect(await handleWowRoleGiven(before as never, after as never, db as never)).toBe(true);
    expect(send.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("<#chan>") });
    expect(send.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("Québec Gold") });
    expect(db.dms).toEqual(["u1"]);
  });
  it("adds the interview questions to the DM and saves the answers under a name", async () => {
    const withQuestions = database(); withQuestions.guildSettings.findMany = vi.fn(async () => [{ ...settings, inviteQuestions: ["Class?", "Raid nights?"] }]);
    const { before, after, send } = members([], ["r1"]);
    await handleWowRoleGiven(before as never, after as never, withQuestions as never);
    expect(send.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("1. Class?"+LF+"2. Raid nights?") });
    const db = database();
    await handleInviteMessage(post(["Amy Archer", "1. Mage", "2. Tuesdays"].join(LF)) as never, db as never);
    expect(db.requests[0]).toMatchObject({ displayName: "Amy Archer", answers: ["1. Mage", "2. Tuesdays"].join(LF) });
  });
  it("does not repeat, and skips other roles, a switched-off DM, and people who already posted or have a character", async () => {
    const other = members([], ["r2"]);
    expect(await handleWowRoleGiven(other.before as never, other.after as never, database() as never)).toBe(false);
    const again = members([], ["r1"]); const sent = database(); sent.inviteDm.findUnique = vi.fn(async () => ({}));
    expect(await handleWowRoleGiven(again.before as never, again.after as never, sent as never)).toBe(false);
    const posted = members([], ["r1"]); const hasPost = database(); hasPost.inviteRequest.count = vi.fn(async () => 1);
    expect(await handleWowRoleGiven(posted.before as never, posted.after as never, hasPost as never)).toBe(false);
    const linked = members([], ["r1"]); const hasChar = database(); hasChar.member.findFirst = vi.fn(async () => ({ id: "m" })); hasChar.character.count = vi.fn(async () => 2);
    expect(await handleWowRoleGiven(linked.before as never, linked.after as never, hasChar as never)).toBe(false);
    const off = members([], ["r1"]); const noDm = database(); noDm.guildSettings.findMany = vi.fn(async () => []);
    expect(await handleWowRoleGiven(off.before as never, off.after as never, noDm as never)).toBe(false);
    const kept = members(["r1"], ["r1", "r2"]);
    expect(await handleWowRoleGiven(kept.before as never, kept.after as never, database() as never)).toBe(false);
  });
  it("skips quietly when DMs are closed", async () => {
    const { before, after, send } = members([], ["r1"]); send.mockRejectedValue(new Error("Cannot send messages to this user"));
    expect(await handleWowRoleGiven(before as never, after as never, database() as never)).toBe(false);
  });
});
