import type { Client } from "discord.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AddonCooldownSet, AddonRecipeSet } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";

// Who can craft what, and profession cooldowns. The addon reads them when a player opens a
// profession window (/guilded recipes), shares them with the guild, and the companion's
// export brings them here.

type Tx = Pick<Prisma.TransactionClient, "recipeKnown" | "professionCooldown" | "character">;
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
  const dropped = (character: string, realm: string, profession: string, at: Date) => {
    const linked = findCharacter(characters, character, realm);
    return !!linked?.professionsUpdatedAt && linked.professionsUpdatedAt >= at
      && !linked.professions.some((skill) => skill.profession.toLowerCase() === profession.toLowerCase());
  };

  for (const set of input.recipes) {
    if (dropped(set.character, set.realm, set.profession, set.at)) continue;
    const where = { guildId, character: set.character, realm: set.realm, profession: set.profession };
    const newest = await tx.recipeKnown.aggregate({ where, _max: { scannedAt: true } });
    if (newest._max.scannedAt && newest._max.scannedAt >= set.at) continue;
    // Names arrive when the exporting game knew them; keep an older real name over a placeholder.
    const before = await tx.recipeKnown.findMany({ where, select: { itemKey: true, itemName: true } });
    const known = new Map(before.filter((row) => !isFallbackName(row.itemName)).map((row) => [row.itemKey, row.itemName]));
    await tx.recipeKnown.deleteMany({ where });
    const keys = [...new Set(set.keys)];
    if (keys.length > 0) {
      await tx.recipeKnown.createMany({
        data: keys.map((key) => ({
          ...where, itemKey: key, scannedAt: set.at,
          itemName: (input.recipeNames[String(key)] ?? known.get(key) ?? fallbackName(key)).trim().slice(0, 100)
        })),
        skipDuplicates: true
      });
    }
    summary.recipeSets++;
    summary.recipes += keys.length;
  }

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

  for (const set of input.cooldowns) {
    const where = { guildId, character: set.character, realm: set.realm };
    const newest = await tx.professionCooldown.aggregate({ where, _max: { scannedAt: true } });
    if (newest._max.scannedAt && newest._max.scannedAt >= set.at) continue;
    const before = await tx.professionCooldown.findMany({ where });
    await tx.professionCooldown.deleteMany({ where });
    const entries = set.entries.filter((entry) => !dropped(set.character, set.realm, entry.profession, set.at));
    if (entries.length > 0) {
      await tx.professionCooldown.createMany({
        data: entries.map((entry) => {
          // The same cooldown seen again keeps its "already pinged" mark.
          const old = before.find((row) => row.profession === entry.profession && row.name === entry.name);
          const same = old && Math.abs(old.readyAt.getTime() - entry.readyAt.getTime()) < 5 * 60_000;
          return { ...where, profession: entry.profession, name: entry.name, readyAt: entry.readyAt, scannedAt: set.at, notifiedAt: same ? old.notifiedAt : null };
        }),
        skipDuplicates: true
      });
    }
    summary.cooldownSets++;
  }
  return summary;
}

// ---------------------------------------------------------------------
// /craft who
// ---------------------------------------------------------------------

export interface CrafterMatch {
  itemKey: number;
  itemName: string;
  crafters: { character: string; profession: string; member: string | null }[];
}

export async function findCrafters(database: Db, guildId: string, query: string): Promise<CrafterMatch[]> {
  const text = query.trim();
  if (!text) return [];
  const where: Prisma.RecipeKnownWhereInput = /^-?\d+$/.test(text)
    ? { guildId, itemKey: Number(text) }
    : { guildId, itemName: { contains: text, mode: "insensitive" } };
  const rows = await database.recipeKnown.findMany({ where, orderBy: [{ itemName: "asc" }, { character: "asc" }], take: 400 });
  if (rows.length === 0) return [];
  const characters = await database.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, member: { select: { displayName: true } } } });
  const byItem = new Map<number, CrafterMatch>();
  for (const row of rows) {
    const match = byItem.get(row.itemKey) ?? { itemKey: row.itemKey, itemName: row.itemName, crafters: [] };
    const linked = findCharacter(characters, row.character, row.realm);
    match.crafters.push({ character: row.character, profession: row.profession, member: linked?.member.displayName ?? null });
    byItem.set(row.itemKey, match);
  }
  return [...byItem.values()];
}

export function describeCrafters(query: string, matches: CrafterMatch[]): string {
  if (matches.length === 0) {
    return `Nobody is known to craft "${query.trim()}". Only players with the addon who opened their profession window show up, and it reaches Discord when the companion uploads.`;
  }
  const lines = matches.slice(0, 8).map((match) => {
    const who = match.crafters.map((crafter) => `${crafter.character}${crafter.member && crafter.member.toLowerCase() !== crafter.character.toLowerCase() ? ` (${crafter.member})` : ""} · ${crafter.profession}`);
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
    return `• ${row.character} — ${row.name} (${row.profession}): ${when}`;
  });
  const text = `**Profession cooldowns**\n${lines.join("\n")}`;
  return text.length > 1900 ? `${text.slice(0, 1890)}\n…` : text;
}

// Called on a timer from main.ts. DMs members who asked for it (/profession cooldowns notify)
// once when a cooldown of theirs becomes ready. Cooldowns that were ready long ago are skipped.
export async function runCooldownPings(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  const due = await database.professionCooldown.findMany({
    where: { notifiedAt: null, readyAt: { lte: now, gt: new Date(now.getTime() - 24 * 3_600_000) } },
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
    lines.push(`• ${row.character} — ${row.name} (${row.profession}) is ready`);
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
