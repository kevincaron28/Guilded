import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags, escapeMarkdown } from "discord.js";
import { errorReportService } from "./context.js";
import { discordAttachmentUrl, redactDiagnosticText } from "../services/diagnostic-privacy.js";
import { notifyEmbed, officerReportDestination } from "../services/notify.js";

export const bugCommand = new SlashCommandBuilder()
  .setName("bug")
  .setDescription("Preview and send a private bug report to the developer.")
  .addStringOption(o => o.setName("description").setDescription("Describe the problem without private chat, credentials or personal information.").setRequired(true).setMaxLength(1000))
  .addAttachmentOption(o => o.setName("screenshot").setDescription("Optional screenshot"));

export async function executeBug(interaction: ChatInputCommandInteraction): Promise<void> {
  const fr = interaction.locale.startsWith("fr");
  const description = redactDiagnosticText(interaction.options.getString("description", true), 1000);
  // Only an image hosted on Discord's own CDN is shown and sent; its contents are never inspected.
  const attachment = interaction.options.getAttachment("screenshot");
  const screenshot = attachment?.contentType?.startsWith("image/") ? discordAttachmentUrl(attachment.url) : null;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const destination = await errorReportService.destination(interaction.client);
  const officerDestination = await officerReportDestination(interaction.guild).catch(() => null);
  const sendId = `bugconfirm:${interaction.id}:send`, cancelId = `bugconfirm:${interaction.id}:cancel`;
  const intro = fr
    ? "**Aperçu privé — rien n’a été envoyé.**\nDestinataires : boîte privée du développeur Guilded et officiers de ce serveur. Inclut votre identifiant Discord, le serveur, le salon et la version du bot, ainsi que votre capture d’écran si vous en avez joint une. Aucune conversation n’est collectée. Vérifiez le texte et retirez toute information privée avant de confirmer."
    : "**Private preview — nothing has been sent.**\nRecipients: the Guilded developer’s private report inbox and this server’s officers. Includes your Discord ID, server, channel and bot version, plus your screenshot if you attached one. No conversations are collected. Check the text and remove private information before confirming.";
  const notice = destination ? (fr ? "Notification privée : " : "Private notification: ") + escapeMarkdown(destination.label)
    : (fr ? "Aucune notification Discord au développeur : aucun salon privé autorisé disponible." : "No Discord notification to the developer: no authorized private channel available.");
  const officerNotice = officerDestination ? (fr ? "Copie aux officiers : " : "Officer copy: ") + escapeMarkdown(officerDestination.label)
    : (fr ? "Aucune copie aux officiers : aucun salon privé autorisé disponible." : "No officer copy: no authorized private channel available.");
  const file = !attachment ? null : screenshot
    ? (fr ? "Capture d’écran jointe : " : "Screenshot included: ") + escapeMarkdown(attachment.name)
    : (fr ? "Le fichier joint n’est pas une image : il ne sera pas envoyé." : "The attached file is not an image: it will not be sent.");
  const shown = new EmbedBuilder().setDescription(escapeMarkdown(description) || "—");
  if (screenshot) shown.setImage(screenshot);
  await interaction.editReply({ content: `${intro}\n${notice}\n${officerNotice}${file ? `\n${file}` : ""}\n\n${fr ? "Pour modifier, annulez et relancez /report bug." : "To edit, cancel and run /report bug again."}`,
    embeds: [shown],
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
    source: "bug-report", consented: true, notificationChannelId: destination?.id ?? null, screenshotUrl: screenshot,
    guildId: interaction.guildId, guildName: interaction.guild?.name, userId: interaction.user.id,
    channelId: interaction.channelId, operation: "/report bug"
  });
  // The officers see exactly what the member previewed: the redacted text and the screenshot.
  const officers = officerDestination && ref ? await notifyEmbed(interaction.guild, (lang) => {
    const embed = new EmbedBuilder().setColor(0xd4a017).setDescription([
      `🐞 ${lang === "fr" ? "Rapport de bug" : "Bug report"}${ref ? ` \`${ref}\`` : ""} ${lang === "fr" ? "de" : "from"} <@${interaction.user.id}>`,
      escapeMarkdown(description) || "—"
    ].join("\n"));
    return screenshot ? embed.setImage(screenshot) : embed;
  }, "officer", null, officerDestination.id) : false;
  const shared = officers ? (fr ? " Les officiers du serveur ont été avisés." : " Your server’s officers were notified.") : "";
  await interaction.editReply({ content: (ref
    ? (fr ? `Rapport enregistré dans la boîte du développeur (référence \`${ref}\`).` : `Saved in the developer inbox (reference \`${ref}\`).`)
    : (fr ? "Impossible de confirmer l’enregistrement. Ne renvoyez pas automatiquement le rapport." : "Could not confirm storage. Do not automatically resend the report.")) + shared, components: [] });
}
