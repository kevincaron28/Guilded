import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { loadFullNameBook } from "../services/character-display.js";
import { loadProfessionPosts } from "../services/profession-board.js";
import { findProfessionCategory, findProfessionRecipe, parseCategoryPage, professionCategoryView, professionKey } from "../services/profession-details.js";
import { professionDetailsEmbed } from "../services/profession-details.js";
import { boardLang, requestRows } from "./craft-board.js";
import { guildService } from "./context.js";
import { itemData } from "../item-data.js";
import { withDeadline } from "../services/blizzard-items.js";

// Details waits a few seconds for item data at most; a slow answer still fills the cache for the next pick.
const detailsItems = withDeadline(itemData, 4_000);

/** A pick in a profession post's "Details" menu: a private, full item preview with every crafter. */
export async function handleProfessionDetails(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const posts = await loadProfessionPosts(prisma, guild.id, await loadFullNameBook(prisma, guild.id));
  // Step 1 of the two-step menu: a category was picked; answer with that category's recipes (step 2, paged).
  const category = findProfessionCategory(posts, interaction.customId, interaction.values[0] ?? "");
  if (category) {
    const view = professionCategoryView(category.post, category.category, 0, lang);
    await interaction.editReply(view ? { content: view.content, components: view.components } : { content: lang === "fr" ? "Cette catégorie n'est plus listée." : "That category is no longer listed." });
    return;
  }
  const found = findProfessionRecipe(posts, interaction.customId, interaction.values[0] ?? "");
  if (!found) { await interaction.editReply({ content: lang === "fr" ? "Cette recette n'est plus listée." : "That recipe is no longer listed." }); return; }
  const details = found.recipe.itemKey > 0 ? await detailsItems.lookup({ itemId: found.recipe.itemKey, name: found.recipe.itemName, verified: true }) : null;
  await interaction.editReply({ embeds: [professionDetailsEmbed(found.post, found.recipe, lang, new Date(), details)], components: requestRows(lang, found.recipe.itemKey, found.recipe.crafters.map(crafter => ({ character: crafter.character, skill: found.post.skilled.find(row => row.character.toLowerCase() === crafter.character.toLowerCase())?.skillLevel ?? null, lastSeen: crafter.lastSeen }))), allowedMentions: { parse: [] } });
}

/** Previous/Next on a category's recipe menu: the same private message shows the other page. */
export async function handleProfessionPage(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const wanted = parseCategoryPage(interaction.customId);
  const post = wanted ? (await loadProfessionPosts(prisma, guild.id, await loadFullNameBook(prisma, guild.id))).find(candidate => professionKey(candidate.profession) === wanted.profession) : undefined;
  const view = wanted && post ? professionCategoryView(post, wanted.category, wanted.page, lang) : null;
  await interaction.editReply(view ? { content: view.content, components: view.components } : { content: lang === "fr" ? "Cette catégorie n'est plus listée." : "That category is no longer listed.", components: [] });
}
