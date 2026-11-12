import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_DELAY_MS, cleanAllInviteChannels, cleanInviteChannel, resetCleanupWarnings } from "../src/services/invite-cleanup.js";

const now = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
type Row = { id: string; guildId: string; status: string; cleanedAt: Date | null; invitedAt: Date | null; channelId: string; messageId: string; discordUserId: string; notifyMessageId: string | null };

function setup(rows: Row[], opts: { messages?: Record<string, { author: string; pinned?: boolean; ref?: string; deleteError?: number }>; switchOn?: boolean } = {}) {
  const deleted: string[] = [];
  const messages = new Map(Object.entries(opts.messages ?? {}).map(([id, m]) => [id, {
    id, pinned: Boolean(m.pinned), author: { id: m.author }, reference: m.ref ? { messageId: m.ref } : null,
    delete: vi.fn(async () => { if (m.deleteError) throw Object.assign(new Error("x"), { code: m.deleteError }); deleted.push(id); messages.delete(id); })
  }]));
  const channel = { isTextBased: () => true, messages: { fetch: vi.fn(async (arg: unknown) => {
    if (typeof arg === "string") { const m = messages.get(arg); if (!m) throw Object.assign(new Error("gone"), { code: 10008 }); return m; }
    return new Map([...messages].filter(([id]) => BigInt(id) > BigInt((arg as { after: string }).after)));
  }) } };
  const client = { user: { id: "bot" }, channels: { fetch: vi.fn(async () => channel) } };
  const database = {
    guildSettings: { findMany: vi.fn(async () => opts.switchOn === false ? [] : [{ guildId: "g1", inviteChannelId: "chan" }]) },
    inviteRequest: {
      findMany: vi.fn(async ({ where, take }: { where: { status: { in: string[] }; cleanedAt: null; invitedAt: { lte: Date } }; take: number }) => rows.filter((r) => where.status.in.includes(r.status) && r.cleanedAt === null && r.invitedAt !== null && r.invitedAt <= where.invitedAt.lte).slice(0, take)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { cleanedAt: Date } }) => { const r = rows.find((x) => x.id === where.id && x.cleanedAt === null); if (r) r.cleanedAt = data.cleanedAt; return { count: r ? 1 : 0 }; })
    }
  };
  return { client, database, deleted, rows };
}
const row = (over: Partial<Row> = {}): Row => ({ id: "r1", guildId: "g1", status: "INVITED", cleanedAt: null, invitedAt: ago(CLEANUP_DELAY_MS + 1000), channelId: "chan", messageId: "100", discordUserId: "u1", notifyMessageId: "101", ...over });

beforeEach(() => { resetCleanupWarnings(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });

describe("guild-invite channel clean-up", () => {
  it("deletes a handled member post, the tag message and the bot's reply once the delay passed", async () => {
    const t = setup([row()], { messages: { "100": { author: "u1" }, "101": { author: "bot", ref: "100" }, "102": { author: "bot", ref: "100" }, "103": { author: "officer", ref: "100" }, "104": { author: "bot", ref: "999" } } });
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(t.deleted.sort()).toEqual(["100", "101", "102"]); // the officer's reply and another request's follow-up stay
    expect(t.rows[0]!.cleanedAt).toEqual(now);
  });
  it("deletes the bot's own request post made by the Request button", async () => {
    const t = setup([row()], { messages: { "100": { author: "bot" } } });
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(t.deleted).toEqual(["100"]);
  });
  it("waits for the delay and never touches a pending request", async () => {
    const t = setup([row({ invitedAt: ago(CLEANUP_DELAY_MS - 60_000) }), row({ id: "r2", status: "PENDING", invitedAt: null, messageId: "200" })], { messages: { "100": { author: "u1" }, "200": { author: "u2" } } });
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(t.deleted).toEqual([]);
    await cleanAllInviteChannels(t.client as never, t.database as never, new Date(now.getTime() + 120_000));
    expect(t.deleted).toEqual(["100"]);
  });
  it("survives a restart: the deadline is on the row, a second run deletes nothing twice", async () => {
    const t = setup([row({ invitedAt: ago(10 * 60_000) })], { messages: { "100": { author: "u1" } } });
    await cleanAllInviteChannels(t.client as never, t.database as never, now); // "before restart": too early
    expect(t.deleted).toEqual([]);
    const later = new Date(now.getTime() + CLEANUP_DELAY_MS);
    await cleanAllInviteChannels(t.client as never, t.database as never, later); // "after restart"
    await cleanAllInviteChannels(t.client as never, t.database as never, later);
    expect(t.deleted).toEqual(["100"]);
  });
  it("tolerates a message that is already gone and still marks the request done", async () => {
    const t = setup([row()], { messages: {} });
    expect(await cleanAllInviteChannels(t.client as never, t.database as never, now)).toBe(0);
    expect(t.rows[0]!.cleanedAt).toEqual(now);
  });
  it("logs a missing Manage Messages permission once and never retries", async () => {
    const t = setup([row(), row({ id: "r2", messageId: "200", notifyMessageId: null })], { messages: { "100": { author: "u1", deleteError: 50013 }, "200": { author: "u2", deleteError: 50013 } } });
    t.rows[1]!.discordUserId = "u2";
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(t.deleted).toEqual([]);
  });
  it("leaves pinned messages, other people's posts and requests from another channel", async () => {
    const t = setup([row(), row({ id: "r2", messageId: "200", channelId: "old", notifyMessageId: null }), row({ id: "r3", messageId: "300", notifyMessageId: null, discordUserId: "u3" })],
      { messages: { "100": { author: "u1", pinned: true }, "200": { author: "u2" }, "300": { author: "someoneElse" } } });
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(t.deleted).toEqual([]);
  });
  it("does nothing when the officer switch is off", async () => {
    const t = setup([row()], { messages: { "100": { author: "u1" } }, switchOn: false });
    await cleanAllInviteChannels(t.client as never, t.database as never, now);
    expect(t.deleted).toEqual([]);
    expect(t.rows[0]!.cleanedAt).toBeNull();
    expect(t.database.guildSettings.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inviteCleanupEnabled: true }) }));
  });
  it("limits a sweep to a small batch", async () => {
    const many = Array.from({ length: 20 }, (_, i) => row({ id: `r${i}`, messageId: String(1000 + i), notifyMessageId: null }));
    const t = setup(many, { messages: Object.fromEntries(many.map((r) => [r.messageId, { author: "u1" }])) });
    await cleanInviteChannel(t.client as never, t.database as never, "g1", "chan", now);
    expect(t.deleted).toHaveLength(15);
  });
});
