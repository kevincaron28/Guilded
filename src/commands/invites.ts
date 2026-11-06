import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { asLang } from "../i18n.js";
import { formatInviteList, markInvitedByName, pendingInvites } from "../services/invite-queue.js";
import { markPostsDone } from "../services/invite-channel.js";
import { markGuildChanged } from "../services/standings-feed.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /mod invites (/officer is at Discord's size limit). Private replies. The invite itself is the officer's click in game (the addon's To invite panel).

export const invitesCommand = new SlashCommandBuilder()
  .setName("invites")
  .setDescription("Guild invite queue.")
  .addSubcommand((sub) => sub.setName("list").setDescription("Who is waiting."))
  .addSubcommand((sub) => sub.setName("done").setDescription("Mark a name invited.")
    .addStringOption((o) => o.setName("name").setDescription("First Last").setRequired(true).setMaxLength(60)))
  .addSubcommand((sub) => sub.setName("settings").setDescription("Queue and DM switches.")
    .addBooleanOption((o) => o.setName("queue").setDescription("Queue on or off"))
    .addBooleanOption((o) => o.setName("dm").setDescription("Role DM on or off"))
    .addRoleOption((o) => o.setName("role").setDescription("The WoW role")));

export async function executeInvites(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer") || !interaction.guild) { await reply("Only officers can use the invite queue."); return; }
  const guildId = context.guildId;
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const rows = await pendingInvites(prisma, guildId);
    const where = settings?.inviteChannelId ? `\nPosts go in <#${settings.inviteChannelId}>. In game: \`/guilded invites\`.` : "\nNo invite channel yet: press Create missing channels in `/setup`.";
    await reply(formatInviteList(rows, interaction.guild.id) + where);
    return;
  }
  if (sub === "done") {
    const rows = await markInvitedByName(prisma, guildId, [interaction.options.getString("name", true)], interaction.user.id);
    if (rows.length) markGuildChanged(guildId);
    await markPostsDone(interaction.client, rows);
    await reply(rows.length ? `Marked **${rows[0]!.displayName}** as invited (${rows.length} post${rows.length > 1 ? "s" : ""}).` : "Nobody waiting under that name.");
    return;
  }
  const o = interaction.options;
  const data = {
    ...(o.getBoolean("queue") !== null ? { inviteQueueEnabled: o.getBoolean("queue")! } : {}),
    ...(o.getBoolean("dm") !== null ? { inviteDmEnabled: o.getBoolean("dm")! } : {}),
    ...(o.getRole("role") ? { inviteWowRoleId: o.getRole("role")!.id } : {})
  };
  if (Object.keys(data).length) await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
  const merged = { ...settings, ...data };
  const on = (value: boolean | undefined) => value === false ? "**off**" : "**on**";
  await reply(`Invite queue: ${on(merged.inviteQueueEnabled)}${merged.inviteChannelId ? ` in <#${merged.inviteChannelId}>` : " (no channel yet)"}. WoW-role DM: ${on(merged.inviteDmEnabled)}, role: ${merged.inviteWowRoleId ? `<@&${merged.inviteWowRoleId}>` : 'the one named like "World of Warcraft"'}. ${lang === "fr" ? "Langue : français." : ""}`.trim());
}
