import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { formatHealth, guildHealth } from "../services/guild-health.js";
import { requireGuildContext } from "./context.js";

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
  const health = await guildHealth(prisma, context.guildId);
  await interaction.reply({ content: formatHealth(health).slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
