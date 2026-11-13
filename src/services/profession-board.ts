import { EmbedBuilder, escapeMarkdown, type ForumChannel, type Guild as DiscordGuild, type ThreadChannel } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { byLastSeen, lastSeenOf, lastSeenText } from "./last-seen.js";
import { crafterLine, professionLegend, professionName, professionTitle, seenDot } from "./profession-style.js";
import { professionDetailsRow } from "./profession-details.js";
import { normalizeProfessionName, professionSlug } from "./profession-names.js";
import { displayCharacterName, emptyNameBook, loadFullNameBook, type FullNameBook } from "./character-display.js";
import { nullItemDataProvider, type ItemDataProvider } from "./item-preview-data.js";

// 8.5 track D2: ONE post per profession in the craft forum, edited in place (the duel-board pattern), listing every
// recipe and the crafters who know it with their last seen. It replaces the old "top 3 per profession" directory
// text. On by default (GuildSettings.professionPostsEnabled); an officer can switch it off with /craft posts-setting.
// Posts are found by their thread title + embed footer, so no message id is stored. Nothing is ever awarded.

export const PROFESSION_POST_MARKER = "Guilded profession board";
const THREAD_PREFIX = "📚 ";
const DESCRIPTION_LIMIT = 3900, MAX_CRAFTERS_SHOWN = 3, MAX_CRAFTER_LINES = 8;

export interface ProfessionRecipe {
  itemKey: number; itemName: string; crafters: { character: string; lastSeen: Date | null }[];
  /** Quality 0-5 of the crafted item, from the item data source (docs/plans/ITEM_LINKS.md); absent when unknown. */
  quality?: number;
}
/** One square per item quality, so a long list stays one line per recipe (Poor … Legendary). */
export const QUALITY_SQUARES = ["⬛", "⬜", "🟩", "🟦", "🟪", "🟧"];
export const wowheadItemUrl = (itemId: number) => `https://www.wowhead.com/classic/item=${itemId}`;

/** Fills each crafted item's quality from the item data source, one lookup per item (cached and rate-limited there). */
export async function addItemQuality(posts: ProfessionPost[], items: ItemDataProvider): Promise<void> {
  const seen = new Map<number, number | undefined>();
  for (const recipe of posts.flatMap(post => post.recipes)) {
    if (recipe.itemKey <= 0) continue; // enchants are spells, not items
    if (!seen.has(recipe.itemKey)) seen.set(recipe.itemKey, (await items.lookup({ itemId: recipe.itemKey, name: recipe.itemName, verified: true }).catch(() => null))?.quality);
    const quality = seen.get(recipe.itemKey);
    if (quality !== undefined) recipe.quality = quality;
  }
}
export interface ProfessionPost {
  profession: string;
  /** Crafters with a recorded skill, recently seen first. */
  skilled: { character: string; skillLevel: number; lastSeen: Date | null }[];
  recipes: ProfessionRecipe[];
}

type Db = Pick<PrismaClient, "professionSkill" | "recipeKnown">;
const key = (value: string) => value.trim().toLowerCase();
// Professions are grouped by their canonical name: French "Cuisine" and English "Cooking" rows are one post.
const pkey = (value: string) => professionSlug(value);

/** Everything the profession posts and the gallery show, grouped by profession (spelling variants merged). */
export async function loadProfessionPosts(db: Db, guildId: string, names: FullNameBook = emptyNameBook): Promise<ProfessionPost[]> {
  const shown = (name: string) => displayCharacterName(name, names);
  const skills = await db.professionSkill.findMany({ where: { character: { member: { guildId, status: "ACTIVE" } } },
    select: { profession: true, skillLevel: true, character: { select: { name: true, lastSeenAt: true } } } });
  const recipes = await db.recipeKnown.findMany({ where: { guildId }, select: { character: true, profession: true, itemKey: true, itemName: true, scannedAt: true },
    orderBy: [{ itemName: "asc" }, { character: "asc" }] });
  const seenByName = new Map<string, Date | null>(skills.map(row => [key(row.character.name), row.character.lastSeenAt]));
  const lastSeenFor = (name: string, scannedAt: Date) => lastSeenOf(seenByName.get(key(name)), scannedAt);
  const posts = new Map<string, ProfessionPost>();
  const post = (profession: string) => {
    const existing = posts.get(pkey(profession));
    if (existing) return existing;
    const created: ProfessionPost = { profession: normalizeProfessionName(profession), skilled: [], recipes: [] };
    posts.set(pkey(profession), created);
    return created;
  };
  const newestScan = new Map<string, Date>();
  for (const row of recipes) { const current = newestScan.get(key(row.character)); if (!current || row.scannedAt > current) newestScan.set(key(row.character), row.scannedAt); }
  for (const row of skills) {
    const entry = post(row.profession);
    const character = shown(row.character.name);
    // One character with the profession stored under two spellings is listed once, at the higher skill.
    const twin = entry.skilled.find(skilled => skilled.character === character);
    if (twin) { twin.skillLevel = Math.max(twin.skillLevel, row.skillLevel); continue; }
    entry.skilled.push({ character, skillLevel: row.skillLevel, lastSeen: lastSeenOf(row.character.lastSeenAt, newestScan.get(key(row.character.name))) });
  }
  const byItem = new Map<string, ProfessionRecipe>();
  for (const row of recipes) {
    const target = post(row.profession);
    const id = `${pkey(row.profession)}|${row.itemKey}`;
    let recipe = byItem.get(id);
    if (!recipe) { recipe = { itemKey: row.itemKey, itemName: row.itemName, crafters: [] }; byItem.set(id, recipe); target.recipes.push(recipe); }
    // One entry per shown name: several scans or name keys of the same character (first name vs full name)
    // must not list them twice, and Discord rejects a menu with duplicate options.
    const character = shown(row.character), lastSeen = lastSeenFor(row.character, row.scannedAt);
    const same = recipe.crafters.find(crafter => crafter.character.toLowerCase() === character.toLowerCase());
    if (!same) recipe.crafters.push({ character, lastSeen });
    else if (lastSeen && (!same.lastSeen || lastSeen > same.lastSeen)) same.lastSeen = lastSeen;
  }
  for (const entry of posts.values()) {
    entry.skilled.sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen) || b.skillLevel - a.skillLevel || a.character.localeCompare(b.character));
    for (const recipe of entry.recipes) recipe.crafters.sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen) || a.character.localeCompare(b.character));
  }
  return [...posts.values()].sort((a, b) => a.profession.localeCompare(b.profession));
}

/** Pure: one profession's embed. Same input and clock, same output. */
export function professionPostEmbed(post: ProfessionPost, lang: Lang, guildId = "", now = new Date(), siteUrl?: string): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 40);
  const seen = (date: Date | null) => lastSeenText(date, lang, now);
  const head = [professionLegend(lang), "", `**${t("Crafters", "Artisans")}** (${post.skilled.length})`];
  if (!post.skilled.length) head.push(t("none recorded", "aucun enregistré"));
  for (const row of post.skilled.slice(0, MAX_CRAFTER_LINES)) head.push(crafterLine({ character: row.character, skill: row.skillLevel, lastSeen: row.lastSeen }, seen(row.lastSeen), now, name));
  if (post.skilled.length > MAX_CRAFTER_LINES) head.push(t(`…and ${post.skilled.length - MAX_CRAFTER_LINES} more`, `…et ${post.skilled.length - MAX_CRAFTER_LINES} autres`));
  const header = head.join("\n");
  let used = header.length + 40;
  const rows: string[] = [];
  let omitted = 0;
  for (const recipe of post.recipes) {
    const who = recipe.crafters.slice(0, MAX_CRAFTERS_SHOWN).map(crafter => `${seenDot(crafter.lastSeen, now)} ${name(crafter.character)}`).join(", ")
      + (recipe.crafters.length > MAX_CRAFTERS_SHOWN ? ` +${recipe.crafters.length - MAX_CRAFTERS_SHOWN}` : "");
    // A crafted item links to its Wowhead classic page (name only, so the line stays short); enchants have no item page.
    const label = escapeMarkdown(recipe.itemName.replace(/[[\]]/g, "")).slice(0, 80);
    const mark = recipe.quality !== undefined ? QUALITY_SQUARES[recipe.quality] ?? "•" : "•";
    const line = recipe.itemKey > 0 ? `${mark} **[${label}](${wowheadItemUrl(recipe.itemKey)})** — ${who}` : `• **${label}** — ${who}`;
    if (used + line.length + 1 > DESCRIPTION_LIMIT - 160) { omitted++; continue; }
    rows.push(line); used += line.length + 1;
  }
  const recipesTitle = post.recipes.length ? `

**${t("Recipes", "Recettes")}** (${post.recipes.length}) — ${t("pick one below to request it or see its details", "choisissez-en une ci-dessous pour la demander ou voir ses détails")}
` : "";
  const more = omitted ? `
${t(`…and ${omitted} more recipes. Search them with /craft who or on the Artisans' Gallery.`, `…et ${omitted} autres recettes. Cherchez-les avec /craft who ou dans la Galerie des artisans.`)}` : "";
  const empty = post.recipes.length ? "" : `

${t("No recipe recorded yet. Open this profession's window in game with Guilded to add yours.", "Aucune recette enregistrée. Ouvrez la fenêtre de ce métier en jeu avec Guilded pour ajouter les vôtres.")}`;
  const gallery = siteUrl ? `
${t("Gallery", "Galerie")}: ${new URL("/me/artisans", siteUrl).href}` : "";
  return new EmbedBuilder().setColor(0xd4af37).setTitle(professionTitle(post.profession, lang).slice(0, 256))
    .setDescription(`${header}${recipesTitle}${rows.join("\n")}${more}${empty}${gallery}`.slice(0, 4096))
    .setFooter({ text: `${PROFESSION_POST_MARKER} • ${guildId} • ${t("recipes come from members' profession scans · last seen from the guild roster", "recettes tirées des relevés de métiers · dernière présence selon le registre de guilde")}`.slice(0, 2048) });
}

/** Who knows one recipe, with skill and last seen, for the picker's reply. */
export async function recipeCrafters(db: Db, guildId: string, itemKey: number): Promise<{ itemName: string; profession: string; crafters: { character: string; skill: number | null; lastSeen: Date | null }[] } | null> {
  for (const post of await loadProfessionPosts(db, guildId)) {
    const recipe = post.recipes.find(candidate => candidate.itemKey === itemKey);
    if (!recipe) continue;
    const skill = new Map(post.skilled.map(row => [key(row.character), row.skillLevel]));
    return { itemName: recipe.itemName, profession: post.profession, crafters: recipe.crafters.map(crafter => ({ character: crafter.character, skill: skill.get(key(crafter.character)) ?? null, lastSeen: crafter.lastSeen })) };
  }
  return null;
}

/** The forum's profession posts by thread (title starts with the marker emoji); archived ones are opened. */
async function existingPosts(forum: ForumChannel): Promise<Map<string, ThreadChannel>> {
  const active = await forum.threads.fetchActive();
  const archived = await forum.threads.fetchArchived({ limit: 100 }).catch(() => null);
  const found = new Map<string, ThreadChannel>();
  for (const thread of new Map([...(archived?.threads ?? []), ...active.threads]).values()) {
    if (thread.name.startsWith(THREAD_PREFIX)) found.set(pkey(thread.name.slice(THREAD_PREFIX.length)), thread);
  }
  return found;
}

/** The forum thread title of a profession post, in the guild's language (found again under any spelling by its canonical name). */
export const threadTitle = (profession: string, lang: Lang): string => `${THREAD_PREFIX}${professionName(profession, lang)}`.slice(0, 100);

/** Thread ids of the profession posts, for the directory's links. */
export async function professionPostLinks(forum: ForumChannel): Promise<Map<string, string>> {
  return new Map([...(await existingPosts(forum))].map(([profession, thread]) => [profession, thread.id]));
}

/**
 * Edits each profession's post in place; creates a missing one only when the profession has people and (during the
 * 8.5 preview) the server is allowed. Never throws. Returns how many posts were written.
 */
export async function updateProfessionPosts(discordGuild: DiscordGuild, forum: ForumChannel, db: PrismaClient, guildId: string, lang: Lang, now = new Date(), items: ItemDataProvider = nullItemDataProvider): Promise<number> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { professionPostsEnabled: true } });
  if (!settings?.professionPostsEnabled) return 0;
  const siteUrl = process.env["PUBLIC_SITE_URL"]?.trim() || undefined;
  let written = 0;
  try {
    const existing = await existingPosts(forum);
    // Thread titles are in the guild's language like the tags, the directory and the post's own title (a French server saw
    // the thread "📚 Cooking" next to the tag and the post titled "Cuisine"). Discord limits renames of one channel, so
    // at most one thread is renamed per refresh; the others follow on the next ones.
    let renamed = 0;
    const names = await loadFullNameBook(db, guildId);
    const posts = await loadProfessionPosts(db, guildId, names);
    await addItemQuality(posts, items);
    for (const post of posts) {
      if (!post.skilled.length && !post.recipes.length) continue;
      const details = professionDetailsRow(post, lang);
      const payload = { embeds: [professionPostEmbed(post, lang, guildId, now, siteUrl)], components: details ? [details] : [], allowedMentions: { parse: [] as never[] } };
      const thread = existing.get(pkey(post.profession));
      if (thread) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter?.editable) continue;
        if (thread.archived) await thread.setArchived(false).catch(() => undefined);
        const title = threadTitle(post.profession, lang);
        if (thread.name !== title && renamed < 1 && typeof thread.setName === "function") { renamed++; await thread.setName(title).catch(() => undefined); }
        await starter.edit(payload);
        written++;
      } else {
        await forum.threads.create({ name: threadTitle(post.profession, lang), message: payload });
        written++;
      }
    }
  } catch (error) { console.warn("Profession posts refresh failed", error); }
  return written;
}
