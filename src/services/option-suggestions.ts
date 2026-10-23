import type { PrismaClient } from "@prisma/client";
import { AVAILABILITY, DURATIONS, EP_REASONS, GP_REASONS, PROFESSIONS, RACES, REVERSE_REASONS, SPECS, WEEKDAYS, pick } from "../wow-data.js";
import { formatRaidTime, parseRaidTime } from "./raid-time.js";

// What autocomplete offers for the free-text options of the slash commands.

export interface Suggestion { name: string; value: string }
type Db = Pick<PrismaClient, "character" | "characterAttunement" | "lootAward" | "wishlistEntry" | "tag" | "raid">;

export const raceSuggestions = (query: string) => pick(RACES, query);
export const professionSuggestions = (query: string) => pick(PROFESSIONS, query);
export const availabilitySuggestions = (query: string) => pick(AVAILABILITY, query);

// Specs for the class already chosen in the same command; every spec when none is.
export function specSuggestions(className: string | null, query: string): Suggestion[] {
  const known = className ? SPECS[className] : undefined;
  return pick(known ?? [...new Set(Object.values(SPECS).flat())], query);
}

export function reasonSuggestions(subcommand: string | null, query: string): Suggestion[] {
  return pick(subcommand === "award-gp" ? GP_REASONS : subcommand === "reverse" ? REVERSE_REASONS : EP_REASONS, query);
}

// Whole numbers of seconds, as people think of auction lengths.
export function durationSuggestions(query: string): { name: string; value: number }[] {
  const typed = Number(query);
  const list = DURATIONS.filter(([seconds, label]) => !query.trim() || label.includes(query.trim().toLowerCase()) || String(seconds).startsWith(query.trim()));
  const choices = list.map(([seconds, label]) => ({ name: label, value: seconds }));
  if (Number.isInteger(typed) && typed >= 1 && typed <= 86400 && !choices.some((choice) => choice.value === typed)) choices.unshift({ name: `${typed} seconds`, value: typed });
  return choices.slice(0, 25);
}

// "friday 8pm -> Fri, Oct 2, 8:00 PM": the value is what parseRaidTime understands,
// the label shows the moment it means in the guild's timezone.
export function timeSuggestions(query: string, timeZone: string, language: string, now = new Date()): Suggestion[] {
  const base = ["tonight 8pm", "tonight 9pm", "tomorrow 8pm", ...WEEKDAYS.flatMap((day) => [`${day} 8pm`, `${day} 9pm`])];
  const typed = query.trim();
  const candidates = typed ? [typed, ...base.filter((item) => item.includes(typed.toLowerCase()))] : base;
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const text of candidates) {
    if (seen.has(text)) continue;
    seen.add(text);
    try {
      const when = parseRaidTime(text, timeZone, now);
      out.push({ name: `${text} → ${formatRaidTime(when, timeZone, language)}`.slice(0, 100), value: text });
    } catch {
      // Not understood yet (the person is still typing): offer only the ones that are.
    }
    if (out.length >= 25) break;
  }
  return out;
}

export async function ownCharacterChoices(database: Pick<PrismaClient, "character">, memberId: string, query: string, identities = false): Promise<Suggestion[]> {
  const rows = await database.character.findMany({ where: { memberId, name: { contains: query.trim(), mode: "insensitive" } }, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 25 });
  return rows.map((row) => ({ name: `${row.name}${identities ? ` — ${row.realm}` : row.isMain ? " (main)" : ""}`.slice(0, 100), value: identities ? row.id : row.name }));
}

export async function attunementSuggestions(database: Db, guildId: string, query: string): Promise<Suggestion[]> {
  const rows = await database.characterAttunement.findMany({ where: { character: { member: { guildId } }, name: { contains: query.trim(), mode: "insensitive" } }, distinct: ["name"], select: { name: true }, take: 25 });
  return rows.map((row) => ({ name: row.name.slice(0, 100), value: row.name.slice(0, 100) }));
}

// Items the guild has already dealt with (loot history, wishlists).
export async function itemSuggestions(database: Db, guildId: string, query: string): Promise<Suggestion[]> {
  const needle = query.trim();
  const [loot, wished] = await Promise.all([
    database.lootAward.findMany({ where: { guildId, itemName: { contains: needle, mode: "insensitive" } }, distinct: ["itemName"], select: { itemName: true }, orderBy: { awardedAt: "desc" }, take: 15 }),
    database.wishlistEntry.findMany({ where: { character: { member: { guildId } }, itemName: { contains: needle, mode: "insensitive" } }, distinct: ["itemName"], select: { itemName: true }, take: 15 })
  ]);
  return pick([...new Set([...loot.map((row) => row.itemName), ...wished.map((row) => row.itemName)])], "");
}

export async function tagSuggestions(database: Db, guildId: string, query: string): Promise<Suggestion[]> {
  const rows = await database.tag.findMany({ where: { guildId, name: { contains: query.trim(), mode: "insensitive" } }, orderBy: { name: "asc" }, take: 25 });
  return rows.map((row) => ({ name: row.name.slice(0, 100), value: row.name.slice(0, 100) }));
}

export async function raidTitleSuggestions(database: Db, guildId: string, query: string): Promise<Suggestion[]> {
  const rows = await database.raid.findMany({ where: { guildId, isTest: false, title: { contains: query.trim(), mode: "insensitive" } }, orderBy: { scheduledAt: "desc" }, distinct: ["title"], select: { title: true }, take: 25 });
  return rows.map((row) => ({ name: row.title.slice(0, 100), value: row.title.slice(0, 100) }));
}
