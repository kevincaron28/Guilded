import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } from "discord.js";
import { categoryLabel, groupByCategory, isCategoryKey } from "./recipe-categories.js";
import { professionSlug } from "./profession-names.js";
import type { Lang } from "../i18n.js";
import { lastSeenText } from "./last-seen.js";
import { crafterLine, professionLegend, professionTitle } from "./profession-style.js";
import { buildItemEmbed } from "./item-preview-embed.js";
import type { ItemDetails } from "./item-preview-data.js";
import type { ProfessionPost, ProfessionRecipe } from "./profession-board.js";

// 8.5 (owner batch 3 #2): profession posts stay one compact line per recipe; the full item preview (what the
// chat-link previews show: quality, id, Wowhead link, and every crafter with last seen) sits behind a "Details"
// menu under the post. Picking a recipe answers privately, so the post is never crowded.

export const PROFESSION_DETAILS_PREFIX = "pdet:";
export const PROFESSION_PAGE_PREFIX = "pdpg:";
const MAX_OPTIONS = 25;
export const professionKey = (profession: string) => professionSlug(profession).slice(0, 60);

/** The "Details" menu under a profession post, step 1: the categories with their recipe counts. A profession with one small category lists its recipes directly. Null when there is nothing to pick. */
export function professionDetailsRow(post: ProfessionPost, lang: Lang): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const fr = lang === "fr";
  if (!post.recipes.length) return null;
  const groups = groupByCategory(post.recipes);
  const id = `${PROFESSION_DETAILS_PREFIX}${professionKey(post.profession)}`;
  if (groups.length === 1 && groups[0]!.recipes.length <= MAX_OPTIONS) return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(recipeMenu(id, groups[0]!.recipes, lang));
  const menu = new StringSelectMenuBuilder().setCustomId(id)
    .setPlaceholder(fr ? "Détails : choisissez une catégorie…" : "Details: pick a category…")
    .addOptions(groups.slice(0, MAX_OPTIONS).map(group => ({ label: `${categoryLabel(group.key, lang)} (${group.recipes.length})`.slice(0, 100), value: group.key })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function recipeMenu(customId: string, recipes: ProfessionRecipe[], lang: Lang): StringSelectMenuBuilder {
  const fr = lang === "fr";
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(fr ? "Détails d'une recette…" : "Details for a recipe…")
    .addOptions(recipes.slice(0, MAX_OPTIONS).map(recipe => ({
      label: recipe.itemName.slice(0, 100) || String(recipe.itemKey), value: String(recipe.itemKey),
      description: fr ? `${recipe.crafters.length} artisan(s)` : `${recipe.crafters.length} crafter(s)`
    })));
}

/** Step 2: one page (25 at most) of a category's recipes in a menu, with Previous/Next buttons when the category has more pages. Null when the category is gone. */
export function professionCategoryView(post: ProfessionPost, category: string, page: number, lang: Lang): { content: string; components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] } | null {
  const fr = lang === "fr";
  const group = groupByCategory(post.recipes).find(candidate => candidate.key === category);
  if (!group) return null;
  const pages = Math.max(1, Math.ceil(group.recipes.length / MAX_OPTIONS));
  const current = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1);
  const slice = group.recipes.slice(current * MAX_OPTIONS, (current + 1) * MAX_OPTIONS);
  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(recipeMenu(`${PROFESSION_DETAILS_PREFIX}${professionKey(post.profession)}`, slice, lang))
  ];
  if (pages > 1) {
    const button = (target: number, label: string, disabled: boolean) => new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(label).setDisabled(disabled)
      .setCustomId(`${PROFESSION_PAGE_PREFIX}${professionKey(post.profession)}:${category}:${target}`);
    components.push(new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(button(current - 1, fr ? "Précédent" : "Previous", current === 0), button(current + 1, fr ? "Suivant" : "Next", current >= pages - 1)));
  }
  const range = pages > 1 ? ` · ${fr ? "page" : "page"} ${current + 1}/${pages}` : "";
  return { content: `**${professionTitle(post.profession, lang)} · ${categoryLabel(category, lang)}** (${group.recipes.length})${range}`, components };
}

/** Reads a page button's id (pdpg:<profession>:<category>:<page>); null when it is not one. */
export function parseCategoryPage(customId: string): { profession: string; category: string; page: number } | null {
  if (!customId.startsWith(PROFESSION_PAGE_PREFIX)) return null;
  const [profession, category, page] = customId.slice(PROFESSION_PAGE_PREFIX.length).split(":");
  if (!profession || !category || !/^\d{1,3}$/.test(page ?? "") || !isCategoryKey(category)) return null;
  return { profession, category, page: Number(page) };
}

/** Finds the post a step-1 category pick refers to (pdet:<profession> with a category key as the value). */
export function findProfessionCategory(posts: ProfessionPost[], customId: string, value: string): { post: ProfessionPost; category: string } | null {
  if (!customId.startsWith(PROFESSION_DETAILS_PREFIX) || !isCategoryKey(value)) return null;
  const post = posts.find(candidate => professionKey(candidate.profession) === customId.slice(PROFESSION_DETAILS_PREFIX.length));
  return post ? { post, category: value } : null;
}

/** The private "Details" answer: the item preview plus who can craft it and when they were last seen. */
export function professionDetailsEmbed(post: ProfessionPost, recipe: ProfessionRecipe, lang: Lang, now = new Date(), details: ItemDetails | null = null): EmbedBuilder {
  const fr = lang === "fr";
  const skillOf = new Map(post.skilled.map(row => [row.character.trim().toLowerCase(), row.skillLevel]));
  const crafters = recipe.crafters.slice(0, 15).map(crafter => crafterLine({ character: crafter.character, skill: skillOf.get(crafter.character.trim().toLowerCase()) ?? null, lastSeen: crafter.lastSeen }, lastSeenText(crafter.lastSeen, lang, now), now, value => escapeMarkdown(value).slice(0, 40))).join("\n")
    + (recipe.crafters.length > 15 ? `\n+${recipe.crafters.length - 15}` : "");
  // A positive key is an item id (verified, Wowhead link); a negative one is an enchant's spell id, shown without a link.
  const base = recipe.itemKey > 0
    ? buildItemEmbed({ itemId: recipe.itemKey, name: recipe.itemName, verified: true }, details, lang)
    : { title: recipe.itemName.slice(0, 100) || String(recipe.itemKey), description: `${fr ? "Enchantement" : "Enchant"} (spell ${-recipe.itemKey})`, color: 0x5865f2 };
  const embed = new EmbedBuilder().setColor(base.color).setTitle(base.title.slice(0, 256));
  if (base.description) embed.setDescription(base.description);
  if ("url" in base && base.url) embed.setURL(base.url);
  if ("thumbnail" in base && base.thumbnail) embed.setThumbnail(base.thumbnail.url);
  embed.addFields({ name: `${professionTitle(post.profession, lang)} · ${fr ? "Artisans" : "Crafters"} (${recipe.crafters.length})`, value: `${professionLegend(lang)}\n${crafters || (fr ? "Aucun" : "None")}`.slice(0, 1024) });
  const source = details ? (fr ? " · données d'objet : Blizzard" : " · item data: Blizzard") : "";
  return embed.setFooter({ text: (fr ? "Tiré des relevés de métiers des membres" : "From members' profession scans") + source });
}

/** Finds the post and recipe a Details pick refers to; null when either is gone. */
export function findProfessionRecipe(posts: ProfessionPost[], customId: string, value: string): { post: ProfessionPost; recipe: ProfessionRecipe } | null {
  if (!customId.startsWith(PROFESSION_DETAILS_PREFIX) || !/^-?\d{1,10}$/.test(value)) return null;
  const wanted = customId.slice(PROFESSION_DETAILS_PREFIX.length);
  const post = posts.find(candidate => professionKey(candidate.profession) === wanted);
  const recipe = post?.recipes.find(candidate => candidate.itemKey === Number(value));
  return post && recipe ? { post, recipe } : null;
}
