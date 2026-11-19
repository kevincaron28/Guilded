import { type ForumChannel, type Guild as DiscordGuild, type ThreadChannel } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { byLastSeen, lastSeenOf } from "./last-seen.js";
import { professionName } from "./profession-style.js";
import { professionDetailsRow } from "./profession-details.js";
import { normalizeProfessionName, professionSlug } from "./profession-names.js";
import { displayCharacterName, emptyNameBook, loadFullNameBook, type FullNameBook } from "./character-display.js";
import { nullItemDataProvider, type ItemDataProvider } from "./item-preview-data.js";
import { categoryOf } from "./recipe-categories.js";
import { createHash } from "node:crypto";
import { professionCategoryMessages, professionSummaryEmbed, type CategoryMessage } from "./profession-messages.js";

// 8.5 track D2: ONE post per profession in the craft forum, edited in place (the duel-board pattern), listing every
// recipe and the crafters who know it with their last seen. It replaces the old "top 3 per profession" directory
// text. On by default (GuildSettings.professionPostsEnabled); an officer can switch it off with /config craft posts.
// Posts are found by their thread title + embed footer, so no message id is stored. Nothing is ever awarded.

export const PROFESSION_POST_MARKER = "Guilded profession board";
const THREAD_PREFIX = "📚 ";

export interface ProfessionRecipe {
  itemKey: number; itemName: string; crafters: { character: string; lastSeen: Date | null }[];
  /** Quality 0-5 of the crafted item, from the item data source (docs/plans/ITEM_LINKS.md); absent when unknown. */
  quality?: number;
  /** 9.4 T6: equip slot and item subclass from the item data source (cached), and the category key derived from them (recipe-categories.ts). */
  slot?: string; type?: string; category?: string;
}
/** One square per item quality, so a long list stays one line per recipe (Poor … Legendary). */
export const QUALITY_SQUARES = ["⬛", "⬜", "🟩", "🟦", "🟪", "🟧"];
export const wowheadItemUrl = (itemId: number) => `https://www.wowhead.com/classic/item=${itemId}`;

// Item slot/type per item id, kept for the life of the process so the Details menu (which does not look items up) groups
// recipes like the post does. Bounded; an item the source never answered is grouped by its name alone.
const FACTS = new Map<number, { slot?: string; type?: string }>();
const MAX_FACTS = 5000;

/** Sets each recipe's category from its name and, when known, its cached item slot and type. */
export function assignCategories(posts: ProfessionPost[]): void {
  for (const post of posts) for (const recipe of post.recipes) {
    const facts = FACTS.get(recipe.itemKey);
    if (facts?.slot && !recipe.slot) recipe.slot = facts.slot;
    if (facts?.type && !recipe.type) recipe.type = facts.type;
    recipe.category = categoryOf(post.profession, recipe);
  }
}

/** Fills each crafted item's quality (and slot/type for its category) from the item data source, one lookup per item (cached and rate-limited there). */
export async function addItemQuality(posts: ProfessionPost[], items: ItemDataProvider): Promise<void> {
  const seen = new Map<number, number | undefined>();
  for (const recipe of posts.flatMap(post => post.recipes)) {
    if (recipe.itemKey <= 0) continue; // enchants are spells, not items
    if (!seen.has(recipe.itemKey)) {
      const details = await items.lookup({ itemId: recipe.itemKey, name: recipe.itemName, verified: true }).catch(() => null);
      seen.set(recipe.itemKey, details?.quality);
      if (details?.facts && (details.facts.slot || details.facts.type)) {
        if (FACTS.size >= MAX_FACTS) FACTS.delete(FACTS.keys().next().value!);
        FACTS.set(recipe.itemKey, { ...(details.facts.slot ? { slot: details.facts.slot } : {}), ...(details.facts.type ? { type: details.facts.type } : {}) });
      }
    }
    const quality = seen.get(recipe.itemKey);
    if (quality !== undefined) recipe.quality = quality;
  }
  assignCategories(posts);
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
  const sorted = [...posts.values()].sort((a, b) => a.profession.localeCompare(b.profession));
  assignCategories(sorted);
  return sorted;
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
async function existingPosts(forum: ForumChannel, lang: Lang = "en"): Promise<Map<string, ThreadChannel>> {
  return (await sortedPosts(forum, lang)).chosen;
}

/**
 * Finds the profession threads under any spelling of the name. When one profession has more than one thread (a post made
 * as "Cooking" before the 9.1.2 key and another as "Cuisine" after it), the one to keep is the open one titled in the
 * guild's language, else any open one, else the archived ones; the others come back as duplicates.
 */
async function sortedPosts(forum: ForumChannel, lang: Lang): Promise<{ chosen: Map<string, ThreadChannel>; duplicates: ThreadChannel[] }> {
  const active = await forum.threads.fetchActive();
  const archived = await forum.threads.fetchArchived({ limit: 100 }).catch(() => null);
  const groups = new Map<string, ThreadChannel[]>();
  for (const thread of new Map([...(archived?.threads ?? []), ...active.threads]).values()) {
    if (!thread.name.startsWith(THREAD_PREFIX)) continue;
    const key = pkey(thread.name.slice(THREAD_PREFIX.length));
    groups.set(key, [...(groups.get(key) ?? []), thread]);
  }
  const chosen = new Map<string, ThreadChannel>();
  const duplicates: ThreadChannel[] = [];
  for (const [key, threads] of groups) {
    // The bot can only edit its own thread, so a thread it made is the keeper whatever its title; then open before archived, then the guild's language.
    const rank = (thread: ThreadChannel) => (isBotThread(forum, thread) ? 0 : 4) + (thread.archived ? 2 : 0) + (thread.name === threadTitle(thread.name.slice(THREAD_PREFIX.length), lang) ? 0 : 1);
    const ordered = [...threads].sort((a, b) => rank(a) - rank(b));
    chosen.set(key, ordered[0]!);
    duplicates.push(...ordered.slice(1));
  }
  return { chosen, duplicates };
}

const isBotThread = (forum: ForumChannel, thread: ThreadChannel): boolean => !!forum.client?.user?.id && thread.ownerId === forum.client.user.id;
const MAX_ARCHIVES_PER_REFRESH = 5;

/**
 * Archives the extra threads of a profession the bot itself made, so a French and an English post of one profession do not
 * both stay up. Never deletes anything and never touches a thread a member made. PROFESSION_DUPLICATES_DRY_RUN=true only logs.
 */
async function archiveDuplicates(forum: ForumChannel, duplicates: ThreadChannel[], kept: Map<string, ThreadChannel>, lang: Lang): Promise<number> {
  const dryRun = process.env["PROFESSION_DUPLICATES_DRY_RUN"] === "true";
  let done = 0;
  for (const thread of duplicates) {
    if (thread.archived) continue;
    const keeper = kept.get(pkey(thread.name.slice(THREAD_PREFIX.length)));
    // Only the bot's own thread, and only when the kept one is the bot's too: never archive the working thread in favour of a member's.
    const reason = !isBotThread(forum, thread) ? "not made by the bot, left alone" : !keeper || !isBotThread(forum, keeper) ? "the kept thread is not the bot's, left alone"
      : done >= MAX_ARCHIVES_PER_REFRESH ? "limit per refresh reached, left for the next one" : dryRun ? "dry run, would archive" : "";
    if (reason) { console.log(`Profession post duplicate "${thread.name}" (${thread.id}), keeping "${keeper?.name}" (${keeper?.id}): ${reason}`); continue; }
    const pointer = lang === "fr" ? `Ce métier est suivi dans <#${keeper!.id}>. Ce fil est archivé.` : `This profession is kept up to date in <#${keeper!.id}>. This thread is archived.`;
    await thread.send({ content: pointer, allowedMentions: { parse: [] as never[] } }).catch(() => undefined);
    const archived = await thread.setArchived(true).then(() => true, () => false);
    console.log(`Profession post duplicate "${thread.name}" (${thread.id}), keeping "${keeper!.name}" (${keeper!.id}): ${archived ? "archived" : "could not archive (missing permission?), left as it was"}`);
    if (archived) done++;
  }
  return done;
}

/** The forum thread title of a profession post, in the guild's language (found again under any spelling by its canonical name). */
export const threadTitle = (profession: string, lang: Lang): string => `${THREAD_PREFIX}${professionName(profession, lang)}`.slice(0, 100);

/** Thread ids of the profession posts, for the directory's links. */
export async function professionPostLinks(forum: ForumChannel, lang: Lang = "en"): Promise<Map<string, string>> {
  return new Map([...(await existingPosts(forum, lang))].map(([profession, thread]) => [profession, thread.id]));
}

const MAX_WRITES_PER_THREAD = 40;
const hashOf = (message: CategoryMessage): string => createHash("sha1").update(JSON.stringify({ e: message.embeds.map(embed => embed.toJSON()), c: message.components.map(row => row.toJSON()) })).digest("hex");

/**
 * Keeps one bot message per recipe category part in the profession's thread: creates the missing ones, edits only those whose
 * content changed (hash compare), deletes the ones whose category emptied. Returns each category's first message id (for the
 * starter's jump list), or null when the message store is unavailable. Never throws.
 */
export async function syncCategoryMessages(thread: ThreadChannel, db: PrismaClient, guildId: string, post: ProfessionPost, lang: Lang, now: Date): Promise<Map<string, string> | null> {
  const store = (db as Partial<PrismaClient>).professionPostMessage;
  if (!store) return null;
  const profession = pkey(post.profession);
  const firstMessage = new Map<string, string>();
  try {
    const rows = new Map((await store.findMany({ where: { guildId, profession } })).map(row => [row.slot, row]));
    const desired = professionCategoryMessages(post, lang, now);
    let writes = 0;
    for (const message of desired) {
      const row = rows.get(message.slot);
      const hash = hashOf(message);
      const payload = { embeds: message.embeds, components: message.components, allowedMentions: { parse: [] as never[] } };
      const own = row && row.threadId === thread.id ? row : null;
      if (own?.contentHash === hash) { if (!firstMessage.has(message.category)) firstMessage.set(message.category, own.messageId); continue; }
      if (writes >= MAX_WRITES_PER_THREAD) { if (own && !firstMessage.has(message.category)) firstMessage.set(message.category, own.messageId); continue; } // the rest follows on the next refresh
      writes++;
      let messageId: string | null = own?.messageId ?? null;
      if (messageId) {
        // 10008 = the message was deleted by hand: post it again. Any other failure keeps the old message for the next refresh.
        const edited = await thread.messages.edit(messageId, payload).then(() => true, (error: unknown) => (error as { code?: number })?.code === 10008 ? false : (console.warn("Profession category edit failed", error), null));
        if (edited === null) { if (!firstMessage.has(message.category)) firstMessage.set(message.category, messageId); continue; }
        if (!edited) messageId = null;
      }
      if (!messageId) {
        const sent = await thread.send(payload).catch((error: unknown) => { console.warn("Profession category post failed", error); return null; });
        if (!sent) continue;
        messageId = sent.id;
      }
      await store.upsert({ where: { guildId_profession_slot: { guildId, profession, slot: message.slot } }, create: { guildId, profession, slot: message.slot, threadId: thread.id, messageId, contentHash: hash }, update: { threadId: thread.id, messageId, contentHash: hash } });
      if (!firstMessage.has(message.category)) firstMessage.set(message.category, messageId);
    }
    const keep = new Set(desired.map(message => message.slot));
    const stale = [...rows.values()].filter(row => !keep.has(row.slot));
    for (const row of stale) if (row.threadId === thread.id) await thread.messages.delete(row.messageId).catch(() => undefined);
    if (stale.length) await store.deleteMany({ where: { guildId, profession, slot: { in: stale.map(row => row.slot) } } });
  } catch (error) { console.warn("Profession category messages failed", error); }
  return firstMessage;
}

/**
 * Edits each profession's post in place; creates a missing one only when the profession has people and (during the
 * 8.5 preview) the server is allowed. Never throws. Returns how many posts were written.
 */
export async function updateProfessionPosts(discordGuild: DiscordGuild, forum: ForumChannel, db: PrismaClient, guildId: string, lang: Lang, now = new Date(), items: ItemDataProvider = nullItemDataProvider): Promise<number> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { professionPostsEnabled: true } });
  if (!settings?.professionPostsEnabled) return 0;
  let written = 0;
  try {
    const found = await sortedPosts(forum, lang);
    const existing = found.chosen;
    await archiveDuplicates(forum, found.duplicates, existing, lang);
    // Thread titles are in the guild's language like the tags, the directory and the post's own title (a French server saw
    // the thread "📚 Cooking" next to the tag and the post titled "Cuisine"). Discord limits renames of one channel, so
    // at most one thread is renamed per refresh (counting only renames that worked, so a thread that cannot be renamed
    // does not block the others); the others follow on the next ones.
    let renamed = 0;
    const names = await loadFullNameBook(db, guildId);
    const posts = await loadProfessionPosts(db, guildId, names);
    await addItemQuality(posts, items);
    for (const post of posts) {
      if (!post.skilled.length && !post.recipes.length) continue;
      const details = professionDetailsRow(post, lang);
      const components = details ? [details] : [];
      const starterPayload = (jump: Parameters<typeof professionSummaryEmbed>[4] = null) => ({ embeds: [professionSummaryEmbed(post, lang, guildId, now, jump)], components, allowedMentions: { parse: [] as never[] } });
      const thread = existing.get(pkey(post.profession));
      if (thread) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter?.editable) continue;
        if (thread.archived) await thread.setArchived(false).catch(() => undefined);
        const title = threadTitle(post.profession, lang);
        if (thread.name !== title && renamed < 1 && typeof thread.setName === "function" && await thread.setName(title).then(() => true, () => false)) renamed++;
        const firstMessage = await syncCategoryMessages(thread, db, guildId, post, lang, now);
        await starter.edit(starterPayload(firstMessage ? { discordGuildId: discordGuild.id, threadId: thread.id, firstMessage } : null));
        written++;
      } else {
        const created = await forum.threads.create({ name: threadTitle(post.profession, lang), message: starterPayload() });
        written++;
        const firstMessage = await syncCategoryMessages(created, db, guildId, post, lang, now);
        if (firstMessage?.size) {
          const starter = await created.fetchStarterMessage().catch(() => null);
          await starter?.edit(starterPayload({ discordGuildId: discordGuild.id, threadId: created.id, firstMessage })).catch(() => undefined);
        }
      }
    }
  } catch (error) { console.warn("Profession posts refresh failed", error); }
  return written;
}
