import { describe, expect, it, vi } from "vitest";
import { MessageType } from "discord.js";
import { ActivityBuffer, createActivityTracker } from "../src/services/activity-totals.js";

function fakeDb(enabled = true) {
  const rows = new Map<string, { messages: number; reactionsGiven: number; reactionsReceived: number; voiceSeconds: number }>();
  const settings = vi.fn(async () => enabled ? { guildId: "g1" } : null);
  const db = {
    guildSettings: { findFirst: settings },
    memberActivityTotal: {
      upsert: vi.fn(async ({ where, create, update }: { where: { guildId_userId: { guildId: string; userId: string } }; create: Record<string, number>; update: Record<string, { increment: number }> }) => {
        const key = `${where.guildId_userId.guildId}:${where.guildId_userId.userId}`;
        const row = rows.get(key);
        if (!row) rows.set(key, { messages: create["messages"]!, reactionsGiven: create["reactionsGiven"]!, reactionsReceived: create["reactionsReceived"]!, voiceSeconds: create["voiceSeconds"]! });
        else for (const field of Object.keys(update)) (row as Record<string, number>)[field]! += update[field]!.increment;
        return {};
      })
    }
  };
  return { db: db as never, raw: db, rows, settings };
}
const message = (over: Record<string, unknown> = {}) => ({ guildId: "d1", author: { id: "u1", bot: false }, webhookId: null, type: MessageType.Default, ...over }) as never;

describe("activity totals", () => {
  it("counts a person's messages and writes them in one upsert per member", async () => {
    const { db, rows, raw } = fakeDb();
    const tracker = createActivityTracker(db);
    await tracker.message(message(), 10_000);
    await tracker.message(message(), 20_000);
    await tracker.message(message({ author: { id: "u2", bot: false } }), 20_000);
    expect(await tracker.flush()).toBe(2);
    expect(rows.get("g1:u1")).toMatchObject({ messages: 2 });
    expect(rows.get("g1:u2")).toMatchObject({ messages: 1 });
    expect(raw.memberActivityTotal.upsert).toHaveBeenCalledTimes(2);
    await tracker.message(message(), 30_000);
    await tracker.flush();
    expect(rows.get("g1:u1")).toMatchObject({ messages: 3 });
  });
  it("ignores bots, webhooks, system messages and bursts under two seconds", async () => {
    const { db, rows } = fakeDb();
    const tracker = createActivityTracker(db);
    await tracker.message(message({ author: { id: "b", bot: true } }), 1);
    await tracker.message(message({ webhookId: "w" }), 1);
    await tracker.message(message({ type: MessageType.UserJoin }), 1);
    await tracker.message(message(), 10_000);
    await tracker.message(message(), 10_500);
    await tracker.flush();
    expect([...rows.keys()]).toEqual(["g1:u1"]);
    expect(rows.get("g1:u1")!.messages).toBe(1);
  });
  it("counts nothing in a guild with achievements off, and never stores message text", async () => {
    const { db, rows } = fakeDb(false);
    const tracker = createActivityTracker(db);
    await tracker.message(message({ content: "secret" }), 10_000);
    expect(await tracker.flush()).toBe(0);
    expect(rows.size).toBe(0);
    expect(JSON.stringify(tracker.buffer)).not.toContain("secret");
  });
  it("counts a reaction as given for the reactor and received for the author, once per message and person", async () => {
    const { db, rows } = fakeDb();
    const tracker = createActivityTracker(db);
    const reaction = (author: unknown) => ({ message: { id: "m1", guildId: "d1", author } }) as never;
    await tracker.reaction(reaction({ id: "a", bot: false }), { id: "r", bot: false } as never, 1000);
    await tracker.reaction(reaction({ id: "a", bot: false }), { id: "r", bot: false } as never, 2000); // toggled off and on again
    await tracker.reaction(reaction({ id: "r", bot: false }), { id: "r", bot: false } as never, 3000); // own message: given, not received
    await tracker.reaction(reaction({ id: "x", bot: true }), { id: "s", bot: false } as never, 4000); // bot author: no received
    await tracker.reaction(reaction({ id: "a", bot: false }), { id: "bot", bot: true } as never, 5000);
    await tracker.flush();
    expect(rows.get("g1:r")).toMatchObject({ reactionsGiven: 1 });
    expect(rows.get("g1:a")).toMatchObject({ reactionsReceived: 1 });
    expect(rows.get("g1:s")).toMatchObject({ reactionsGiven: 1, reactionsReceived: 0 });
    expect(rows.has("g1:x")).toBe(false);
  });
  it("credits voice minutes only to people with company, not alone, deafened or AFK, and not across a long gap", async () => {
    const { db, rows } = fakeDb();
    const tracker = createActivityTracker(db);
    const state = (id: string, channelId: string | null, over: Record<string, unknown> = {}) => ({ id, channelId, deaf: false, member: { user: { bot: false } }, ...over });
    const states = [state("a", "v1"), state("b", "v1"), state("c", "v2"), state("d", "v3", { deaf: true }), state("e", "v3"), state("f", "afk"), state("g", "afk"), state("h", null)];
    const guild = { id: "d1", afkChannelId: "afk", voiceStates: { cache: { filter: (fn: (s: unknown) => boolean) => { const kept = states.filter(fn); return Object.assign(kept, { size: kept.length, map: kept.map.bind(kept) }); } } } } as never;
    await tracker.voice(guild, 0);
    await tracker.voice(guild, 60_000);
    await tracker.voice(guild, 120_000);
    await tracker.voice(guild, 500_000); // long gap (restart): nothing credited
    await tracker.flush();
    expect(rows.get("g1:a")!.voiceSeconds).toBe(120);
    expect(rows.get("g1:b")!.voiceSeconds).toBe(120);
    for (const id of ["c", "d", "e", "f", "g", "h"]) expect(rows.has(`g1:${id}`), id).toBe(false);
  });
  it("keeps increments when a write fails and retries them on the next flush", async () => {
    const buffer = new ActivityBuffer();
    buffer.add("g1", "u1", { messages: 2 });
    const failing = { memberActivityTotal: { upsert: vi.fn(async () => { throw new Error("db down"); }) } };
    expect(await buffer.flush(failing as never)).toBe(0);
    expect(buffer.size).toBe(1);
    buffer.add("g1", "u1", { messages: 1 });
    const { db, rows } = fakeDb();
    expect(await buffer.flush(db)).toBe(1);
    expect(rows.get("g1:u1")!.messages).toBe(3);
  });
});
