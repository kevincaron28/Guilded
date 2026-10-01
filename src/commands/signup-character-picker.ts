import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type MessageComponentInteraction } from "discord.js";
import { prisma } from "../database.js";
import { CHARACTER_REQUIRED } from "../services/signup-character.js";

// A paginated private picker also supports owners with more than Discord's 25 menu options.
export async function pickSignupCharacter(interaction: ButtonInteraction | ChatInputCommandInteraction | MessageComponentInteraction, guildId: string, memberId: string) {
  const wasAcknowledged = interaction.replied || interaction.deferred;
  if (!wasAcknowledged) await interaction.deferReply({ ephemeral: true });
  const characters = await prisma.character.findMany({ where: { memberId, member: { guildId } }, orderBy: [{ name: "asc" }, { realm: "asc" }] });
  if (!characters.length) throw new Error(CHARACTER_REQUIRED);
  if (characters.length === 1) return characters[0]!;
  let page = 0;
  const screen = () => ({ content: "Quel personnage amènes-tu? Choisis son nom et son royaume.", components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("signupchar:choose").setPlaceholder("Ton personnage pour cette inscription")
      .addOptions(characters.slice(page * 25, (page + 1) * 25).map(character => ({ label: `${character.name} — ${character.realm}`.slice(0, 100), description: character.className.slice(0, 100), value: character.id })))),
    ...(characters.length > 25 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("signupchar:previous").setLabel("Précédents").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId("signupchar:next").setLabel("Suivants").setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * 25 >= characters.length))] : [])
  ] });
  const message = wasAcknowledged ? await interaction.followUp({ ...screen(), ephemeral: true, fetchReply: true })
    : await interaction.editReply(screen());
  const expires = Date.now() + 5 * 60_000;
  while (Date.now() < expires) {
    const choice = await message.awaitMessageComponent({ time: Math.max(1, expires - Date.now()), filter: value => value.user.id === interaction.user.id && value.customId.startsWith("signupchar:") }).catch(() => null);
    if (!choice) break;
    if (choice.isStringSelectMenu()) {
      const character = characters.find(value => value.id === choice.values[0]);
      if (!character) { await choice.deferUpdate(); continue; }
      await choice.update({ content: `Personnage choisi : **${character.name} — ${character.realm}**.`, components: [] });
      return character;
    }
    page = Math.max(0, Math.min(Math.ceil(characters.length / 25) - 1, page + (choice.customId === "signupchar:next" ? 1 : -1)));
    await choice.update(screen());
  }
  await interaction.webhook.editMessage(message.id, { content: "Choix expiré. Aucune inscription n'a été ajoutée.", components: [] });
  return null;
}
