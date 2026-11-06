import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } from "discord.js";
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
const MAX_OPTIONS = 25;
export const professionKey = (profession: string) => profession.trim().toLowerCase().slice(0, 60);

/** The "Details" menu under a profession post: the first recipes of the post, by name. Null when there is nothing to pick. */
export function professionDetailsRow(post: ProfessionPost, lang: Lang): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const fr = lang === "fr";
  const recipes = post.recipes.slice(0, MAX_OPTIONS);
  if (!recipes.length) return null;
  const menu = new StringSelectMenuBuilder().setCustomId(`${PROFESSION_DETAILS_PREFIX}${professionKey(post.profession)}`)
    .setPlaceholder(fr ? "Détails d'une recette…" : "Details for a recipe…")
    .addOptions(recipes.map(recipe => ({
      label: recipe.itemName.slice(0, 100) || String(recipe.itemKey), value: String(recipe.itemKey),
      description: fr ? `${recipe.crafters.length} artisan(s)` : `${recipe.crafters.length} crafter(s)`
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** The private "Details" answer: the item preview plus who can craft it and when they were last seen. */
export function professionDetailsEmbed(post: ProfessionPost, recipe: ProfessionRecipe, lang: Lang, now = new Date(), details: ItemDetails | null = null): EmbedBuilder {
  const fr = lang === "fr";
  const skillOf = new Map(post.skilled.map(row => [row.character.trim().toLowerCase(), row.skillLevel]));
  const crafters = recipe.crafters.slice(0, 15).map(crafter => crafterLine({ character: crafter.character, skill: skillOf.get(crafter.character.trim().toLowerCase()) ?? null, lastSeen: crafter.lastSeen }, lastSeenText(crafter.lastSeen, lang, now), now, value => escapeMarkdown(value).slice(0, 40))).join("\n")
    + (recipe.crafters.length > 15 ? `\n+${recipe.crafters.length - 15}` : "");
  // A positive key is an item id (verified, Wowhead link); a negative one is an enchant's spell id, shown without a link.
  const base = recipe.itemKey > 0
    ? buildItemEmbed({ itemId: recipe.itemKey, name: recipe.itemName, verified: true }, details)
    : { title: recipe.itemName.slice(0, 100) || String(recipe.itemKey), description: `${fr ? "Enchantement" : "Enchant"} (spell ${-recipe.itemKey})`, color: 0x5865f2 };
  const embed = new EmbedBuilder().setColor(base.color).setTitle(base.title.slice(0, 256));
  if (base.description) embed.setDescription(base.description);
  if ("url" in base && base.url) embed.setURL(base.url);
  if ("thumbnail" in base && base.thumbnail) embed.setThumbnail(base.thumbnail.url);
  embed.addFields({ name: `${professionTitle(post.profession, lang)} · ${fr ? "Artisans" : "Crafters"} (${recipe.crafters.length})`, value: `${professionLegend(lang)}\n${crafters || (fr ? "Aucun" : "None")}`.slice(0, 1024) });
  return embed.setFooter({ text: fr ? "Recettes tirées des relevés de métiers · dernière présence selon le registre" : "Recipes from members' profession scans · last seen from the guild roster" });
}

/** Finds the post and recipe a Details pick refers to; null when either is gone. */
export function findProfessionRecipe(posts: ProfessionPost[], customId: string, value: string): { post: ProfessionPost; recipe: ProfessionRecipe } | null {
  if (!customId.startsWith(PROFESSION_DETAILS_PREFIX) || !/^-?\d{1,10}$/.test(value)) return null;
  const wanted = customId.slice(PROFESSION_DETAILS_PREFIX.length);
  const post = posts.find(candidate => professionKey(candidate.profession) === wanted);
  const recipe = post?.recipes.find(candidate => candidate.itemKey === Number(value));
  return post && recipe ? { post, recipe } : null;
}
