import { cleanCharacterName } from "./character-display.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import type { Client } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { AddonCooldownSet, AddonRecipeSet } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";
import { byLastSeen, lastSeenOf, lastSeenText } from "./last-seen.js";
import type { Lang } from "../i18n.js";
import { normalizeProfessionName } from "./profession-names.js";

// Who can craft what, and profession cooldowns. The addon reads them when a player opens a
// profession window (/guilded recipes), shares them with the guild, and the companion's
// export brings them here.

type Tx = Pick<Prisma.TransactionClient, "recipeKnown" | "professionCooldown" | "character" | "unclaimedCharacter">;
type Db = Pick<PrismaClient, "recipeKnown" | "professionCooldown" | "character">;

// Recipe keys are item ids, or minus a spell id for enchants.
export function fallbackName(key: number): string {
  return key > 0 ? `Item ${key}` : `Enchant ${-key}`;
}
const isFallbackName = (name: string) => /^(Item|Enchant) \d+$/.test(name);

export interface RecipeImportInput {
  recipes: AddonRecipeSet[];
  recipeNames: Record<string, string>;
  cooldowns: AddonCooldownSet[];
}

export async function applyRecipeData(tx: Tx, guildId: string, input: RecipeImportInput): Promise<{ recipeSets: number; recipes: number; cooldownSets: number }> {
  const summary = { recipeSets: 0, recipes: 0, cooldownSets: 0 };
  const characters = input.recipes.length || input.cooldowns.length ? await tx.character.findMany({
    where: { member: { guildId } }, select: { name: true, realm: true, professionsUpdatedAt: true, professions: { select: { profession: true } } }
  }) : [];
  const unclaimed = input.recipes.length || input.cooldowns.length ? await tx.unclaimedCharacter.findMany({
    where: { guildId }, select: { name: true, realm: true, professionsUpdatedAt: true, professions: true }
  }) : [];
  const unclaimedSkills = unclaimed.map((row) => ({ ...row, professions: (Array.isArray(row.professions) ? row.professions : [])
    .flatMap((skill) => skill && typeof skill === "object" && "name" in skill && typeof skill["name"] === "string" ? [{ profession: skill["name"] }] : []) }));
  const dropped = (character: string, realm: string, profession: string, at: Date) => {
    const linked = findCharacter(characters, character, realm) ?? findCharacter(unclaimedSkills, character, realm);
    return !!linked?.professionsUpdatedAt && linked.professionsUpdatedAt >= at
      && !linked.professions.some((skill) => normalizeProfessionName(skill.profession).toLowerCase() === normalizeProfessionName(profession).toLowerCase());
  };

  // One read of what is stored for every character in the upload, one delete and one insert for everything that is newer
  // (it was a newest-check, a read, a delete and an insert per profession: thousands of statements for a guild's upload).
  const tupleKey = (owner: string, realm: string, profession: string) => [owner, realm, profession].join("|");
  const recipeSets = input.recipes.map((rawSet) => ({ ...rawSet, profession: normalizeProfessionName(rawSet.profession) }));
  const recipeOwners = [...new Set(recipeSets.map((set) => set.character))];
  const storedRecipes = recipeOwners.length ? await tx.recipeKnown.findMany({
    where: { guildId, character: { in: recipeOwners } }, select: { character: true, realm: true, profession: true, itemKey: true, itemName: true, scannedAt: true }
  }) : [];
  const newestRecipe = new Map<string, number>();
  const knownNames = new Map<string, Map<number, string>>();
  for (const row of storedRecipes) {
    const key = tupleKey(row.character, row.realm, row.profession);
    newestRecipe.set(key, Math.max(newestRecipe.get(key) ?? 0, row.scannedAt.getTime()));
    if (!isFallbackName(row.itemName)) { const names = knownNames.get(key) ?? new Map<number, string>(); names.set(row.itemKey, row.itemName); knownNames.set(key, names); }
  }
  // The last accepted list per (character, realm, profession) is the one written; each accepted list counts, as before.
  const recipeWrites = new Map<string, { set: (typeof recipeSets)[number]; keys: number[] }>();
  for (const set of recipeSets) {
    if (dropped(set.character, set.realm, set.profession, set.at)) continue;
    const key = tupleKey(set.character, set.realm, set.profession);
    const newest = newestRecipe.get(key);
    if (newest !== undefined && newest >= set.at.getTime()) continue;
    const keys = [...new Set(set.keys)];
    recipeWrites.set(key, { set, keys });
    newestRecipe.set(key, set.at.getTime());
    summary.recipeSets++;
    summary.recipes += keys.length;
  }
  const writes = [...recipeWrites.entries()];
  for (let from = 0; from < writes.length; from += 200) {
    await tx.recipeKnown.deleteMany({ where: { guildId, OR: writes.slice(from, from + 200).map(([, { set }]) => ({ character: set.character, realm: set.realm, profession: set.profession })) } });
  }
  const rows = writes.flatMap(([key, { set, keys }]) => keys.map((itemKey) => ({
    guildId, character: set.character, realm: set.realm, profession: set.profession, itemKey, scannedAt: set.at,
    itemName: (input.recipeNames[String(itemKey)] ?? knownNames.get(key)?.get(itemKey) ?? fallbackName(itemKey)).trim().slice(0, 100)
  })));
  for (let from = 0; from < rows.length; from += 2_000) await tx.recipeKnown.createMany({ data: rows.slice(from, from + 2_000), skipDuplicates: true });

  // Names learned later fill in placeholders of recipes stored earlier (by anyone).
  if (Object.keys(input.recipeNames).length > 0) {
    const placeholders = await tx.recipeKnown.findMany({
      where: { guildId, OR: [{ itemName: { startsWith: "Item " } }, { itemName: { startsWith: "Enchant " } }] },
      distinct: ["itemKey"], select: { itemKey: true, itemName: true }
    });
    for (const row of placeholders) {
      const name = input.recipeNames[String(row.itemKey)]?.trim();
      if (!name || !isFallbackName(row.itemName)) continue;
      await tx.recipeKnown.updateMany({ where: { guildId, itemKey: row.itemKey, itemName: row.itemName }, data: { itemName: name.slice(0, 100) } });
    }
  }

  const cooldownSets = input.cooldowns.map((rawSet) => ({ ...rawSet, entries: rawSet.entries.map((entry) => ({ ...entry, profession: normalizeProfessionName(entry.profession) })) }));
  const cooldownOwners = [...new Set(cooldownSets.map((set) => set.character))];
  const storedCooldowns = cooldownOwners.length ? await tx.professionCooldown.findMany({ where: { guildId, character: { in: cooldownOwners } } }) : [];
  const ownerKey = (owner: string, realm: string) => [owner, realm].join("|");
  const newestCooldown = new Map<string, number>();
  for (const row of storedCooldowns) { const key = ownerKey(row.character, row.realm); newestCooldown.set(key, Math.max(newestCooldown.get(key) ?? 0, row.scannedAt.getTime())); }
  const cooldownWrites = new Map<string, (typeof cooldownSets)[number]>();
  for (const set of cooldownSets) {
    const key = ownerKey(set.character, set.realm);
    const newest = newestCooldown.get(key);
    if (newest !== undefined && newest >= set.at.getTime()) continue;
    cooldownWrites.set(key, set);
    newestCooldown.set(key, set.at.getTime());
    summary.cooldownSets++;
  }
  const cooldownList = [...cooldownWrites.values()];
  for (let from = 0; from < cooldownList.length; from += 200) {
    await tx.professionCooldown.deleteMany({ where: { guildId, OR: cooldownList.slice(from, from + 200).map((set) => ({ character: set.character, realm: set.realm })) } });
  }
  const storedByCooldown = new Map(storedCooldowns.map((row) => [[row.character, row.realm, row.profession, row.name].join("|"), row] as const));
  const cooldownRows = cooldownList.flatMap((set) => set.entries.filter((entry) => !dropped(set.character, set.realm, entry.profession, set.at)).map((entry) => {
    // The same cooldown seen again keeps its "already pinged" mark.
    const old = storedByCooldown.get([set.character, set.realm, entry.profession, entry.name].join("|"));
    const same = old && Math.abs(old.readyAt.getTime() - entry.readyAt.getTime()) < 5 * 60_000;
    return { guildId, character: set.character, realm: set.realm, profession: entry.profession, name: entry.name, readyAt: entry.readyAt, scannedAt: set.at, notifiedAt: same ? old.notifiedAt : null };
  }));
  for (let from = 0; from < cooldownRows.length; from += 2_000) await tx.professionCooldown.createMany({ data: cooldownRows.slice(from, from + 2_000), skipDuplicates: true });
  return summary;
}

// ---------------------------------------------------------------------
// /craft who
// ---------------------------------------------------------------------

export interface CrafterMatch {
  itemKey: number;
  itemName: string;
  crafters: { character: string; profession: string; member: string | null; lastSeen: Date | null }[];
}

export async function findCrafters(database: Db, guildId: string, query: string): Promise<CrafterMatch[]> {
  const text = query.trim();
  if (!text) return [];
  const where: Prisma.RecipeKnownWhereInput = /^-?\d+$/.test(text)
    ? { guildId, itemKey: Number(text) }
    : { guildId, itemName: { contains: text, mode: "insensitive" } };
  const rows = await database.recipeKnown.findMany({ where, orderBy: [{ itemName: "asc" }, { character: "asc" }], take: 400 });
  if (rows.length === 0) return [];
  const characters = await database.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, lastSeenAt: true, member: { select: { displayName: true } } } });
  const byItem = new Map<number, CrafterMatch>();
  for (const row of rows) {
    const match = byItem.get(row.itemKey) ?? { itemKey: row.itemKey, itemName: row.itemName, crafters: [] };
    const linked = findCharacter(characters, row.character, row.realm);
    match.crafters.push({ character: row.character, profession: row.profession, member: linked?.member.displayName ?? null, lastSeen: lastSeenOf(linked?.lastSeenAt, row.scannedAt) });
    byItem.set(row.itemKey, match);
  }
  // Recently seen crafters first (the sort is stable, so ties keep the name order).
  for (const match of byItem.values()) match.crafters.sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen));
  return [...byItem.values()];
}

export function describeCrafters(query: string, matches: CrafterMatch[], lang: Lang = "en", now: Date = new Date()): string {
  if (matches.length === 0) {
    return lang === "fr" ? `Personne n'est connu pour « ${query.trim()} » pour l'instant. Les recettes apparaissent dès qu'un membre ouvre ce métier en jeu.`
      : `Nobody known for "${query.trim()}" yet. Recipes appear once a member opens that profession in game.`;
  }
  const lines = matches.slice(0, 8).map((match) => {
    const who = match.crafters.map((crafter) => `${cleanCharacterName(crafter.character)}${crafter.member && crafter.member.toLowerCase() !== crafter.character.toLowerCase() ? ` (${crafter.member})` : ""} · ${crafter.profession} · ${lang === "fr" ? "vu" : "seen"} ${lastSeenText(crafter.lastSeen, lang, now)}`);
    return `• **${match.itemName}** — ${who.join(", ")}`;
  });
  if (matches.length > 8) lines.push(`…and ${matches.length - 8} more matches. Type more of the name.`);
  const text = lines.join("\n");
  return text.length > 1900 ? `${text.slice(0, 1890)}\n…` : text;
}

// Item names for /craft who autocomplete.
export async function recipeNameSuggestions(database: Pick<PrismaClient, "recipeKnown">, guildId: string, query: string): Promise<{ name: string; value: string }[]> {
  const rows = await database.recipeKnown.findMany({
    where: { guildId, itemName: { contains: query.trim(), mode: "insensitive" } },
    distinct: ["itemName"], select: { itemName: true }, orderBy: { itemName: "asc" }, take: 25
  });
  return rows.map((row) => ({ name: row.itemName.slice(0, 100), value: row.itemName.slice(0, 100) }));
}

// ---------------------------------------------------------------------
// Cooldowns
// ---------------------------------------------------------------------

const STALE_MS = 7 * 24 * 3_600_000;

export async function describeCooldowns(database: Db, guildId: string, options: { characters?: string[]; now?: Date } = {}): Promise<string> {
  const now = options.now ?? new Date();
  const rows = await database.professionCooldown.findMany({
    where: { guildId, readyAt: { gt: new Date(now.getTime() - STALE_MS) } },
    orderBy: [{ readyAt: "asc" }, { character: "asc" }],
    take: 200
  });
  const wanted = options.characters ? new Set(options.characters.map((name) => name.toLowerCase())) : null;
  const shown = wanted ? rows.filter((row) => wanted.has(row.character.toLowerCase())) : rows;
  if (shown.length === 0) {
    return wanted ? "None of your characters has a profession cooldown on record." : "No profession cooldowns are known yet. They are read when a player with the addon opens their profession window.";
  }
  const lines = shown.map((row) => {
    const when = row.readyAt <= now ? "**ready**" : `<t:${Math.floor(row.readyAt.getTime() / 1000)}:R>`;
    return `• ${cleanCharacterName(row.character)} — ${row.name} (${row.profession}): ${when}`;
  });
  const text = `**Profession cooldowns**\n${lines.join("\n")}`;
  return text.length > 1900 ? `${text.slice(0, 1890)}\n…` : text;
}

// Called on a timer from main.ts. DMs members who asked for it (/profession cooldowns notify)
// once when a cooldown of theirs becomes ready. Cooldowns that were ready long ago are skipped.
export async function runCooldownPings(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  const due = await database.professionCooldown.findMany({
    where: { ...pilotGuildScope, notifiedAt: null, readyAt: { lte: now, gt: new Date(now.getTime() - 24 * 3_600_000) } },
    include: { guild: true }
  });
  if (due.length === 0) return 0;
  const characters = await database.character.findMany({
    where: { member: { cooldownPings: true, status: "ACTIVE", guildId: { in: [...new Set(due.map((row) => row.guildId))] } } },
    select: { name: true, realm: true, member: { select: { guildId: true, discordUserId: true } } }
  });
  const perUser = new Map<string, string[]>();
  const marked: string[] = [];
  for (const row of due) {
    const owner = findCharacter(characters.filter((character) => character.member.guildId === row.guildId), row.character, row.realm);
    if (!owner) continue;
    marked.push(row.id);
    const lines = perUser.get(owner.member.discordUserId) ?? [];
    lines.push(`• ${cleanCharacterName(row.character)} — ${row.name} (${row.profession}) is ready`);
    perUser.set(owner.member.discordUserId, lines);
  }
  // Mark first so a Discord hiccup can never cause repeated messages.
  if (marked.length > 0) await database.professionCooldown.updateMany({ where: { id: { in: marked } }, data: { notifiedAt: now } });
  let sent = 0;
  for (const [userId, lines] of perUser) {
    await client.users.send(userId, `**Profession cooldown ready**\n${lines.join("\n")}`).then(() => { sent++; }).catch(() => undefined);
  }
  return sent;
}
