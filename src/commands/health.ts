import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { BRAND } from "../brand.js";

export const healthCommand = new SlashCommandBuilder()
  .setName("health")
  .setDescription(`Check whether ${BRAND.botName} is online.`);

export async function executeHealth(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: `${BRAND.emoji} ${BRAND.botName} is online.`, flags: MessageFlags.Ephemeral });
}
