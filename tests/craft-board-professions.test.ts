import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.now();
const day = 86_400_000;
const mocks = vi.hoisted(() => ({
  prisma: {
    professionSkill: { findMany: vi.fn() }, recipeKnown: { findMany: vi.fn() }, character: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    craftRequest: { findUniqueOrThrow: vi.fn(), update: vi.fn() }
  },
  settings: { language: "en", craftChannelId: "forum1" }
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/commands/context.js", () => ({
  guildService: { ensureGuild: async () => ({ id: "g1" }), getSettings: async () => mocks.settings, ensureMember: async () => ({ id: "m1" }) }
}));

import { handleCraftButton, handleCraftSelect, postCraftRequest } from "../src/commands/craft-board.js";

beforeEach(() => {
  mocks.prisma.professionSkill.findMany.mockResolvedValue([
    { profession: "Alchemy", skillLevel: 300, character: { name: "Ann", lastSeenAt: new Date(NOW - 0.1 * day) } },
    { profession: "Alchemy", skillLevel: 150, character: { name: "Bob", lastSeenAt: new Date(NOW - 40 * day) } }
  ]);
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
  it("shows who can craft the picked recipe with icon, bar and last seen, plus Request, Details and a crafter menu", async () => {
    const i = interaction({ customId: "craft:pick", values: ["7"] });
    await handleCraftSelect(i as never);
    const reply = i.editReply.mock.calls[0]![0];
    const text = reply.embeds[0].toJSON().description as string;
    expect(text).toContain("🧪 Alchemy");
    expect(text).toContain("🟢 **Ann** ▰▰▰▰▰▰▰▰ 300 · today");
    expect(text).toContain("⚪ **Bob**");
    const rows = reply.components.map((row: { toJSON(): { components: { custom_id: string; label?: string }[] } }) => row.toJSON().components);
    expect(rows[0][0].custom_id).toBe("craft:askwho:7");
    expect(rows[1].map((button: { custom_id: string }) => button.custom_id)).toEqual(["craft:ask:7", "craft:info:7"]);
    expect(rows[1].map((button: { label: string }) => button.label)).toEqual(["Request", "Details"]);
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
  it("shows Details with the item id and link, and says so when the recipe is gone", async () => {
    const info = interaction({ customId: "craft:info:7" });
    await handleCraftButton(info as never);
    const embed = info.editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.title).toBe("Elixir");
    expect(embed.description).toContain("Item ID 7");
    expect(embed.url).toBe("https://www.wowhead.com/classic/item=7");
    const gone = interaction({ customId: "craft:info:99" });
    await handleCraftButton(gone as never);
    expect(gone.editReply.mock.calls[0]![0].content).toBe("That recipe is no longer listed.");
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
