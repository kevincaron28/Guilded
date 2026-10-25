import { SlashCommandBuilder, MessageFlags, ChannelType, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { createGuildService } from "../services/guild.js";
import { provisionWowGuild } from "../services/wow-guilds.js";
import { interactionGuildScope, loadGuildScope, runInGuildScope } from "../services/guild-scope.js";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import { hasPermission } from "../permissions.js";

export const wowCommand = new SlashCommandBuilder().setName("wow").setDescription("Choose an in-game guild; several editions can share this Discord server.")
  .addSubcommand(s => s.setName("list").setDescription("List the in-game guilds and your current choice."))
  .addSubcommand(s => s.setName("add").setDescription("Admin: add an in-game guild with separate settings, raids and points.")
    .addStringOption(o => o.setName("edition").setDescription("WoW edition").setRequired(true).addChoices(...GAME_EDITIONS.map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("name").setDescription("In-game guild name").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("realm").setDescription("Realm (Forever for WoW Forever)").setRequired(true).setMaxLength(80))
    .addRoleOption(o => o.setName("officers").setDescription("Officer role for this in-game guild"))
    .addRoleOption(o => o.setName("members").setDescription("Member role; omit to allow all server members")))
  .addSubcommand(s => s.setName("use").setDescription("Select your in-game guild for commands and companion pairing.")
    .addStringOption(o => o.setName("guild").setDescription("Guild ID from /wow list, or default").setRequired(true)))
  .addSubcommand(s => s.setName("channel").setDescription("Officer: bind a channel to an in-game guild, overriding personal choices.")
    .addStringOption(o => o.setName("guild").setDescription("Guild ID from /wow list, or default").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("Channel for this guild").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildCategory)))
  .addSubcommand(s => s.setName("roles").setDescription("Admin: change the roles that can use and manage an in-game guild.")
    .addStringOption(o => o.setName("guild").setDescription("Guild ID from /wow list").setRequired(true))
    .addRoleOption(o => o.setName("officers").setDescription("Officer role").setRequired(true))
    .addRoleOption(o => o.setName("members").setDescription("Member role; omit to allow all server members")));

export async function executeWow(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) throw new Error("Use this command in your Discord server.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const root = await createGuildService(prisma).ensureGuild(interaction.guild.id, interaction.guild.name);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const sub = interaction.options.getSubcommand();
  if (sub === "list") {
    const choices = await prisma.wowGuild.findMany({ where: { guildId: root.id, scopeGuildId: { not: null } }, orderBy: { name: "asc" } });
    const selected = await prisma.wowGuildSelection.findUnique({ where: { discordId_userId: { discordId: root.discordId, userId: member.id } } });
    await interaction.editReply([`**In-game guilds** (channel bindings take precedence)`, `\`default\` — Forever · existing guild data`, ...choices.map(w => `\`${w.scopeGuildId}\` — ${w.name} · ${w.gameEdition} · ${w.realm}`), `Your default: \`${selected?.scopeGuildId ?? "default"}\`. Use /wow use, then /character pair for that guild.`].join("\n"));
    return;
  }
  if (sub === "add") {
    if (!member.permissions.has("Administrator")) throw new Error("A server administrator must add in-game guilds.");
    const space = await provisionWowGuild(prisma, root.id, { gameEdition: interaction.options.getString("edition", true), name: interaction.options.getString("name", true), realm: interaction.options.getString("realm", true) }, {
      ...(interaction.options.getRole("officers") ? { officer: interaction.options.getRole("officers")!.id } : {}),
      ...(interaction.options.getRole("members") ? { member: interaction.options.getRole("members")!.id } : {})
    });
    await interaction.editReply(`Created **${space.name} · ${space.gameEdition}**. ID: \`${space.scopeGuildId}\`. Use /wow use or /wow channel, then /setup start in that guild's channel.`);
    return;
  }
  const selected = interaction.options.getString("guild", true);
  const scope = await loadGuildScope(prisma, selected === "default" ? root.id : selected, root.discordId);
  if (scope.memberRoleId && !member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) throw new Error("You need this in-game guild's member role.");
  if (sub === "use") {
    await prisma.wowGuildSelection.upsert({ where: { discordId_userId: { discordId: root.discordId, userId: member.id } }, create: { discordId: root.discordId, userId: member.id, scopeGuildId: scope.guild.id }, update: { scopeGuildId: scope.guild.id } });
    await interaction.editReply(`Selected **${scope.guild.name} · ${scope.guild.gameEdition}**. Commands in a bound channel use that channel's guild.`);
  } else if (sub === "channel") {
    if (!runInGuildScope(scope, () => hasPermission(member, "officer"))) throw new Error("An officer of this in-game guild must bind its channels.");
    const channelId = interaction.options.getChannel("channel", true).id;
    const channel = await interaction.guild.channels.fetch(channelId);
    // An unbound setup/core channel still belongs to its configured guild.
    // Empty user ID suppresses personal defaults while resolving channel ownership.
    const previousScope = !member.permissions.has("Administrator") ? await interactionGuildScope(prisma, { discordId: root.discordId, channelId, parentId: channel?.parentId ?? null, userId: "" }) : null;
    if (previousScope && previousScope.guild.id !== scope.guild.id) {
      if (!runInGuildScope(previousScope, () => hasPermission(member, "officer"))) throw new Error("An officer of the channel's current guild must release or reassign this binding.");
    }
    await prisma.wowGuildChannel.upsert({ where: { discordId_channelId: { discordId: root.discordId, channelId } }, create: { discordId: root.discordId, channelId, scopeGuildId: scope.guild.id }, update: { scopeGuildId: scope.guild.id } });
    await interaction.editReply(`<#${channelId}> now uses **${scope.guild.name} · ${scope.guild.gameEdition}**.`);
  } else if (sub === "roles") {
    if (!member.permissions.has("Administrator")) throw new Error("A server administrator must change in-game guild roles.");
    if (scope.guild.scopeKey === "default") throw new Error("The existing Forever guild keeps its standard Guilded roles.");
    await prisma.wowGuild.update({ where: { scopeGuildId: scope.guild.id }, data: { permissionRoles: { ...scope.permissionRoles, officer: interaction.options.getRole("officers", true).id }, memberRoleId: interaction.options.getRole("members")?.id ?? null } });
    await interaction.editReply("In-game guild roles updated.");
  }
}
