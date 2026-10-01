import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";

vi.mock("../src/commands/context.js", () => ({ guildService: {
  ensureGuild: vi.fn().mockResolvedValue({ id: "record" }),
  getSettings: vi.fn().mockResolvedValue({ language: "fr" })
} }));
const { executeSelfRoles, handleSelfRoleButton } = await import("../src/commands/selfroles.js");
const { selfRoleProblem } = await import("../src/services/selfrole.js");

function fixture(ids: string[] = ["exile"]) {
  const member = { roles: { cache: new Set(ids), add: vi.fn(), remove: vi.fn() } };
  const role = { id: "errant", name: "Errant", managed: false, position: 2, permissions: { bitfield: PermissionFlagsBits.SendMessages } };
  const guild = {
    id: "guild", name: "Québec Gold",
    roles: { fetch: vi.fn().mockResolvedValue(role) },
    members: { fetch: vi.fn().mockResolvedValue(member), fetchMe: vi.fn().mockResolvedValue({ roles: { highest: { position: 3 } } }) }
  };
  const interaction = { guild, customId: "selfrole:errant:exile", user: { id: "player" },
    member: { roles: { cache: new Set(["exile", "errant"]) } },
    deferReply: vi.fn(), editReply: vi.fn() };
  return { interaction, member, guild, role };
}

describe("self-role panels with prerequisites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds the role using fresh membership rather than stale interaction roles", async () => {
    const { interaction, member, guild } = fixture();
    await handleSelfRoleButton(interaction as never);
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: "player", force: true });
    expect(guild.roles.fetch).toHaveBeenCalledWith("errant", { force: true });
    expect(member.roles.add).toHaveBeenCalledWith("errant");
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: "Rôle ajouté : **Errant**." }));
  });

  it("blocks a member whose prerequisite was removed even if the interaction still has it", async () => {
    const { interaction, member } = fixture([]);
    await handleSelfRoleButton(interaction as never);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: "Vous devez d'abord avoir ce rôle : <@&exile>" }));
  });

  it("lets an eligible member remove their existing role", async () => {
    const { interaction, member } = fixture(["exile", "errant"]);
    await handleSelfRoleButton(interaction as never);
    expect(member.roles.remove).toHaveBeenCalledWith("errant");
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it("preserves old panels without a prerequisite", async () => {
    const { interaction, member } = fixture([]);
    interaction.customId = "selfrole:errant";
    await handleSelfRoleButton(interaction as never);
    expect(member.roles.add).toHaveBeenCalledWith("errant");
  });

  it.each([PermissionFlagsBits.MentionEveryone, PermissionFlagsBits.ManageGuildExpressions])("blocks dangerous permissions added after posting (%s)", async (permission) => {
    const { interaction, member, role } = fixture();
    role.permissions.bitfield |= permission;
    await handleSelfRoleButton(interaction as never);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("permissions de gestion") }));
    expect(selfRoleProblem({ ...role, permissions: role.permissions.bitfield }, "guild")).not.toBeNull();
  });

  it("refuses a role above the bot", async () => {
    const { interaction, member, role } = fixture();
    role.position = 3;
    await handleSelfRoleButton(interaction as never);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("au-dessus") }));
  });

  it("refuses a deleted role and a departed member", async () => {
    const first = fixture();
    first.guild.roles.fetch.mockResolvedValue(null as never);
    await handleSelfRoleButton(first.interaction as never);
    expect(first.member.roles.add).not.toHaveBeenCalled();
    const second = fixture();
    second.guild.members.fetch.mockRejectedValue(new Error("Unknown member"));
    await handleSelfRoleButton(second.interaction as never);
    expect(second.member.roles.add).not.toHaveBeenCalled();
    expect(second.interaction.editReply).toHaveBeenCalledWith({ content: "Vous ne faites plus partie de ce serveur." });
  });

  it.each(["selfrole:errant:", "selfrole:errant:exile:extra", "selfrole:errant:errant", "selfrole:"])("fails closed for malformed panels (%s)", async (id) => {
    const { interaction, member, guild } = fixture();
    interaction.customId = id;
    await handleSelfRoleButton(interaction as never);
    expect(guild.roles.fetch).not.toHaveBeenCalled();
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it("encodes the prerequisite when officers publish a panel without pinging it", async () => {
    const { guild, role } = fixture();
    const interaction = {
      guild, member: { permissions: { has: () => true } }, reply: vi.fn(),
      options: { getString: () => "J'accepte les règles", getRole: (name: string) => name === "role1" ? role : name === "requires" ? { id: "exile" } : null }
    };
    await executeSelfRoles(interaction as never);
    const response = interaction.reply.mock.calls[0]![0];
    expect(response.components[0].toJSON().components[0].custom_id).toBe("selfrole:errant:exile");
    expect(response.content).toContain("Rôle préalable : <@&exile>");
    expect(response.allowedMentions).toEqual({ parse: [] });
  });
});
