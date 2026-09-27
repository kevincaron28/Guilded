import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { notify } from "../services/notify.js";
import { errorReportService } from "./context.js";

export const bugCommand = new SlashCommandBuilder()
  .setName("bug")
  .setDescription("Report a bug or problem with the bot.")
  .addStringOption((o) => o.setName("description").setDescription("What went wrong? Include the command you used and what you expected.").setRequired(true).setMaxLength(1000))
  .addAttachmentOption((o) => o.setName("screenshot").setDescription("Optional screenshot"));

export async function executeBug(interaction: ChatInputCommandInteraction): Promise<void> {
  const description = interaction.options.getString("description", true);
  const screenshot = interaction.options.getAttachment("screenshot");
  await errorReportService.report(interaction.client, description, {
    source: "bug-report",
    guildId: interaction.guildId,
    guildName: interaction.guild?.name,
    userId: interaction.user.id,
    extra: screenshot?.url ?? null
  });
  if (interaction.guild) {
    await notify(interaction.guild, `🐞 Bug report from <@${interaction.user.id}>: ${description}${screenshot ? `\n${screenshot.url}` : ""}`, "officer");
  }
  await interaction.reply({ content: "Thanks, that's been reported. An officer or the developer will follow up.", ephemeral: true });
}
