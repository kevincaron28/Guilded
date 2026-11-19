import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { deleteMyData } from "../services/data-deletion.js";

// "Delete my data" lives in Discord, where Discord itself proves who is asking (the website has no sign-in page for it).
// A preview says what goes, and nothing is deleted until the member presses the confirm button. It calls the same
// service the website page and the companion call (data-deletion.ts).
// Since the commands restructure (November 2026) it is /character privacy action:delete; the old
// /delete-my-data name answers "moved" (moved.ts).
export async function executeDeleteMyData(interaction: ChatInputCommandInteraction, onError: (error: unknown) => void = () => undefined): Promise<void> {
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
    if (choice) await choice.deferUpdate().catch(() => undefined);
    // After the 120 s wait the interaction token may be gone: nothing more to say then.
    await interaction.editReply({ content: fr ? "Annulé ou expiré. Rien n’a été supprimé." : "Cancelled or expired. Nothing was deleted.", components: [] }).catch(() => undefined);
    return;
  }
  try {
    await choice.deferUpdate();
    const done = await deleteMyData(prisma, interaction.user.id);
    await interaction.editReply({ content: fr
      ? `Vos données ont été supprimées : ${done.characters} personnage(s) et ${done.account ? "votre compte du site" : "aucun compte du site"}. Pour effacer aussi ce PC, appuyez sur « Réinitialiser ce compagnon » dans le compagnon.`
      : `Your data was deleted: ${done.characters} character(s) and ${done.account ? "your website account" : "no website account"}. To clear this PC too, press “Reset this companion” in the companion.`, components: [] });
  } catch (error) {
    onError(error);
    // The token may be dead by now (that can be why we are here): never throw from the failure message.
    await interaction.editReply({ content: fr ? "La suppression n’a pas pu être effectuée. Réessayez, ou demandez-la dans la communauté de soutien Guilded." : "The deletion could not be completed. Try again, or ask in the Guilded support community.", components: [] }).catch(() => undefined);
  }
}
