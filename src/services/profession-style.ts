import { cleanCharacterName } from "./character-display.js";
import type { Lang } from "../i18n.js";

// 8.5 track D (owner request 11): ONE way to show a profession everywhere (directory, per-profession posts, gallery,
// /craft who): an icon, the name, a skill bar and a recency dot, grouped by profession, with a one-line legend.
// Reasoning for each choice is in docs/PROFESSION_DISPLAY.md.

export const PROFESSION_EMOJI: Record<string, string> = {
  Alchemy: "🧪", Blacksmithing: "⚒️", Enchanting: "✨", Engineering: "⚙️", Leatherworking: "🥾", Tailoring: "🧵", Jewelcrafting: "💎",
  Inscription: "📜", Herbalism: "🌿", Mining: "⛏️", Skinning: "🔪", Cooking: "🍖", "First Aid": "🩹", Fishing: "🎣", Archaeology: "🏺"
};
// Profession names as shown to a French guild (the stored value stays the English name).
export const PROFESSION_FR: Record<string, string> = {
  Alchemy: "Alchimie", Blacksmithing: "Forge", Enchanting: "Enchantement", Engineering: "Ingénierie", Leatherworking: "Travail du cuir",
  Tailoring: "Couture", Jewelcrafting: "Joaillerie", Inscription: "Calligraphie", Herbalism: "Herboristerie", Mining: "Minage",
  Skinning: "Dépeçage", Cooking: "Cuisine", "First Aid": "Premiers soins", Fishing: "Pêche", Archaeology: "Archéologie"
};

const canonical = (profession: string) => {
  const wanted = profession.trim().toLowerCase();
  return Object.keys(PROFESSION_EMOJI).find(name => name.toLowerCase() === wanted || PROFESSION_FR[name]?.toLowerCase() === wanted);
};
export const professionEmoji = (profession: string): string => PROFESSION_EMOJI[canonical(profession) ?? ""] ?? "📚";
/** The profession's name in the guild's language (unknown names are kept as typed). */
export const professionName = (profession: string, lang: Lang = "en"): string => {
  const name = canonical(profession);
  return name ? (lang === "fr" ? PROFESSION_FR[name] ?? name : name) : profession.trim();
};
/** "🧪 Alchemy". */
export const professionTitle = (profession: string, lang: Lang = "en"): string => `${professionEmoji(profession)} ${professionName(profession, lang)}`;

/** The cap a skill is measured against: 300 until it passes it, then the next tier. */
export const skillCap = (level: number): number => level > 375 ? 450 : level > 300 ? 375 : 300;

/** "▰▰▰▰▰▰▰▱▱▱" for a skill level; an empty bar when unknown. */
export function skillBar(level: number | null | undefined, width = 10): string {
  const cap = skillCap(level ?? 0);
  const filled = level && level > 0 ? Math.max(1, Math.min(width, Math.round((level / cap) * width))) : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

const DAY = 86_400_000;
/** 🟢 seen this week, 🟡 this month, ⚪ longer ago or unknown. */
export function seenDot(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "⚪";
  const days = (now.getTime() - date.getTime()) / DAY;
  return days < 7 ? "🟢" : days < 30 ? "🟡" : "⚪";
}

/** The short legend printed once under each post. */
export const professionLegend = (lang: Lang = "en"): string => lang === "fr"
  ? "▰ compétence (sur 300) · 🟢 vu cette semaine · 🟡 ce mois-ci · ⚪ plus ancien"
  : "▰ skill (out of 300) · 🟢 seen this week · 🟡 this month · ⚪ longer ago";

/** One crafter on one line: dot, name, bar, level and last seen. */
export function crafterLine(entry: { character: string; skill: number | null; lastSeen: Date | null }, seenText: string, now: Date = new Date(), escape: (value: string) => string = value => value): string {
  return `${seenDot(entry.lastSeen, now)} **${escape(cleanCharacterName(entry.character))}** ${skillBar(entry.skill, 8)} ${entry.skill ?? "—"} · ${seenText}`;
}
