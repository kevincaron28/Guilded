import { describe, expect, it, vi } from "vitest";
import { buildWelcomeMessage, handleWelcomeRoleButton, welcomeDelivery, welcomeEnabled } from "../src/services/housekeeping.js";

const guild = { id: "g1", name: "Guilded", memberCount: 42 };
const base = { welcomeMessageTemplate: null, welcomeRoleIds: [] as string[], rulesChannelId: null as string | null };
const ids = (message: ReturnType<typeof buildWelcomeMessage>) =>
  (message.components[0]!.toJSON().components as { custom_id: string }[]).map((button) => button.custom_id);

describe("welcome message", () => {
  it("is on with a channel, or with DM delivery even without one", () => {
    expect(welcomeEnabled({ welcomeDelivery: "CHANNEL", welcomeChannelId: null })).toBe(false);
    expect(welcomeEnabled({ welcomeDelivery: "CHANNEL", welcomeChannelId: "c" })).toBe(true);
    expect(welcomeEnabled({ welcomeDelivery: "DM", welcomeChannelId: null })).toBe(true);
    expect(welcomeDelivery({ welcomeDelivery: "nonsense" })).toBe("CHANNEL");
  });

  it("always offers pairing and the checklist, with the server id so the buttons work in a DM", () => {
    const message = buildWelcomeMessage(base, guild as never, { id: "u1", username: "Kev" });
    expect(ids(message)).toEqual(["onboard:pair:g1", "onboard:chat:g1", "onboard:steps:g1"]);
    expect(message.content).toContain("<@u1>");
  });

  it("adds the rules and game buttons only when the server uses them", () => {
    const message = buildWelcomeMessage({ ...base, welcomeRoleIds: ["wow"], rulesChannelId: "rules" }, guild as never, { id: "u1", username: "Kev" });
    expect(ids(message)).toEqual(["onboard:rules:g1", "onboard:games:g1", "onboard:pair:g1", "onboard:chat:g1", "onboard:steps:g1"]);
  });

  it("keeps a custom template", () => {
    const message = buildWelcomeMessage({ ...base, welcomeMessageTemplate: "Salut {username}, {membercount}e membre de {guild}" }, guild as never, { id: "u1", username: "Kev" });
    expect(message.content).toBe("Salut Kev, 42e membre de Guilded");
  });

  it("refuses roles that are no longer offered", async () => {
    vi.resetModules();
    const reply = vi.fn();
    const editReply = vi.fn();
    const interaction = {
      customId: "welcomerole:g1:admin",
      user: { id: "u1" },
      reply, deferReply: vi.fn(), editReply,
      client: { guilds: { fetch: vi.fn().mockResolvedValue({ id: "g1", name: "QG", roles: { cache: new Map([["admin", { id: "admin", name: "Admin" }]]), fetch: vi.fn().mockResolvedValue({ id: "admin", name: "Admin", managed: false, permissions: { bitfield: 0n } }) } }) } }
    };
    const housekeeping = await import("../src/services/housekeeping.js");
    // Settings offer only "wow"; a crafted "admin" id must be rejected.
    vi.spyOn(housekeeping.welcomeGuildService, "ensureGuild").mockResolvedValue({ id: "db-g1" } as never);
    vi.spyOn(housekeeping.welcomeGuildService, "getSettings").mockResolvedValue({ welcomeRoleIds: ["wow"] } as never);
    await housekeeping.handleWelcomeRoleButton(interaction as never);
    expect(editReply.mock.calls[0]?.[0].content).toContain("isn't offered anymore");
    expect(reply).not.toHaveBeenCalled();
    void handleWelcomeRoleButton;
  });

  // Owner report, 7 November 2026: members who picked World of Warcraft did not see the WoW channels. The button
  // answered only after several Discord and database calls, so slow clicks expired (10062, "This interaction failed")
  // after the role was given; a second click then toggled the role back off.
  it("acknowledges the click before any slow call, then gives the game role once", async () => {
    vi.resetModules();
    const order: string[] = [];
    const add = vi.fn(async () => { order.push("add"); });
    const member = { id: "u1", roles: { cache: new Map<string, unknown>(), add, remove: vi.fn() } };
    const discordGuild = {
      id: "g1", name: "QG",
      roles: { cache: new Map([["wow", { id: "wow", name: "World of Warcraft" }]]), fetch: vi.fn(async () => { order.push("roles.fetch"); return { id: "wow", name: "World of Warcraft", managed: false, permissions: { bitfield: 0n } }; }) },
      members: { fetch: vi.fn(async () => { order.push("members.fetch"); return member; }) }
    };
    const editReply = vi.fn();
    const interaction = {
      customId: "welcomerole:g1:wow",
      user: { id: "u1" },
      reply: vi.fn(),
      deferReply: vi.fn(async () => { order.push("defer"); }),
      editReply,
      client: { guilds: { fetch: vi.fn(async () => { order.push("guilds.fetch"); return discordGuild; }) } }
    };
    const housekeeping = await import("../src/services/housekeeping.js");
    vi.spyOn(housekeeping.welcomeGuildService, "ensureGuild").mockImplementation(async () => { order.push("db"); return { id: "db-g1" } as never; });
    vi.spyOn(housekeeping.welcomeGuildService, "getSettings").mockResolvedValue({ welcomeRoleIds: ["wow"], rulesGate: false, rulesChannelId: null, language: "en" } as never);
    await housekeeping.handleWelcomeRoleButton(interaction as never);
    expect(order[0]).toBe("defer");
    expect(interaction.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.anything() }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(editReply.mock.calls.at(-1)?.[0].content).toContain("World of Warcraft");
  });
  // Same report: the pick must work even when the saved game-role list lost the WoW role or the database is slow.
  it("gives the server's World of Warcraft role even when the settings no longer list it or cannot be read", async () => {
    for (const settingsFail of [false, true]) {
      vi.resetModules();
      const add = vi.fn();
      const member = { id: "u1", roles: { cache: new Map<string, unknown>(), add, remove: vi.fn() } };
      const wow = { id: "wow", name: "World of Warcraft", managed: false, permissions: { bitfield: 0n } };
      const discordGuild = { id: "g1", name: "QG", roles: { cache: new Map([["wow", wow], ["poe", { id: "poe", name: "Path of Exile 2", managed: false, permissions: { bitfield: 0n } }]]), fetch: vi.fn(async () => wow) }, members: { fetch: vi.fn(async () => member) } };
      const editReply = vi.fn();
      const interaction = { customId: "welcomerole:g1:wow", user: { id: "u1" }, reply: vi.fn(), deferReply: vi.fn(), editReply, client: { guilds: { fetch: vi.fn(async () => discordGuild) } } };
      const housekeeping = await import("../src/services/housekeeping.js");
      if (settingsFail) vi.spyOn(housekeeping.welcomeGuildService, "ensureGuild").mockRejectedValue(new Error("P2028"));
      else vi.spyOn(housekeeping.welcomeGuildService, "ensureGuild").mockResolvedValue({ id: "db-g1" } as never);
      vi.spyOn(housekeeping.welcomeGuildService, "getSettings").mockResolvedValue({ welcomeRoleIds: ["poe"], inviteWowRoleId: null, rulesGate: false, rulesChannelId: null } as never);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await housekeeping.handleWelcomeRoleButton(interaction as never);
      expect(add).toHaveBeenCalledTimes(1);
      expect(editReply.mock.calls.at(-1)?.[0].content).toContain("World of Warcraft");
    }
  });

  it("never offers a role with dangerous permissions, even one named World of Warcraft", async () => {
    const { welcomeRoleOffered } = await import("../src/services/housekeeping.js");
    const guild = { id: "g1", roles: { cache: new Map([["wow", { id: "wow", name: "World of Warcraft" }]]) } };
    expect(welcomeRoleOffered(null, guild, { id: "wow", name: "World of Warcraft", managed: false, permissions: { bitfield: 0n } })).toBe(true);
    expect(welcomeRoleOffered(null, guild, { id: "wow", name: "World of Warcraft", managed: false, permissions: { bitfield: 8n } })).toBe(false);
    expect(welcomeRoleOffered({ welcomeRoleIds: [], inviteWowRoleId: null }, guild, { id: "other", name: "Other", managed: false, permissions: { bitfield: 0n } })).toBe(false);
  });
});
