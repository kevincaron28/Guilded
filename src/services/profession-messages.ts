import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import type { Lang } from "../i18n.js";
import { lastSeenText } from "./last-seen.js";
import { crafterLine, professionLegend, professionTitle, seenDot } from "./profession-style.js";
import { professionKey } from "./profession-details.js";
import { categoryLabel, groupByCategory } from "./recipe-categories.js";
import { PROFESSION_POST_MARKER, QUALITY_SQUARES, wowheadItemUrl, type ProfessionPost, type ProfessionRecipe } from "./profession-board.js";

// 9.4.x: a profession's forum thread shows EVERY recipe. The starter post is a short summary (crafters, a count and a jump
// link per category); each category then has its own bot message(s), as many as its recipes need, edited in place
// (profession-board.ts keeps the message ids in ProfessionPostMessage). Pure here: same input and clock, same output.
// Discord limits: 10 embeds per message, 4096 characters per embed description, 6000 characters over a whole message.

export const PROFESSION_CATEGORY_PREFIX = "pdcv:";
const EMBED_LIMIT = 3900, MESSAGE_LIMIT = 5700, MAX_EMBEDS = 10, MAX_CRAFTERS_SHOWN = 3, MAX_CRAFTER_LINES = 8;
const COLOR = 0xd4af37;

export interface CategoryMessage {
  /** Stable key of the message inside its profession: c:<category>:<part>. */
  slot: string; category: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
}

/** One recipe line: quality square, the item name as a masked Wowhead link (hover shows the page, click opens it), and up to three crafters. */
export function recipeLine(recipe: ProfessionRecipe, now: Date): string {
  const who = recipe.crafters.slice(0, MAX_CRAFTERS_SHOWN).map(crafter => `${seenDot(crafter.lastSeen, now)} ${escapeMarkdown(crafter.character).slice(0, 40)}`).join(", ")
    + (recipe.crafters.length > MAX_CRAFTERS_SHOWN ? ` +${recipe.crafters.length - MAX_CRAFTERS_SHOWN}` : "");
  const label = escapeMarkdown(recipe.itemName.replace(/[[\]]/g, "")).slice(0, 80);
  const mark = recipe.quality !== undefined ? QUALITY_SQUARES[recipe.quality] ?? "•" : "•";
  return recipe.itemKey > 0 ? `${mark} **[${label}](${wowheadItemUrl(recipe.itemKey)})** — ${who}` : `• **${label}** — ${who}`;
}

/** Every recipe of the profession, in messages of at most 10 embeds and 5,700 characters, one category after another. Nothing is cut. */
export function professionCategoryMessages(post: ProfessionPost, lang: Lang, now = new Date()): CategoryMessage[] {
  const fr = lang === "fr";
  const out: CategoryMessage[] = [];
  for (const group of groupByCategory(post.recipes)) {
    const heading = (continued: boolean) => `### ${categoryLabel(group.key, lang)} ${continued ? (fr ? "(suite)" : "(continued)") : `(${group.recipes.length})`}`;
    const parts: string[][][] = []; // messages > embeds > lines
    let size = 0;
    const startMessage = () => { const text = heading(parts.length > 0); parts.push([[text]]); size = text.length + 1; };
    startMessage();
    for (const recipe of group.recipes) {
      const line = recipeLine(recipe, now).slice(0, 600);
      const message = parts[parts.length - 1]!;
      const embed = message[message.length - 1]!;
      if (size + line.length + 1 > MESSAGE_LIMIT || (embed.join("\n").length + line.length + 1 > EMBED_LIMIT && message.length >= MAX_EMBEDS)) {
        startMessage();
        const fresh = parts[parts.length - 1]!;
        fresh[0]!.push(line); size += line.length + 1;
      } else if (embed.join("\n").length + line.length + 1 > EMBED_LIMIT) {
        message.push([line]); size += line.length + 1;
      } else { embed.push(line); size += line.length + 1; }
    }
    parts.forEach((embeds, part) => {
      const button = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId(`${PROFESSION_CATEGORY_PREFIX}${professionKey(post.profession)}:${group.key}`)
        .setLabel(`${fr ? "Détails" : "Details"} · ${categoryLabel(group.key, lang)}`.slice(0, 80));
      out.push({ slot: `c:${group.key}:${part}`, category: group.key,
        embeds: embeds.map(lines => new EmbedBuilder().setColor(COLOR).setDescription(lines.join("\n").slice(0, 4096))),
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] });
    });
  }
  return out;
}

/** The starter post: crafters, a count per category and, once the category messages exist, a link to each one. */
export function professionSummaryEmbed(post: ProfessionPost, lang: Lang, guildId = "", now = new Date(), jump: { discordGuildId: string; threadId: string; firstMessage: Map<string, string> } | null = null): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 40);
  const lines = [professionLegend(lang), "", `**${t("Crafters", "Artisans")}** (${post.skilled.length})`];
  if (!post.skilled.length) lines.push(t("none recorded", "aucun enregistré"));
  for (const row of post.skilled.slice(0, MAX_CRAFTER_LINES)) lines.push(crafterLine({ character: row.character, skill: row.skillLevel, lastSeen: row.lastSeen }, lastSeenText(row.lastSeen, lang, now), now, name));
  if (post.skilled.length > MAX_CRAFTER_LINES) lines.push(t(`…and ${post.skilled.length - MAX_CRAFTER_LINES} more`, `…et ${post.skilled.length - MAX_CRAFTER_LINES} autres`));
  if (post.recipes.length) {
    lines.push("", `**${t("Recipes", "Recettes")}** (${post.recipes.length}) — ${t("every recipe is listed below, by category; click a name for its item page, or use the Details menu to see the item and request it", "toutes les recettes sont listées plus bas, par catégorie; clique un nom pour sa page d'objet, ou utilise le menu Détails pour voir l'objet et le demander")}`);
    for (const group of groupByCategory(post.recipes)) {
      const message = jump?.firstMessage.get(group.key);
      const label = `${categoryLabel(group.key, lang)} (${group.recipes.length})`;
      lines.push(message && jump ? `• [${label}](https://discord.com/channels/${jump.discordGuildId}/${jump.threadId}/${message})` : `• ${label}`);
    }
  } else lines.push("", t("No recipe recorded yet. Open this profession's window in game with Guilded to add yours.", "Aucune recette enregistrée. Ouvre la fenêtre de ce métier en jeu avec Guilded pour ajouter les tiens."));
  return new EmbedBuilder().setColor(COLOR).setTitle(professionTitle(post.profession, lang).slice(0, 256)).setDescription(lines.join("\n").slice(0, 4096))
    .setFooter({ text: `${PROFESSION_POST_MARKER} • ${guildId} • ${t("From members' profession scans", "Tiré des relevés de métiers des membres")}`.slice(0, 2048) });
}
