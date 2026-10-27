import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags, escapeMarkdown } from "discord.js";
import { errorReportService } from "./context.js";
import { redactDiagnosticText } from "../services/diagnostic-privacy.js";

export const bugCommand = new SlashCommandBuilder()
  .setName("bug")
  .setDescription("Preview and send a private bug report to the developer.")
  .addStringOption(o => o.setName("description").setDescription("Describe the problem without private chat, credentials or personal information.").setRequired(true).setMaxLength(1000));

export async function executeBug(interaction: ChatInputCommandInteraction): Promise<void> {
  const fr = interaction.locale.startsWith("fr");
  const description = redactDiagnosticText(interaction.options.getString("description", true), 1000);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const destination = await errorReportService.destination(interaction.client);
  const sendId = `bugconfirm:${interaction.id}:send`, cancelId = `bugconfirm:${interaction.id}:cancel`;
  const intro = fr
    ? "**Aperçu privé — rien n’a été envoyé.**\nDestinataire : boîte privée du développeur Guilded. Inclut votre identifiant Discord, le serveur, le salon et la version du bot. Aucune pièce jointe ni conversation n’est collectée. Vérifiez le texte et retirez toute information privée avant de confirmer."
    : "**Private preview — nothing has been sent.**\nDestination: Guilded developer’s private report inbox. Includes your Discord ID, server, channel and bot version. No attachments or conversations are collected. Check the text and remove private information before confirming.";
  const notice = destination ? (fr ? "Notification privée : " : "Private notification: ") + escapeMarkdown(destination.label)
    : (fr ? "Aucune notification Discord : aucun salon privé autorisé disponible." : "No Discord notification: no authorized private channel available.");
  await interaction.editReply({ content: `${intro}\n${notice}\n\n${fr ? "Pour modifier, annulez et relancez /report bug." : "To edit, cancel and run /report bug again."}`,
    embeds: [new EmbedBuilder().setDescription(escapeMarkdown(description) || "—")],
    allowedMentions: { parse: [] }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(sendId).setLabel(fr ? "Envoyer ce rapport" : "Send this report").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(cancelId).setLabel(fr ? "Annuler" : "Cancel").setStyle(ButtonStyle.Secondary))] });
  const preview = await interaction.fetchReply();
  const choice = await preview.awaitMessageComponent({ time: 300_000,
    filter: c => c.user.id === interaction.user.id && c.guildId === interaction.guildId && [sendId, cancelId].includes(c.customId) }).catch(() => null);
  if (!choice || choice.customId !== sendId) {
    if (choice) await choice.deferUpdate();
    await interaction.editReply({ content: fr ? "Rapport annulé ou expiré. Rien n’a été envoyé." : "Report cancelled or expired. Nothing was sent.", components: [], embeds: [] });
    return;
  }
  await choice.deferUpdate();
  await interaction.editReply({ components: [], embeds: [] });
  if (interaction.guild && !await interaction.guild.members.fetch(interaction.user.id).catch(() => null)) {
    await interaction.editReply({ content: fr ? "Accès au serveur expiré. Rien n’a été envoyé." : "Server access expired. Nothing was sent." });
    return;
  }
  const ref = await errorReportService.report(interaction.client, description, {
    source: "bug-report", consented: true, notificationChannelId: destination?.id ?? null,
    guildId: interaction.guildId, guildName: interaction.guild?.name, userId: interaction.user.id,
    channelId: interaction.channelId, operation: "/report bug"
  });
  await interaction.editReply({ content: ref
    ? (fr ? `Rapport enregistré dans la boîte du développeur (référence \`${ref}\`).` : `Saved in the developer inbox (reference \`${ref}\`).`)
    : (fr ? "Impossible de confirmer l’enregistrement. Ne renvoyez pas automatiquement le rapport." : "Could not confirm storage. Do not automatically resend the report."), components: [] });
}
