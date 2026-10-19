import { describe, expect, it, vi } from "vitest";
import type { ButtonInteraction } from "discord.js";
import { describeListing, listingPatch, saveListing } from "../src/commands/recruit.js";
import { handleWebApplicationButton, webApplicationEmbed, webApplicationRows } from "../src/services/recruitment-discord.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

describe("/mod recruit", () => {
  it("keeps saved fields for empty options and clears text with none", () => {
    expect(listingPatch({ open: true })).toEqual({ open: true });
    expect(listingPatch({ open: false, classes: "prêtre, chaman", roles: "heal", days: "mer dim", times: "20h-23h", language: "fr", faction: "ALLIANCE", realm: "Doomhowl", note: "none" }))
      .toEqual({ open: false, classes: ["Priest", "Shaman"], roles: ["HEALER"], raidDays: ["wednesday", "sunday"], raidTimes: "20h-23h", language: "fr", faction: "ALLIANCE", realm: "Doomhowl", note: null });
    expect(() => listingPatch({ open: true, roles: "bard" })).toThrow("Unknown role");
  });

  it("stores one listing per guild and per core", async () => {
    const upsert = vi.fn(async (args: unknown) => args);
    const database = { recruitmentListing: { upsert } } as never;
    await saveListing(database, "g1", null, { open: true }, "u1");
    await saveListing(database, "g1", { id: "core1" }, { open: true, roles: ["TANK"] }, "u1");
    expect(upsert.mock.calls[0]![0]).toMatchObject({ where: { scopeKey: "guild:g1" }, create: { guildId: "g1", scopeKey: "guild:g1", open: true, updatedBy: "u1" } });
    expect(upsert.mock.calls[1]![0]).toMatchObject({ where: { scopeKey: "core:core1" }, create: { coreId: "core1", roles: ["TANK"] } });
  });

  it("summarizes a listing", () => {
    expect(describeListing({ open: true, classes: [], roles: ["TANK"], raidDays: ["wednesday"], raidTimes: "8pm", language: "fr", faction: "ALLIANCE", realm: null, note: "Hi" }))
      .toBe("🟢 open · all classes · Tank · Wed · 8pm · French · Alliance\n> Hi");
  });
});

function button(customId: string, options: { officer?: boolean; guildId?: string; dm?: "ok" | "closed" } = {}) {
  const send = vi.fn(async () => (options.dm === "closed" ? Promise.reject(new Error("Cannot send")) : undefined));
  return {
    customId, guildId: options.guildId ?? "111111111111111111",
    inGuild: () => true,
    member: { permissions: { has: () => options.officer ?? true }, roles: { cache: { some: () => false } } },
    user: { id: "999999999999999999" },
    message: { embeds: [webApplicationEmbed({ id: "a", status: "PENDING", character: "Kev", className: "Warrior", role: "TANK", message: "Hello there", guildDiscordId: "1", guildName: "Q", coreName: null, discordUserId: "2", username: "kev", inviteUrl: null }, "en").toJSON()] },
    client: { users: { fetch: vi.fn(async () => ({ send })) } },
    reply: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    send
  };
}

describe("application buttons in Discord", () => {
  async function pending() {
    const memory = memoryWebStore();
    const listing = memory.addListing({ inviteUrl: "https://discord.gg/abc123" });
    const account = await memory.store.upsertAccount({ id: "222222222222222222", username: "kev", displayName: null }, new Date());
    const { id } = await memory.store.createApplication({ listingId: listing.id, accountId: account.id, character: "Kev", className: "Warrior", role: "TANK", message: "Hello there" });
    return { memory, id };
  }

  it("has accept, decline and spam buttons", () => {
    expect(webApplicationRows("x")[0]!.toJSON().components.map((component) => (component as { custom_id: string }).custom_id)).toEqual(["webapply:accept:x", "webapply:decline:x", "webapply:spam:x"]);
  });

  it("accepts once, tells the player by DM and removes the buttons", async () => {
    const { memory, id } = await pending();
    const click = button(`webapply:accept:${id}`);
    await handleWebApplicationButton(click as unknown as ButtonInteraction, memory.store);
    expect(memory.applications.get(id)!.status).toBe("ACCEPTED");
    expect(click.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("https://discord.gg/abc123") }));
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    const again = button(`webapply:decline:${id}`);
    await handleWebApplicationButton(again as unknown as ButtonInteraction, memory.store);
    expect(again.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("already answered") }));
    expect(memory.applications.get(id)!.status).toBe("ACCEPTED");
  });

  it("refuses members and other servers, and still records the answer when DMs are closed", async () => {
    const { memory, id } = await pending();
    const member = button(`webapply:accept:${id}`, { officer: false });
    await handleWebApplicationButton(member as unknown as ButtonInteraction, memory.store);
    expect(member.reply).toHaveBeenCalled();
    const elsewhere = button(`webapply:accept:${id}`, { guildId: "555555555555555555" });
    await handleWebApplicationButton(elsewhere as unknown as ButtonInteraction, memory.store);
    expect(memory.applications.get(id)!.status).toBe("PENDING");
    const closed = button(`webapply:spam:${id}`, { dm: "closed" });
    await handleWebApplicationButton(closed as unknown as ButtonInteraction, memory.store);
    expect(memory.applications.get(id)!.status).toBe("SPAM");
    const update = closed.update.mock.calls[0] as unknown as [{ embeds: { toJSON(): { fields: { value: string }[] } }[] }];
    expect(update[0].embeds[0]!.toJSON().fields.at(-1)!.value).toContain("DMs are closed");
  });
});
