import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { displayCharacterName, fullNameBook } from "./character-display.js";
import type { ItemDataProvider } from "./item-preview-data.js";
import { sanitizeName, type WebhookEmbed } from "./item-preview-embed.js";
import { canonicalProfession, professionName, professionTitle, skillBar } from "./profession-style.js";

// Owner request (7 November 2026): when a member links their profession in the WoW-linked chat channel, the
// Discord-only preview path (docs/ITEM_PREVIEWS.md) also posts a small card with that character's known recipes, from
// Guilded's synced profession data. Nothing is posted when the linker is not one known guild character or we have no
// recipes for them. Like item links, nothing is ever sent back into WoW.
//
// Shapes understood (scanned with indexOf and caps, no regex over the message):
//   raw link    |cffffd000|Htrade:Player-1-0ABC:3908:197|h[Tailoring]|h|r  -> verified profession link
//   bracket     [Tailoring] / [Couture]                                     -> only when it is the message's ONLY
//                                                                              bracket and an exact profession name
// The fields after "trade:" differ between game versions; only the bracketed name is used.

export interface ProfessionLinkHit { profession: string; verified: boolean }
const MAX_SCAN = 2000, MAX_LINKS = 2;

export function parseProfessionLinks(input: string): ProfessionLinkHit[] {
  const text = input.length > MAX_SCAN ? input.slice(0, MAX_SCAN) : input;
  const lower = text.toLowerCase();
  const found: ProfessionLinkHit[] = [];
  let cursor = 0;
  while (found.length < MAX_LINKS) {
    const start = lower.indexOf("|htrade:", cursor);
    if (start < 0) break;
    cursor = start + 8;
    const open = text.indexOf("|h[", start);
    if (open < 0 || open - start > 200) continue;
    const close = text.indexOf("]|h", open + 3);
    if (close < 0 || close - open > 40) continue;
    const profession = canonicalProfession(text.slice(open + 3, close));
    cursor = close + 3;
    if (profession && !found.some(hit => hit.profession === profession)) found.push({ profession, verified: true });
  }
  if (found.length || lower.includes("|htrade:")) return found;
  // Name-only, conservatively: exactly one bracket in the whole message, and it is exactly a profession name.
  const open = text.indexOf("[");
  if (open < 0 || text.indexOf("[", open + 1) >= 0) return [];
  const close = text.indexOf("]", open + 1);
  if (close < 0 || close - open > 40) return [];
  const profession = canonicalProfession(text.slice(open + 1, close));
  return profession ? [{ profession, verified: false }] : [];
}

/** True for a bracket the item scanner should leave to the profession card (`[Tailoring]` is not an item). */
export const isProfessionName = (name: string) => canonicalProfession(name) !== undefined;

/**
 * Names the linker may be known by: the relay's author name (a webhook posts under the character's name), and a
 * leading "Name: " or "[Name]: " in the text. The caller adds the Discord member's own characters for a real user.
 */
export function linkerNames(authorName: string | null | undefined, content: string): string[] {
  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    const clean = (value ?? "").replace(/^\[|\]$/g, "").trim();
    if (clean.length >= 2 && clean.length <= 40 && !clean.includes("|")) names.add(clean);
  };
  add(authorName);
  const colon = content.indexOf(": ");
  const bracket = content.indexOf("|");
  if (colon > 0 && colon <= 42 && (bracket < 0 || colon < bracket)) add(content.slice(0, colon));
  return [...names];
}

export interface ProfessionCardData {
  character: string;
  /** Stored name, for the gallery search. */
  storedName: string;
  profession: string;
  skill: number | null;
  recipes: { itemKey: number; itemName: string; quality?: number }[];
  guildId: string;
  edition: string;
}

type Db = Pick<PrismaClient, "character" | "recipeKnown">;
const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The one guild character the linker is, with their recipes for this profession; null when none or several match, or
 * when there are no recipes. A real Discord member (not the relay) may also be matched through their own characters,
 * again only when exactly one of them knows recipes for this profession.
 */
export async function loadProfessionCard(db: Db, guild: { id: string; gameEdition: string }, profession: string, names: string[], discordUserId?: string): Promise<ProfessionCardData | null> {
  const people = await db.character.findMany({ where: { member: { guildId: guild.id, status: "ACTIVE", isTest: false } },
    select: { name: true, displayName: true, member: { select: { discordUserId: true } }, professions: { select: { profession: true, skillLevel: true } } }, take: 3_000 });
  const book = fullNameBook(people);
  const wanted = new Set(names.map(key));
  const known = (person: typeof people[number]) => [person.name, person.displayName ?? "", displayCharacterName(person.name, book)].map(key);
  let matches = people.filter(person => known(person).some(name => wanted.has(name)));
  const rows = await db.recipeKnown.findMany({ where: { guildId: guild.id, OR: [{ profession: { equals: profession, mode: "insensitive" } }, { profession: { equals: professionName(profession, "fr"), mode: "insensitive" } }] },
    select: { character: true, itemKey: true, itemName: true }, orderBy: { itemName: "asc" }, take: 5_000 });
  const recipesOf = (person: typeof people[number]) => {
    const names = new Set(known(person));
    const seen = new Set<number>();
    return rows.filter(row => names.has(key(row.character)) && !seen.has(row.itemKey) && seen.add(row.itemKey));
  };
  if (!matches.length && discordUserId) matches = people.filter(person => person.member.discordUserId === discordUserId && recipesOf(person).length > 0);
  if (matches.length !== 1) return null;
  const person = matches[0]!;
  const recipes = recipesOf(person);
  if (!recipes.length) return null;
  const skill = person.professions.find(row => canonicalProfession(row.profession) === profession)?.skillLevel ?? null;
  return { character: displayCharacterName(person.name, book), storedName: person.name, profession, skill, guildId: guild.id, edition: guild.gameEdition,
    recipes: recipes.map(row => ({ itemKey: row.itemKey, itemName: row.itemName })) };
}

const QUALITY_COLOR = [0x9d9d9d, 0xffffff, 0x1eff00, 0x0070dd, 0xa335ee, 0xff8000];
const QUALITY_SQUARES = ["⬛", "⬜", "🟩", "🟦", "🟪", "🟧"];
export const CARD_RECIPES = 8, MAX_QUALITY_LOOKUPS = 60;

/** Fills the quality of up to MAX_QUALITY_LOOKUPS crafted items (enchants are spells and are skipped). */
export async function addCardQualities(card: ProfessionCardData, items: ItemDataProvider): Promise<void> {
  await Promise.all(card.recipes.filter(recipe => recipe.itemKey > 0).slice(0, MAX_QUALITY_LOOKUPS).map(async recipe => {
    const found = await items.lookup({ itemId: recipe.itemKey, name: recipe.itemName, verified: true }).catch(() => null);
    if (found?.quality !== undefined) recipe.quality = found.quality;
  }));
}

/** The compact card: profession and skill, the most notable recipes (best quality first), a count and the gallery link. */
export function professionCardEmbed(card: ProfessionCardData, lang: Lang = "en", siteUrl?: string): WebhookEmbed {
  const fr = lang === "fr";
  const sorted = [...card.recipes].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1) || a.itemName.localeCompare(b.itemName));
  const lines = sorted.slice(0, CARD_RECIPES).map(recipe => {
    const name = sanitizeName(recipe.itemName, 60);
    const mark = recipe.quality !== undefined ? QUALITY_SQUARES[recipe.quality] ?? "•" : "•";
    return recipe.itemKey > 0 ? `${mark} [${name}](https://www.wowhead.com/classic/item=${recipe.itemKey})` : `• ${name}`;
  });
  const head = card.skill !== null ? `${skillBar(card.skill, 8)} ${card.skill}` : fr ? "Compétence inconnue" : "Skill unknown";
  const count = fr ? `${card.recipes.length} recette(s) connue(s)` : `${card.recipes.length} known recipe(s)`;
  const more = card.recipes.length > CARD_RECIPES ? (fr ? `\n+${card.recipes.length - CARD_RECIPES} autres` : `\n+${card.recipes.length - CARD_RECIPES} more`) : "";
  const gallery = siteUrl ? new URL(`/me/artisans?${new URLSearchParams({ guild: card.guildId, edition: card.edition, q: card.storedName, lang }).toString()}`, siteUrl).href : undefined;
  const best = sorted[0]?.quality;
  const embed: WebhookEmbed = {
    title: `${professionTitle(card.profession, lang)} · ${sanitizeName(card.character, 60)}`.slice(0, 256),
    description: `${head} · ${count}\n${lines.join("\n")}${more}${gallery ? `\n[${fr ? "Liste complète (Galerie des artisans)" : "Full list (Artisans' Gallery)"}](${gallery})` : ""}`.slice(0, 2000),
    color: best !== undefined && QUALITY_COLOR[best] !== undefined && best >= 2 ? QUALITY_COLOR[best]! : 0xd4af37,
    footer: { text: fr ? "Recettes tirées des relevés de métiers Guilded" : "Recipes from Guilded's profession scans" }
  };
  if (gallery) embed.url = gallery;
  return embed;
}
