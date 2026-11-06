import { MessageFlags, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { loadProfessionPosts } from "../services/profession-board.js";
import { findProfessionRecipe } from "../services/profession-details.js";
import { professionDetailsEmbed } from "../services/profession-details.js";
import { boardLang, requestRows } from "./craft-board.js";
import { guildService } from "./context.js";

/** A pick in a profession post's "Details" menu: a private, full item preview with every crafter. */
export async function handleProfessionDetails(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const found = findProfessionRecipe(await loadProfessionPosts(prisma, guild.id), interaction.customId, interaction.values[0] ?? "");
  if (!found) { await interaction.editReply({ content: lang === "fr" ? "Cette recette n'est plus listée." : "That recipe is no longer listed." }); return; }
  await interaction.editReply({ embeds: [professionDetailsEmbed(found.post, found.recipe, lang)], components: requestRows(lang, found.recipe.itemKey, found.recipe.crafters.map(crafter => ({ character: crafter.character, skill: found.post.skilled.find(row => row.character.toLowerCase() === crafter.character.toLowerCase())?.skillLevel ?? null, lastSeen: crafter.lastSeen }))), allowedMentions: { parse: [] } });
}
