import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeRaidPosts, syncRaidPosts } from "../src/services/raid-signup-posts.js";

function fixture(legacy = false) {
  const row = { status: "PLANNED" as "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED", scheduledAt: new Date(Date.now() + 86400000), id: "raid", guildId: "guild", signupChannelId: legacy ? "core" : null, signupMessageId: legacy ? "old" : null, mirrorSignupChannelId: null as string | null, mirrorSignupMessageId: null as string | null };
  const copies = new Map<string, Map<string, { id: string; edit: (body: unknown) => Promise<void> }>>();
  const payloads: unknown[] = [];
  let sends = 0;
  let forbidden = false;
  const guild = { channels: { fetch: async (id: string) => ({
    isTextBased: () => true,
    messages: { fetch: async (messageId: string) => {
      if (id === "core" && forbidden) throw Object.assign(new Error("Forbidden"), { code: 50013 });
      const message = copies.get(id)?.get(messageId);
      if (!message) throw Object.assign(new Error("Unknown message"), { code: 10008 });
      return message;
    } },
    send: async (body: unknown) => {
      payloads.push(body); sends++;
      const message = { id: `post-${sends}`, edit: async (body: unknown) => { payloads.push(body); } };
      if (!copies.has(id)) copies.set(id, new Map());
      copies.get(id)!.set(message.id, message);
      return message;
    }
  }) } };
  if (legacy) copies.set("core", new Map([["old", { id: "old", edit: async body => { payloads.push(body); } }]]));
  const database = { raid: { updateMany: async ({ where, data }: { where: unknown; data: object }) => {
    expect(where).toEqual({ id: "raid", guildId: "guild" }); Object.assign(row, data);
  } } };
  const payload = { embeds: [], components: [], allowedMentions: { parse: [] as never[] } };
  const sync = (general: string | null = "general", core: string | null = "core") => syncRaidPosts(guild as never, database as never, { ...row }, general, core, payload);
  return { row, copies, sync, payloads, payload, sends: () => sends, forbid: () => { forbidden = true; }, allow: () => { forbidden = false; } };
}

describe("one raid roster with two Discord posts", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const)("does not repost an October 1 raid left %s on October 3", async status => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T16:00:00Z"));
    const f = fixture();
    f.row.status = status;
    f.row.scheduledAt = new Date("2026-10-02T00:00:00Z"); // October 1, 8pm Toronto
    await f.sync(); await f.sync();
    expect(f.sends()).toBe(0);
  });

  it("does not replace deleted posts when a delayed retry runs after the start", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.sync();
    f.copies.clear();
    vi.setSystemTime(f.row.scheduledAt);
    await f.sync();
    expect(f.sends()).toBe(2);
  });

  it("edits existing completed posts without creating a missing mirror", async () => {
    const f = fixture(true);
    f.row.status = "COMPLETED";
    await f.sync();
    expect(f.sends()).toBe(0);
    expect(f.payloads).toEqual([f.payload]);
  });

  it("posts the same buttons and roster in both channels; later updates edit both", async () => {
    const f = fixture(); await f.sync(); await f.sync();
    expect(f.sends()).toBe(2);
    expect(f.payloads).toEqual([f.payload, f.payload, f.payload, f.payload]);
    expect(f.row).toMatchObject({ signupChannelId: "general", mirrorSignupChannelId: "core" });
  });
  it("adopts a legacy core post and retains its reference when a later edit fails", async () => {
    const f = fixture(true); f.forbid();
    await expect(f.sync()).rejects.toThrow("Forbidden");
    expect(f.row).toMatchObject({ signupChannelId: "general", mirrorSignupChannelId: "core", mirrorSignupMessageId: "old" });
    f.allow(); await f.sync(); expect(f.sends()).toBe(1);
  });
  it("posts once if core and general use the same channel", async () => {
    const f = fixture(); await f.sync("core", "core"); expect(f.sends()).toBe(1);
  });
  it("serializes concurrent updates and recovers after a failed operation", async () => {
    const order: number[] = [];
    await Promise.all([
      serializeRaidPosts("serial", async () => { order.push(1); await Promise.resolve(); order.push(2); }),
      serializeRaidPosts("serial", async () => { order.push(3); })
    ]);
    expect(order).toEqual([1, 2, 3]);
    await expect(serializeRaidPosts("serial", async () => { throw new Error("Failed"); })).rejects.toThrow();
    await serializeRaidPosts("serial", async () => { order.push(4); });
    expect(order.at(-1)).toBe(4);
  });
});
