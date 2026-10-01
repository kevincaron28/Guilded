import type { Guild } from "discord.js";
import { CLASSES } from "../wow-data.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import type { Lang } from "../i18n.js";

type WowClass = typeof CLASSES[number];
export type ClassEmojis = Partial<Record<WowClass, string>>;
export const CLASS_EMOJI_NAMES: Record<WowClass, string> = {
  Warrior: "wow_guerrier", Paladin: "wow_paladin", Hunter: "wow_chasseur", Rogue: "wow_voleur",
  Priest: "wow_pretre", Shaman: "wow_chaman", Mage: "wow_mage", Warlock: "wow_demoniste", Druid: "wow_druide",
  "Death Knight": "wow_chevalier_mort", Monk: "wow_moine", "Demon Hunter": "wow_chasseur_demons", Evoker: "wow_evocateur"
};
export interface DisplayCharacter {
  className?: string | null;
  level?: number | null;
  readinessSnapshots?: { itemLevel: number | null; inspectedAt: Date }[];
}
export const CHARACTER_DISPLAY_SELECT = {
  name: true, realm: true, memberId: true, className: true, level: true,
  readinessSnapshots: { orderBy: { inspectedAt: "desc" as const }, take: 1, select: { itemLevel: true, inspectedAt: true } }
} as const;
export const GEAR_MAX_AGE_MS = 24 * 60 * 60_000;
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
export function canonicalClass(value?: string | null): WowClass | undefined {
  const key = normalized(value ?? "");
  return CLASSES.find(name => normalized(name) === key || normalized(CLASS_NAMES_FR[name] ?? "") === key);
}

export function classEmojiMap(emojis: Iterable<{ id: string; name: string | null; animated?: boolean | null; available?: boolean | null }>): ClassEmojis {
  const result: ClassEmojis = {};
  for (const emoji of emojis) {
    if (emoji.available === false || !/^\d{15,22}$/.test(emoji.id)) continue;
    const name = CLASSES.find(value => CLASS_EMOJI_NAMES[value] === emoji.name);
    if (name) result[name] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  }
  return result;
}

// REST refresh also works without the optional Guild Expressions gateway intent.
export async function loadClassEmojis(guild: Guild): Promise<ClassEmojis> {
  if (!guild.emojis) return {};
  const emojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);
  return classEmojiMap(emojis.values());
}

function gear(character: DisplayCharacter, now: Date) {
  const snapshot = character.readinessSnapshots?.[0];
  const age = snapshot ? now.getTime() - snapshot.inspectedAt.getTime() : NaN;
  return snapshot && snapshot.itemLevel !== null && Number.isFinite(snapshot.itemLevel) && snapshot.itemLevel > 0
    && Number.isFinite(age) && age >= -5 * 60_000 ? { itemLevel: snapshot.itemLevel, stale: age > GEAR_MAX_AGE_MS } : null;
}
export function hasStaleGear(character: DisplayCharacter | null | undefined, now = new Date()): boolean {
  return !!character && !!gear(character, now)?.stale;
}
export const staleGearNote = (lang: Lang) => lang === "fr"
  ? "* Équipement relevé il y a plus de 24 h; synchronise l’addon pour l’actualiser."
  : "* Gear inspected over 24 hours ago; sync the addon to refresh it.";

export function characterDisplayLine(label: string, character: DisplayCharacter | null | undefined, lang: Lang, emojis: ClassEmojis = {}, now = new Date()): string {
  if (!character?.className) return label;
  const name = canonicalClass(character.className);
  const className = name ? lang === "fr" ? CLASS_NAMES_FR[name] ?? name : name : character.className.slice(0, 50);
  const icon = name && emojis[name] ? `${emojis[name]} ` : "";
  const level = character.level && Number.isInteger(character.level) && character.level > 0 ? ` · ${lang === "fr" ? "niv." : "lvl"} ${character.level}` : "";
  const inspected = gear(character, now);
  const itemLevel = inspected ? inspected.itemLevel.toLocaleString(lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 1 }) + (inspected.stale ? "*" : "") : "—";
  return `${icon}${label} · ${className}${level} · ilvl ${itemLevel}`;
}
