import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.now();
const day = 86_400_000;
const mocks = vi.hoisted(() => ({
  prisma: {
    professionSkill: { findMany: vi.fn() }, recipeKnown: { findMany: vi.fn(), findFirst: vi.fn() }, character: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    craftRequest: { findUniqueOrThrow: vi.fn(), update: vi.fn() }
  },
  settings: { language: "en", craftChannelId: "forum1" }
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/commands/context.js", () => ({
  guildService: { ensureGuild: async () => ({ id: "g1" }), getSettings: async () => mocks.settings, ensureMember: async () => ({ id: "m1" }) }
}));

import { handleCraftButton, handleCraftSelect, postCraftRequest, recipeForForm, requestRows } from "../src/commands/craft-board.js";

beforeEach(() => {
  mocks.prisma.professionSkill.findMany.mockResolvedValue([
    { profession: "Alchemy", skillLevel: 300, character: { name: "Ann", lastSeenAt: new Date(NOW - 0.1 * day) } },
    { profession: "Alchemy", skillLevel: 150, character: { name: "Bob", lastSeenAt: new Date(NOW - 40 * day) } }
  ]);
  mocks.prisma.recipeKnown.findFirst.mockResolvedValue({ itemName: "Elixir", profession: "Alchemy" });
  mocks.prisma.recipeKnown.findMany.mockResolvedValue([
    { character: "Ann", profession: "Alchemy", itemKey: 7, itemName: "Elixir", scannedAt: new Date(NOW - day) },
    { character: "Bob", profession: "Alchemy", itemKey: 7, itemName: "Elixir", scannedAt: new Date(NOW - 41 * day) }
  ]);
});

const interaction = (extra: Record<string, unknown>) => ({
  guild: { id: "d1", name: "Guild" }, user: { id: "u1" }, member: null,
  reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn(), showModal: vi.fn(), ...extra
});

describe("profession post picker (Request and Details)", () => {
  it("adds Request and a crafter menu under the Details answer", () => {
    const rows = requestRows("en", 7, [{ character: "Ann", skill: 300, lastSeen: new Date(NOW) }]).map(row => row.toJSON().components as unknown as { custom_id: string; label?: string }[]);
    expect(rows[0]![0]!.custom_id).toBe("craft:askwho:7");
    expect(rows[1]!.map(button => [button.custom_id, button.label])).toEqual([["craft:ask:7", "Request"]]);
    expect(requestRows("en", 7, [])).toHaveLength(1);
  });
  it("opens the ordinary request form already filled with the item and the chosen crafter", async () => {
    const menu = interaction({ customId: "craft:askwho:7", values: ["Ann"] });
    await handleCraftSelect(menu as never);
    const modal = menu.showModal.mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toBe("craft:new-modal:Ann");
    const fields = modal.components.map((row: { components: { custom_id: string; value?: string }[] }) => [row.components[0]!.custom_id, row.components[0]!.value]);
    expect(fields.slice(0, 2)).toEqual([["item", "Elixir"], ["profession", "Alchemy"]]);
    const button = interaction({ customId: "craft:ask:7" });
    await handleCraftButton(button as never);
    expect(button.showModal.mock.calls[0]![0].toJSON().custom_id).toBe("craft:new-modal");
  });
});

describe("answering inside Discord's 3-second window (10062)", () => {
  it("opens the Request form from one indexed row, never by loading every profession post", async () => {
    mocks.prisma.recipeKnown.findMany.mockClear();
    const button = interaction({ customId: "craft:ask:7" });
    await handleCraftButton(button as never);
    expect(mocks.prisma.recipeKnown.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g1", itemKey: 7 } }));
    expect(mocks.prisma.recipeKnown.findMany).not.toHaveBeenCalled();
    expect(button.showModal).toHaveBeenCalledTimes(1);
  });
  it("opens the form empty instead of late when the database is slow, and says when a recipe is gone", async () => {
    mocks.prisma.recipeKnown.findFirst.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ itemName: "Elixir", profession: "Alchemy" }), 200)));
    expect(await recipeForForm("g1", 7, 10)).toBe("slow");
    mocks.prisma.recipeKnown.findFirst.mockResolvedValueOnce(null);
    const button = interaction({ customId: "craft:ask:8" });
    await handleCraftButton(button as never);
    expect(button.showModal).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledTimes(1);
  });
  it("defers a request action before any database work", async () => {
    const order: string[] = [];
    const button = interaction({ customId: "craft:r1:claim", deferReply: vi.fn(async () => { order.push("defer"); }) });
    mocks.prisma.craftRequest.findUniqueOrThrow.mockImplementationOnce(async () => { order.push("db"); throw new Error("stop"); });
    await handleCraftButton(button as never).catch(() => undefined);
    mocks.prisma.craftRequest.findUniqueOrThrow.mockReset();
    expect(order[0]).toBe("defer");
  });
});

describe("a request for one crafter", () => {
  const forumAndThread = () => {
    const send = vi.fn(async (...args: [{ content: string; allowedMentions: { users: string[] } }]) => args.length && undefined);
    const forum = { type: 15, availableTags: [], setAvailableTags: vi.fn(), threads: { create: vi.fn(async () => ({ id: "t1", send })) } };
    return { send, forum, guild: { id: "d1", channels: { fetch: async () => forum } } };
  };
  const request = { id: "r1", guildId: "g1", item: "Elixir", quantity: 1, profession: "Alchemy", note: null, materialsProvided: false, threadId: null, status: "OPEN", createdAt: new Date(),
    requester: { discordUserId: "u1", displayName: "Kev" }, crafter: null };
  beforeEach(() => { mocks.prisma.craftRequest.findUniqueOrThrow.mockResolvedValue(request); mocks.prisma.craftRequest.update.mockResolvedValue({}); });

  it("pings the asked crafter once, in the new post, and no one else", async () => {
    const { send, guild } = forumAndThread();
    mocks.prisma.character.findFirst.mockResolvedValue({ name: "Ann", member: { discordUserId: "u2" } });
    expect(await postCraftRequest(guild as never, "r1", "ann")).toEqual({ posted: true, threadId: "t1" });
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    expect(message.content).toContain("<@u2>");
    expect(message.allowedMentions).toEqual({ users: ["u2"] });
  });
  it("does not ping when the request is for no one, or the asked character is the requester's own", async () => {
    const anyone = forumAndThread();
    await postCraftRequest(anyone.guild as never, "r1");
    expect(anyone.send).not.toHaveBeenCalled();
    const own = forumAndThread();
    mocks.prisma.character.findFirst.mockResolvedValue({ name: "Kevin", member: { discordUserId: "u1" } });
    await postCraftRequest(own.guild as never, "r1", "Kevin");
    expect(own.send).not.toHaveBeenCalled();
  });
});
