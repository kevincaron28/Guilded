import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type MessageComponentInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { CHARACTER_REQUIRED } from "../services/signup-character.js";
import { asLang } from "../i18n.js";
import { characterName } from "../services/character-display.js";

// A paginated private picker also supports owners with more than Discord's 25 menu options.
export async function pickSignupCharacter(interaction: ButtonInteraction | ChatInputCommandInteraction | MessageComponentInteraction, guildId: string, memberId: string) {
  const wasAcknowledged = interaction.replied || interaction.deferred;
  if (!wasAcknowledged) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const characters = await prisma.character.findMany({ where: { memberId, member: { guildId } }, orderBy: [{ name: "asc" }, { realm: "asc" }] });
  if (!characters.length) throw new Error(CHARACTER_REQUIRED);
  if (characters.length === 1) return characters[0]!;
  const lang = asLang((await prisma.guildSettings.findUnique({ where: { guildId }, select: { language: true } }))?.language);
  const text = (en: string, fr: string) => lang === "fr" ? fr : en;
  let page = 0;
  const screen = () => ({ content: text("Which character are you bringing? Choose their name and realm.", "Quel personnage amènes-tu? Choisis son nom et son royaume."), components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("signupchar:choose").setPlaceholder(text("Your character for this signup", "Ton personnage pour cette inscription"))
      .addOptions(characters.slice(page * 25, (page + 1) * 25).map(character => ({ label: `${characterName(character)} — ${character.realm}`.slice(0, 100), description: character.className.slice(0, 100), value: character.id })))),
    ...(characters.length > 25 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("signupchar:previous").setLabel(text("Previous", "Précédents")).setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId("signupchar:next").setLabel(text("Next", "Suivants")).setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * 25 >= characters.length))] : [])
  ] });
  const message = wasAcknowledged ? await interaction.followUp({ ...screen(), flags: MessageFlags.Ephemeral, fetchReply: true })
    : await interaction.editReply(screen());
  const expires = Date.now() + 5 * 60_000;
  while (Date.now() < expires) {
    const choice = await message.awaitMessageComponent({ time: Math.max(1, expires - Date.now()), filter: value => value.user.id === interaction.user.id && value.customId.startsWith("signupchar:") }).catch(() => null);
    if (!choice) break;
    if (choice.isStringSelectMenu()) {
      const character = characters.find(value => value.id === choice.values[0]);
      if (!character) { await choice.deferUpdate(); continue; }
      await choice.update({ content: `${text("Selected character", "Personnage choisi")} : **${characterName(character)} — ${character.realm}**.`, components: [] });
      return character;
    }
    page = Math.max(0, Math.min(Math.ceil(characters.length / 25) - 1, page + (choice.customId === "signupchar:next" ? 1 : -1)));
    await choice.update(screen());
  }
  await interaction.webhook.editMessage(message.id, { content: text("Selection expired. No signup was added.", "Choix expiré. Aucune inscription n'a été ajoutée."), components: [] });
  return null;
}
