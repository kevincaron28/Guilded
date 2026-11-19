import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { formatPromotionPlan, formatVoiceDuration, isAltRank, loadPromotionPlan, ruleFrom } from "../services/promotion.js";
import { PROMOTION_STATUS_BUTTON, promotionAnnouncement, promotionProgressFor } from "../services/promotion-status.js";
import { asLang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /officer promotion. Private replies. It only reads and lists: the promotion is the officer's click in game.

export const promotionCommand = new SlashCommandBuilder()
  .setName("promotion")
  .setDescription("Who is ready to promote.")
  .addSubcommand((sub) => sub.setName("list").setDescription("Who is ready."))
  .addSubcommand((sub) => sub.setName("rule").setDescription("Show or change the rule.")
    .addBooleanOption((o) => o.setName("on").setDescription("Panel on or off"))
    .addStringOption((o) => o.setName("rank").setDescription("Rank to promote").setMaxLength(40))
    .addIntegerOption((o) => o.setName("days").setDescription("Days at that rank").setMinValue(0).setMaxValue(365))
    .addIntegerOption((o) => o.setName("level").setDescription("Minimum level, 0 = none").setMinValue(0).setMaxValue(100))
    .addBooleanOption((o) => o.setName("link").setDescription("Link needed"))
    .addIntegerOption((o) => o.setName("voice").setDescription("Voice min per 7 days").setMinValue(0).setMaxValue(2000))
    .addBooleanOption((o) => o.setName("weekly").setDescription("Weekly list on or off"))
    .addChannelOption((o) => o.setName("channel").setDescription("Weekly list channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

export async function executePromotion(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer") || !interaction.guild) { await reply("Only officers can use the promotion panel."); return; }
  const guildId = context.guildId;
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;

  if (interaction.options.getSubcommand() === "list") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const { plan, rule } = await loadPromotionPlan(prisma, interaction.guild, guildId, guild.gameEdition ?? "forever");
    await interaction.editReply({ content: rule.enabled ? formatPromotionPlan(plan, rule, lang) : t("The promotion panel is off. Turn it on with `/officer promotion rule on:true`.", "Le panneau de promotion est désactivé. Active-le avec `/officer promotion rule on:true`."), allowedMentions: { parse: [] } });
    return;
  }

  const o = interaction.options;
  if (isAltRank(o.getString("rank"))) {
    await reply(t("Alts are never promoted automatically: choose a rank other than an Alt rank.", "Les alts ne sont jamais promus automatiquement : choisis un rang qui n'est pas un rang d'alt."));
    return;
  }
  const data = {
    ...(o.getBoolean("on") !== null ? { promotionEnabled: o.getBoolean("on")! } : {}),
    ...(o.getString("rank") ? { promotionFromRank: o.getString("rank")!.trim() } : {}),
    ...(o.getInteger("days") !== null ? { promotionMinDays: o.getInteger("days")! } : {}),
    ...(o.getInteger("level") !== null ? { promotionMinLevel: o.getInteger("level")! || null } : {}),
    ...(o.getBoolean("link") !== null ? { promotionRequireLink: o.getBoolean("link")! } : {}),
    ...(o.getInteger("voice") !== null ? { promotionMinVoiceMinutes: o.getInteger("voice")! } : {}),
    ...(o.getBoolean("weekly") !== null ? { promotionWeeklyEnabled: o.getBoolean("weekly")! } : {}),
    ...(o.getChannel("channel") ? { promotionChannelId: o.getChannel("channel")!.id } : {})
  };
  if (Object.keys(data).length) await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
  const rule = ruleFrom({ ...settings, ...data });
  const weekly = (data.promotionWeeklyEnabled ?? settings?.promotionWeeklyEnabled) !== false;
  const where = data.promotionChannelId ?? settings?.promotionChannelId ?? settings?.logChannelId;
  await reply(`${rule.enabled ? t("Promotion panel: **on**.", "Panneau de promotion : **actif**.") : t("Promotion panel: **off**.", "Panneau de promotion : **désactivé**.")} ${t(`Rank **${rule.fromRank}**, ${rule.minDays}+ days${rule.minLevel ? `, level ${rule.minLevel}+` : ""}${rule.requireLink ? ", linked" : ""}${rule.minVoiceMinutes ? `, ${formatVoiceDuration(rule.minVoiceMinutes)} in voice (7 days, solo counts)` : ""}.`, `Rang **${rule.fromRank}**, ${rule.minDays}+ jours${rule.minLevel ? `, niveau ${rule.minLevel}+` : ""}${rule.requireLink ? ", lié" : ""}${rule.minVoiceMinutes ? `, ${formatVoiceDuration(rule.minVoiceMinutes)} en vocal (7 jours, seul compte)` : ""}.`)} ${weekly && where ? t(`Weekly list in <#${where}> when someone is ready.`, `Liste hebdomadaire dans <#${where}> quand quelqu'un est prêt.`) : weekly ? t("Weekly list: no channel yet (set `channel:` or the log channel).", "Liste hebdomadaire : aucun salon (indique `channel:` ou le salon de journal).") : t("Weekly list: off.", "Liste hebdomadaire : désactivée.")}`);
}

// `/promotion status` (every member): the member's own progress, private.
export const promotionStatusCommand = new SlashCommandBuilder()
  .setName("promotion")
  .setDescription("See what you still need to be promoted.")
  .addSubcommand((sub) => sub.setName("status").setDescription("Your progress toward the next rank (private)."))
  .addSubcommand((sub) => sub.setName("post").setDescription("Post the how-to-get-promoted announcement with a Where am I button.")
    .addChannelOption((o) => o.setName("channel").setDescription("Where to post").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName("title").setDescription("Own title (optional)").setMaxLength(120))
    .addStringOption((o) => o.setName("intro").setDescription("Own opening text (optional)").setMaxLength(900))
    .addStringOption((o) => o.setName("note").setDescription("Own closing line (optional)").setMaxLength(500)));

async function showProgress(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guildId!, interaction.guild!.name);
  const { text } = await promotionProgressFor(prisma, context.guildId, interaction.user.id, guild.gameEdition ?? "forever");
  await interaction.editReply({ content: text.slice(0, 1990), allowedMentions: { parse: [] } });
}
export async function executePromotionStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.options.getSubcommand() === "status") { await showProgress(interaction); return; }
  // post: officers only (the announcement with a Where am I? button).
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer") || !interaction.guild) { await interaction.reply({ content: "Only officers can post the announcement.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await guildService.getSettings(context.guildId);
  const lang = asLang(settings?.language);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const channel = interaction.options.getChannel("channel", true);
  const target = await interaction.guild.channels.fetch(channel.id).catch(() => null);
  if (!target?.isTextBased() || !("send" in target)) { await interaction.editReply(t("I can't post in that channel.", "Je ne peux pas écrire dans ce salon.")); return; }
  const embed = promotionAnnouncement(ruleFrom(settings), lang, { title: interaction.options.getString("title"), intro: interaction.options.getString("intro"), note: interaction.options.getString("note"), inviteChannelId: settings?.inviteChannelId ?? null });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(PROMOTION_STATUS_BUTTON).setStyle(ButtonStyle.Primary).setLabel(t("Where am I?", "Où j'en suis ?")));
  await target.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  await interaction.editReply(t(`Posted in <#${channel.id}>.`, `Publié dans <#${channel.id}>.`));
}
/** The "Where am I?" button under the announcement; the id is fixed so it keeps working after a restart. */
export const handlePromotionButton = (interaction: ButtonInteraction) => showProgress(interaction);
