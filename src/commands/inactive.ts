import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { findInactive, formatInactive } from "../services/inactive.js";
import { requireGuildContext } from "./context.js";

export const inactiveCommand = new SlashCommandBuilder()
  .setName("inactive")
  .setDescription("Officers: members not seen in game for a while (a report only, nobody is changed).")
  .addIntegerOption((o) => o.setName("days").setDescription("How many days without a sighting (default 30)").setMinValue(7).setMaxValue(365));

export async function executeInactive(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can see the inactivity report.", flags: MessageFlags.Ephemeral });
    return;
  }
  const days = interaction.options.getInteger("days") ?? 30;
  const rows = await findInactive(prisma, context.guildId, days);
  await interaction.reply({ content: formatInactive(rows, days).slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
