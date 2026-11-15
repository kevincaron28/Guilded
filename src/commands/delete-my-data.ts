import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { deleteMyData } from "../services/data-deletion.js";

// "Delete my data" lives in Discord, where Discord itself proves who is asking (the website has no sign-in page for it).
// A preview says what goes, and nothing is deleted until the member presses the confirm button. It calls the same
// service the website page and the companion call (data-deletion.ts).
export const deleteMyDataCommand = new SlashCommandBuilder()
  .setName("delete-my-data")
  .setDescription("Delete the data Guilded keeps about you (asks you to confirm first).")
  .setDescriptionLocalizations({ fr: "Supprimer les données que Guilded garde sur vous (une confirmation est demandée)." });

export async function executeDeleteMyData(interaction: ChatInputCommandInteraction): Promise<void> {
  const fr = interaction.locale.startsWith("fr");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const confirmId = `deletemydata:${interaction.id}:yes`, cancelId = `deletemydata:${interaction.id}:no`;
  const intro = fr
    ? "**Supprimer mes données — rien n’a été supprimé pour l’instant.**\nCela retire votre compte du site, vos personnages dans toutes les guildes où vous êtes, et vos données personnelles (rapports JcJ, succès, jalons, alertes, identifiants d’appairage et du compagnon, badges). Votre nom Discord devient « Deleted member » dans les fiches de membre; les points, le butin et les présences de raid restent dans l’historique de chaque guilde sous ce nom. Les sauvegardes et les messages Discord déjà publiés ne sont pas modifiés. **Ceci est définitif.**"
    : "**Delete my data — nothing has been deleted yet.**\nThis removes your website account, your characters in every server where you are a member, and your personal records (battleground reports, achievements, milestones, alerts, pairing and companion credentials, badges). Your Discord name on member records becomes “Deleted member”; points, loot and raid attendance stay in each guild’s history under that name. Backups and Discord messages already posted are not changed. **This cannot be undone.**";
  await interaction.editReply({ content: intro, allowedMentions: { parse: [] }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(fr ? "Oui, tout supprimer" : "Yes, delete everything").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel(fr ? "Annuler" : "Cancel").setStyle(ButtonStyle.Secondary))] });
  const preview = await interaction.fetchReply();
  const choice = await preview.awaitMessageComponent({ time: 120_000,
    filter: c => c.user.id === interaction.user.id && [confirmId, cancelId].includes(c.customId) }).catch(() => null);
  if (!choice || choice.customId !== confirmId) {
    if (choice) await choice.deferUpdate();
    await interaction.editReply({ content: fr ? "Annulé ou expiré. Rien n’a été supprimé." : "Cancelled or expired. Nothing was deleted.", components: [] });
    return;
  }
  await choice.deferUpdate();
  try {
    const done = await deleteMyData(prisma, interaction.user.id);
    await interaction.editReply({ content: fr
      ? `Vos données ont été supprimées : ${done.characters} personnage(s) et ${done.account ? "votre compte du site" : "aucun compte du site"}. Pour effacer aussi ce PC, appuyez sur « Réinitialiser ce compagnon » dans le compagnon.`
      : `Your data was deleted: ${done.characters} character(s) and ${done.account ? "your website account" : "no website account"}. To clear this PC too, press “Reset this companion” in the companion.`, components: [] });
  } catch {
    await interaction.editReply({ content: fr ? "La suppression n’a pas pu être effectuée. Réessayez, ou demandez-la dans la communauté de soutien Guilded." : "The deletion could not be completed. Try again, or ask in the Guilded support community.", components: [] });
  }
}
