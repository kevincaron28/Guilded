import { ChannelType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { formatPromotionPlan, loadPromotionPlan, ruleFrom } from "../services/promotion.js";
import { asLang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /officer promotion. Private replies. It only reads and lists: the promotion is the officer's click in game.

export const promotionCommand = new SlashCommandBuilder()
  .setName("promotion")
  .setDescription("Who is ready to promote.")
  .addSubcommand((sub) => sub.setName("list").setDescription("Ready and not in Discord yet."))
  .addSubcommand((sub) => sub.setName("rule").setDescription("Show or change the rule.")
    .addBooleanOption((o) => o.setName("on").setDescription("Panel on or off"))
    .addStringOption((o) => o.setName("rank").setDescription("Rank to promote (Initiate)").setMaxLength(40))
    .addIntegerOption((o) => o.setName("days").setDescription("Days at that rank (7)").setMinValue(0).setMaxValue(365))
    .addIntegerOption((o) => o.setName("level").setDescription("Minimum level, 0 = none").setMinValue(0).setMaxValue(100))
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
  const data = {
    ...(o.getBoolean("on") !== null ? { promotionEnabled: o.getBoolean("on")! } : {}),
    ...(o.getString("rank") ? { promotionFromRank: o.getString("rank")!.trim() } : {}),
    ...(o.getInteger("days") !== null ? { promotionMinDays: o.getInteger("days")! } : {}),
    ...(o.getInteger("level") !== null ? { promotionMinLevel: o.getInteger("level")! || null } : {}),
    ...(o.getBoolean("weekly") !== null ? { promotionWeeklyEnabled: o.getBoolean("weekly")! } : {}),
    ...(o.getChannel("channel") ? { promotionChannelId: o.getChannel("channel")!.id } : {})
  };
  if (Object.keys(data).length) await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
  const rule = ruleFrom({ ...settings, ...data });
  const weekly = (data.promotionWeeklyEnabled ?? settings?.promotionWeeklyEnabled) !== false;
  const where = data.promotionChannelId ?? settings?.promotionChannelId ?? settings?.logChannelId;
  await reply(`${rule.enabled ? t("Promotion panel: **on**.", "Panneau de promotion : **actif**.") : t("Promotion panel: **off**.", "Panneau de promotion : **désactivé**.")} ${t(`Rank **${rule.fromRank}**, ${rule.minDays}+ days${rule.minLevel ? `, level ${rule.minLevel}+` : ""}.`, `Rang **${rule.fromRank}**, ${rule.minDays}+ jours${rule.minLevel ? `, niveau ${rule.minLevel}+` : ""}.`)} ${weekly && where ? t(`Weekly list in <#${where}> when someone is ready.`, `Liste hebdomadaire dans <#${where}> quand quelqu'un est prêt.`) : weekly ? t("Weekly list: no channel yet (set `channel:` or the log channel).", "Liste hebdomadaire : aucun salon (indique `channel:` ou le salon de journal).") : t("Weekly list: off.", "Liste hebdomadaire : désactivée.")}`);
}
