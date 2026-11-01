import { describe, expect, it, vi } from "vitest";
import { ChannelType, type Guild } from "discord.js";
import type { CommunityKudos, CommunitySeason, PrismaClient } from "../src/generated/prisma/client.js";
import { nominationCard, postNominationCards } from "../src/services/nomination-cards.js";

const season = { id: "s1", name: "October 2026", number: 1, game: "DISCORD" } as CommunitySeason;
const claim = { id: "k1", seasonId: "s1", userId: "111111111111111111", nominatorId: "222222222222222222", reason: "Carried my *dungeon*", status: "PENDING", reviewedBy: null, reviewNote: null, cardMessageId: null, createdAt: new Date() } as CommunityKudos;

function fakeDatabase(adminChannelId: string | null, rows: CommunityKudos[]) {
  const store = rows.map(row => ({ ...row, season }));
  return {
    store,
    database: {
      guildSettings: { findUnique: vi.fn(async () => ({ adminChannelId, language: "en" })) },
      communityKudos: {
        findMany: vi.fn(async () => store.filter(row => row.status === "PENDING" && row.cardMessageId === null)),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; cardMessageId: string | null }; data: { cardMessageId: string | null } }) => {
          const row = store.find(r => r.id === where.id && r.cardMessageId === where.cardMessageId);
          if (row) row.cardMessageId = data.cardMessageId;
          return { count: row ? 1 : 0 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { cardMessageId: string } }) => Object.assign(store.find(r => r.id === where.id)!, data))
      }
    } as unknown as PrismaClient
  };
}

const guildWith = (send: ReturnType<typeof vi.fn>, canSend = true) => ({
  members: { me: { id: "bot" } },
  channels: { cache: new Map([["admin", { id: "admin", type: ChannelType.GuildText, send, permissionsFor: () => ({ has: () => canSend }) }]]), fetch: vi.fn(async () => null) }
}) as unknown as Guild;

describe("helper nomination review cards", () => {
  it("shows the nomination with Approve and Reject buttons, and drops the buttons once decided", () => {
    const pending = nominationCard("en", claim, season);
    expect(pending.components[0]!.components.map(button => (button.data as { custom_id: string }).custom_id)).toEqual([
      "community:hub-nomreview:k1:approve", "community:hub-nomreview:k1:reject"
    ]);
    expect(pending.embeds[0]!.data.fields!.map(field => field.value)).toContain("<@111111111111111111>");
    expect(pending.allowedMentions).toEqual({ parse: [] });
    const decided = nominationCard("en", { ...claim, status: "APPROVED", reviewedBy: "333333333333333333", reviewNote: "Confirmed" }, season);
    expect(decided.components).toEqual([]);
    expect(decided.embeds[0]!.data.title).toContain("✅");
    expect(JSON.stringify(decided.embeds[0]!.data.fields)).toContain("<@333333333333333333>");
  });

  it("posts one card per pending nomination, once, to the Discord admin channel", async () => {
    const send = vi.fn(async () => ({ id: "message-1" }));
    const { database, store } = fakeDatabase("admin", [claim]);
    expect(await postNominationCards(guildWith(send), database, "guild")).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store[0]!.cardMessageId).toBe("message-1");
    expect(await postNominationCards(guildWith(send), database, "guild")).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an admin channel the bot can post in, and retries after a failed send", async () => {
    const send = vi.fn(async () => ({ id: "message-1" }));
    expect(await postNominationCards(guildWith(send), fakeDatabase(null, [claim]).database, "guild")).toBe(0);
    expect(await postNominationCards(guildWith(send, false), fakeDatabase("admin", [claim]).database, "guild")).toBe(0);
    expect(send).not.toHaveBeenCalled();

    const failing = vi.fn(async () => { throw new Error("Missing Access"); });
    const { database, store } = fakeDatabase("admin", [claim]);
    await expect(postNominationCards(guildWith(failing), database, "guild")).rejects.toThrow("Missing Access");
    expect(store[0]!.cardMessageId).toBeNull();
  });
});
