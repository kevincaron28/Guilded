import { describe, expect, it, vi } from "vitest";
import { archiveLine, orderLine, pickCraftersToPing, pingCrafters, syncCraftChannels, PING_COOLDOWN_MS } from "../src/services/craft-channels.js";
import { channelNames, channelSpec } from "../src/setup-names.js";

// 9.1 (owner, 7 November 2026): crafting orders and archive channels, opt-in crafter pings.
const NOW = new Date("2026-12-20T12:00:00Z");
const base = {
  id: "r1", guildId: "g", item: "Flask of the Titans", quantity: 2, profession: "Alchemy", status: "OPEN" as const, threadId: "t1",
  orderMessageId: null, archiveMessageId: null, createdAt: NOW, doneAt: null, requesterId: "m1",
  requester: { discordUserId: "111", displayName: "Dude" }, crafter: null
};

describe("craft channels", () => {
  it("has French and English names for /setup", () => {
    expect(channelNames("craftOrdersChannelId")).toEqual(["craft-orders", "commandes-artisanat"]);
    expect(channelNames("craftArchiveChannelId")).toEqual(["craft-archive", "archive-artisanat"]);
    expect(channelSpec("craftOrdersChannelId", "fr")).toMatchObject({ category: "craft", access: "readonly" });
  });

  it("writes one line per open request and one compact archive line", () => {
    expect(orderLine(base, "en")).toBe(`🟢 2× **Flask of the Titans** · Alchemy · for <@111> · waiting for a crafter · <#t1> · <t:${NOW.getTime() / 1000}:R>`);
    expect(orderLine({ ...base, status: "CLAIMED", crafter: { discordUserId: "222", displayName: "Walter" } }, "fr")).toContain("Alchimie · pour <@111> · artisan <@222>");
    expect(archiveLine({ ...base, status: "DONE", doneAt: NOW, crafter: { discordUserId: "222", displayName: "Walter" } }, "en")).toBe(`✅ 2× **Flask of the Titans** · for <@111> · by <@222> · <t:${NOW.getTime() / 1000}:d>`);
  });

  function fakeGuild() {
    const sent: { channel: string; content: string }[] = [];
    const deleted: string[] = [];
    const channel = (id: string) => ({
      isTextBased: () => true, messages: { fetch: async (mid: string) => ({ edit: vi.fn(), delete: async () => { deleted.push(mid); } }) },
      send: async ({ content }: { content: string }) => { sent.push({ channel: id, content }); return { id: `msg-${sent.length}` }; }
    });
    return { guild: { channels: { fetch: async (id: string) => channel(id) } } as never, sent, deleted };
  }

  it("posts the order, then on completion deletes it and archives once; nothing when officers turned it off", async () => {
    const updates: unknown[] = [];
    const db = (enabled: boolean) => ({
      guildSettings: { findUnique: async () => ({ craftOrdersEnabled: enabled, craftOrdersChannelId: "orders", craftArchiveChannelId: "archive" }) },
      craftRequest: { update: async ({ data }: { data: unknown }) => { updates.push(data); } }
    }) as never;
    const g = fakeGuild();
    await syncCraftChannels(db(true), g.guild, base, "en");
    expect(g.sent[0]?.channel).toBe("orders");
    expect(updates[0]).toEqual({ orderMessageId: "msg-1" });
    await syncCraftChannels(db(true), g.guild, { ...base, status: "DONE", orderMessageId: "msg-1", doneAt: NOW }, "en");
    expect(g.deleted).toEqual(["msg-1"]);
    expect(g.sent[1]?.channel).toBe("archive");
    await syncCraftChannels(db(true), g.guild, { ...base, status: "DONE", archiveMessageId: "msg-2" }, "en");
    expect(g.sent).toHaveLength(2);
    const off = fakeGuild();
    await syncCraftChannels(db(false), off.guild, base, "en");
    expect(off.sent).toHaveLength(0);
  });
});

describe("crafter pings", () => {
  const sub = (memberId: string, lastPingAt: Date | null = null) => ({ memberId, discordUserId: `d-${memberId}`, profession: "Alchemy", lastPingAt });

  it("pings only opted-in members who know the recipe, never the requester, not twice within the cooldown, at most 5", () => {
    const knowers = new Set(["a", "b", "c", "m1", "d", "e", "f", "g"]);
    const picked = pickCraftersToPing([sub("a"), sub("b", new Date(NOW.getTime() - PING_COOLDOWN_MS / 2)), sub("x"), sub("m1"), sub("c"), sub("d"), sub("e"), sub("f"), sub("g")], knowers, "m1", NOW);
    expect(picked.map((p) => p.memberId)).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("mentions the chosen crafters once and stamps them; nothing when the pings are off or nobody knows the recipe", async () => {
    const stamped: unknown[] = [];
    const db = (on: boolean, recipes: { character: string; profession: string }[]) => ({
      guildSettings: { findUnique: async () => ({ craftPingsEnabled: on }) },
      recipeKnown: { findMany: async () => recipes },
      character: { findMany: async () => [{ memberId: "a" }, { memberId: "m1" }] },
      craftNotify: { findMany: async () => [{ memberId: "a", profession: "Alchemy", lastPingAt: null }, { memberId: "m1", profession: "Alchemy", lastPingAt: null }, { memberId: "z", profession: "Alchemy", lastPingAt: null }],
        updateMany: async (args: unknown) => { stamped.push(args); } },
      member: { findMany: async () => [{ id: "a", discordUserId: "222" }, { id: "m1", discordUserId: "111" }, { id: "z", discordUserId: "333" }] }
    }) as never;
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await pingCrafters(db(true, [{ character: "Walter Sobchak", profession: "Alchemy" }]), base, send, "en", NOW)).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("<@222> your recipe is wanted"), ["222"]);
    expect(send.mock.calls[0]![0]).not.toContain("<@111>");
    expect(stamped).toHaveLength(1);
    expect(await pingCrafters(db(false, [{ character: "Walter Sobchak", profession: "Alchemy" }]), base, send, "en", NOW)).toBe(0);
    expect(await pingCrafters(db(true, []), base, send, "en", NOW)).toBe(0);
  });
});
