import { AttachmentBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { formatHealth, guildHealth } from "../services/guild-health.js";
import { loadRosterVisual, rosterVisualCard } from "../services/roster-visual.js";
import { scoreCardPng } from "../services/score-card.js";
import { asLang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";

export const guildHealthCommand = new SlashCommandBuilder()
  .setName("guildhealth")
  .setDescription("Officers: class/race/level mix, member retention (30/60/90 days) and what needs attention.");

export async function executeGuildHealth(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can see the guild health report.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const health = await guildHealth(prisma, context.guildId);
  // The roster picture (classes by level band, profession grid); the text above stays the full report.
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  const png = await loadRosterVisual(prisma, context.guildId).then(visual => scoreCardPng(rosterVisualCard(visual, lang, interaction.guild?.name ?? "Guilded"))).catch(() => null);
  await interaction.editReply({ content: formatHealth(health).slice(0, 1990), files: png ? [new AttachmentBuilder(png, { name: "roster.png" })] : [], allowedMentions: { parse: [] } });
}
