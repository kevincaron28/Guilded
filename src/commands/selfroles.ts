import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";
import { hasPermission } from "../permissions.js";
import { selfRoleProblem } from "../services/selfrole.js";
import { guildService } from "./context.js";
import { asLang, type Lang } from "../i18n.js";

export const SELF_ROLE_PREFIX = "selfrole:";

const COPY = {
  en: {
    officers: "Only Officers, Guild Masters, or administrators can create role panels.",
    toggle: "Press a button to add or remove that role.",
    requires: "Required role:",
    invalid: "That role panel is invalid. Ask an officer to replace it.",
    missing: "That role no longer exists.",
    unsafe: "That role has moderation/management permissions, so it cannot be self-assigned.",
    hierarchy: "I cannot assign that role - it is above my own role. Ask an officer to move my role higher.",
    member: "You are no longer a member of this server.",
    prerequisite: "You need this role first:",
    added: "Added",
    removed: "Removed"
  },
  fr: {
    officers: "Seuls les officiers, maîtres de guilde et administrateurs peuvent créer ces panneaux.",
    toggle: "Cliquez sur un bouton pour ajouter ou retirer le rôle.",
    requires: "Rôle préalable :",
    invalid: "Ce panneau de rôles est invalide. Demandez à un officier de le remplacer.",
    missing: "Ce rôle n'existe plus.",
    unsafe: "Ce rôle possède des permissions de gestion ou de modération et ne peut pas être attribué librement.",
    hierarchy: "Je ne peux pas attribuer ce rôle : il est au-dessus du mien. Un officier doit déplacer mon rôle plus haut.",
    member: "Vous ne faites plus partie de ce serveur.",
    prerequisite: "Vous devez d'abord avoir ce rôle :",
    added: "Rôle ajouté :",
    removed: "Rôle retiré :"
  }
} satisfies Record<Lang, Record<string, string>>;

async function panelLanguage(guild: { id: string; name: string }): Promise<Lang> {
  const record = await guildService.ensureGuild(guild.id, guild.name);
  return asLang((await guildService.getSettings(record.id))?.language);
}

export const selfRolesCommand = new SlashCommandBuilder()
  .setName("selfroles")
  .setDescription("Post role buttons (officers only).")
  .addStringOption((o) => o.setName("title").setDescription("Panel heading").setRequired(true).setMaxLength(200))
  .addRoleOption((o) => o.setName("role1").setDescription("First role").setRequired(true))
  .addRoleOption((o) => o.setName("role2").setDescription("Second role"))
  .addRoleOption((o) => o.setName("role3").setDescription("Third role"))
  .addRoleOption((o) => o.setName("role4").setDescription("Fourth role"))
  .addRoleOption((o) => o.setName("role5").setDescription("Fifth role"))
  .addRoleOption((o) => o.setName("requires").setDescription("Required role"));

export async function executeSelfRoles(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: COPY.en.officers, ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const roles = ["role1", "role2", "role3", "role4", "role5"]
    .map((name) => interaction.options.getRole(name))
    .filter((role): role is NonNullable<typeof role> => role !== null);
  const required = interaction.options.getRole("requires");
  const lang = await panelLanguage(guild);
  const copy = COPY[lang];

  for (const role of roles) {
    const permissions = typeof role.permissions === "string" ? BigInt(role.permissions) : role.permissions.bitfield;
    const problem = selfRoleProblem({ id: role.id, managed: role.managed, permissions }, guild.id);
    if (problem) throw new Error(`${role.name}: ${copy.unsafe}`);
    if (role.id === required?.id) throw new Error(copy.invalid);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    roles.map((role) => new ButtonBuilder()
      .setCustomId(`${SELF_ROLE_PREFIX}${role.id}${required ? `:${required.id}` : ""}`)
      .setLabel(role.name.slice(0, 80))
      .setStyle(ButtonStyle.Secondary))
  );
  await interaction.reply({
    content: `**${interaction.options.getString("title", true)}**\n${copy.toggle}${required ? `\n${copy.requires} <@&${required.id}>` : ""}`,
    components: [row],
    allowedMentions: { parse: [] }
  });
}

export async function handleSelfRoleButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  await interaction.deferReply({ ephemeral: true });
  const copy = COPY[await panelLanguage(guild)];
  const parts = interaction.customId.slice(SELF_ROLE_PREFIX.length).split(":");
  const [roleId, requiredRoleId] = parts;
  if (!roleId || parts.length > 2 || (parts.length === 2 && !requiredRoleId) || roleId === requiredRoleId) {
    await interaction.editReply({ content: copy.invalid });
    return;
  }
  // Fetch rather than trust the interaction/cache: roles or permissions can change after posting.
  const role = await guild.roles.fetch(roleId, { force: true });
  if (!role) {
    await interaction.editReply({ content: copy.missing });
    return;
  }
  if (selfRoleProblem({ id: role.id, managed: role.managed, permissions: role.permissions.bitfield }, guild.id)) {
    await interaction.editReply({ content: copy.unsafe });
    return;
  }
  const me = await guild.members.fetchMe({ force: true });
  if (me.roles.highest.position <= role.position) {
    await interaction.editReply({ content: copy.hierarchy });
    return;
  }
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: copy.member });
    return;
  }
  if (requiredRoleId && !member.roles.cache.has(requiredRoleId)) {
    await interaction.editReply({ content: `${copy.prerequisite} <@&${requiredRoleId}>`, allowedMentions: { parse: [] } });
    return;
  }
  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role.id);
    await interaction.editReply({ content: `${copy.removed} **${role.name}**.`, allowedMentions: { parse: [] } });
  } else {
    await member.roles.add(role.id);
    await interaction.editReply({ content: `${copy.added} **${role.name}**.`, allowedMentions: { parse: [] } });
  }
}
