import { guildWhere } from "../services/guild-scope.js";
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hostedPilot } from "../hosted-pilot.js";
import { hasPermission } from "../permissions.js";
import { channelSpec } from "../setup-names.js";
import { discordInvite, publicRaids } from "../services/public-raids.js";
import { pugBoardPayload, refreshPugBoard } from "../services/pug-board.js";
import { serializeRaidPosts } from "../services/raid-signup-posts.js";

export const pugCommand = new SlashCommandBuilder().setName("pug").setDescription("Find or share open raid spots.")
  .addSubcommand(sub => sub.setName("browse").setDescription("See other guilds' open raids."))
  .addSubcommand(sub => sub.setName("share").setDescription("Officers: share or hide one raid publicly.")
    .addStringOption(o => o.setName("raid").setDescription("Raid").setAutocomplete(true).setRequired(true))
    .addBooleanOption(o => o.setName("open").setDescription("Share publicly").setRequired(true))
    .addStringOption(o => o.setName("realm").setDescription("Realm (required to share)").setMaxLength(40))
    .addStringOption(o => o.setName("faction").setDescription("Faction").addChoices({ name: "Alliance", value: "ALLIANCE" }, { name: "Horde", value: "HORDE" }))
    .addStringOption(o => o.setName("language").setDescription("Language").addChoices({ name: "English", value: "en" }, { name: "Français", value: "fr" }, { name: "Both", value: "both" }))
    .addStringOption(o => o.setName("invite").setDescription("Host Discord invite").setMaxLength(150)))
  .addSubcommand(sub => sub.setName("board").setDescription("Officers: enable a channel for other guilds' raids.")
    .addBooleanOption(o => o.setName("enabled").setDescription("Show the board").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("Existing channel, or create one").addChannelTypes(ChannelType.GuildText)));

export async function executePug(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !hostedPilot.allows(interaction.guild.id)) throw new Error("An approved Guilded server is required.");
  const sub = interaction.options.getSubcommand();
  if (sub !== "browse" && !hasPermission(interaction.member as GuildMember, "officer")) throw new Error("Only officers and server administrators can manage public recruitment.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await prisma.guild.findUnique({ where: guildWhere(interaction.guild.id), include: { settings: true } });
  if (!guild?.settings) throw new Error("Run /setup start first.");
  const lang = guild.settings.language === "fr" ? "fr" : "en";
  if (sub === "browse") {
    const raids = (await publicRaids(prisma, hostedPilot.allows)).filter(raid => raid.guildDiscordId !== interaction.guildId);
    await interaction.editReply(pugBoardPayload(raids, lang));
    return;
  }
  if (sub === "share") {
    const id = interaction.options.getString("raid", true);
    const raid = await prisma.raid.findFirst({ where: { id, guildId: guild.id } });
    if (!raid) throw new Error("Raid not found in this server.");
    const open = interaction.options.getBoolean("open", true);
    const realm = interaction.options.getString("realm")?.trim() || raid.pugRealm;
    const faction = interaction.options.getString("faction") || raid.pugFaction;
    const language = interaction.options.getString("language") || raid.pugLanguage;
    const invite = interaction.options.getString("invite") || raid.pugInviteUrl;
    if (open) {
      if (raid.isTest || raid.status !== "PLANNED" || raid.scheduledAt <= new Date()) throw new Error("Only upcoming, planned, non-test raids can be shared.");
      if (!raid.signupChannelId || !raid.signupMessageId) throw new Error("Post the raid's Discord signup first.");
      if (!realm || !faction || !language || !invite || !discordInvite(invite)) throw new Error("Provide realm, faction, language and a https://discord.gg/… or https://discord.com/invite/… host invite.");
      if (![raid.tankLimit, raid.healerLimit, raid.dpsLimit].some(n => n !== null && n > 0)) throw new Error("Set role limits with /lead edit first so open spots can be counted.");
    }
    await prisma.raid.updateMany({ where: { id, guildId: guild.id }, data: {
      publicPug: open, ...(open ? { pugRealm: realm, pugFaction: faction, pugLanguage: language, pugInviteUrl: invite!.trim() } : {})
    } });
    await interaction.editReply({ content: open
      ? "This raid is shared on the website, other guilds' boards and companion snapshots. Vacancies follow confirmed signups; full raids are hidden. Ensure guests can see the host signup channel. Only this occurrence is shared.\nhttps://guilded.kcaron.top/recruitment/?kind=raids"
      : "This raid is no longer shared. Discord boards refresh within a minute; downloaded addon snapshots expire after 10 minutes.", allowedMentions: { parse: [] } });
    return;
  }
  const enabled = interaction.options.getBoolean("enabled", true);
  await serializeRaidPosts(`pug:${interaction.guild.id}`, async () => {
    const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: guild.id } });
    let channelId = interaction.options.getChannel("channel")?.id ?? settings.pugChannelId;
    // Clear the previous board when disabling or moving it. Permission failures leave the old
    // configuration intact so it can be retried instead of silently abandoning a stale advert.
    if ((!enabled || channelId !== settings.pugChannelId) && settings.pugChannelId && settings.pugMessageId) {
      const channel = await interaction.guild!.channels.fetch(settings.pugChannelId);
      if (channel?.isTextBased()) {
        await channel.messages.delete(settings.pugMessageId).catch((error: unknown) => {
          if (error && typeof error === "object" && "code" in error && error.code === 10008) return;
          throw error;
        });
      }
    }
    if (enabled && !channelId) {
      const spec = channelSpec("pugChannelId", lang);
      const channel = await interaction.guild!.channels.create({
        name: spec.name, topic: spec.topic, type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild!.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
          { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] }
        ]
      });
      channelId = channel.id;
    }
    await prisma.guildSettings.update({ where: { guildId: guild.id }, data: {
      pugChannelId: enabled ? channelId : null,
      pugMessageId: enabled && channelId === settings.pugChannelId ? settings.pugMessageId : null
    } });
  });
  if (enabled) await refreshPugBoard(interaction.guild, prisma, hostedPilot.allows);
  await interaction.editReply(enabled ? "Open-raid board enabled. It refreshes every minute." : "Open-raid board disabled. The channel was kept.");
}
