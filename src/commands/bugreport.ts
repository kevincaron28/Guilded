import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
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
  const ref = await errorReportService.report(interaction.client, description, {
    source: "bug-report",
    guildId: interaction.guildId,
    guildName: interaction.guild?.name,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    operation: "/report bug",
    extra: screenshot?.url ?? null
  });
  if (interaction.guild) {
    await notify(interaction.guild, `🐞 Bug report${ref ? ` \`${ref}\`` : ""} from <@${interaction.user.id}>: ${description}${screenshot ? `\n${screenshot.url}` : ""}`, "officer");
  }
  const fr = interaction.locale.startsWith("fr");
  const content = fr
    ? `Merci, c'est signalé au développeur${ref ? ` (référence \`${ref}\`)` : ""}. Un officier ou le développeur fera le suivi.`
    : `Thanks, the developer has your report${ref ? ` (reference \`${ref}\`)` : ""}. An officer or the developer will follow up.`;
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
