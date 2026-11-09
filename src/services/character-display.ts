import type { Guild } from "discord.js";
import { CLASSES } from "../wow-data.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import type { Lang } from "../i18n.js";
import { foreverSameName } from "../../companion/character-identity.mjs";
import { WOW_SPECIALIZATIONS, canonicalSpecialization, type SpecEmojiKey } from "../wow-specializations.js";

type WowClass = typeof CLASSES[number];
export type RoleEmojiKey = "ROLE:TANK" | "ROLE:HEALER" | "ROLE:DPS";
export type ClassEmojis = Partial<Record<WowClass | SpecEmojiKey | RoleEmojiKey, string>>;
export const ROLE_EMOJI_NAMES: Record<RoleEmojiKey, string> = {
  "ROLE:TANK": "wow_role_tank", "ROLE:HEALER": "wow_role_healer", "ROLE:DPS": "wow_role_dps"
};
export const CLASS_EMOJI_NAMES: Record<WowClass, string> = {
  Warrior: "wow_guerrier", Paladin: "wow_paladin", Hunter: "wow_chasseur", Rogue: "wow_voleur",
  Priest: "wow_pretre", Shaman: "wow_chaman", Mage: "wow_mage", Warlock: "wow_demoniste", Druid: "wow_druide",
  "Death Knight": "wow_chevalier_mort", Monk: "wow_moine", "Demon Hunter": "wow_chasseur_demons", Evoker: "wow_evocateur"
};
export interface DisplayCharacter {
  name?: string;
  displayName?: string | null;
  className?: string | null;
  spec?: string | null;
  level?: number | null;
  readinessSnapshots?: { itemLevel: number | null; inspectedAt: Date; _count?: { findings: number } }[];
}
export const CHARACTER_DISPLAY_SELECT = {
  name: true, displayName: true, realm: true, memberId: true, className: true, spec: true, level: true,
  readinessSnapshots: { orderBy: { inspectedAt: "desc" as const }, take: 1, select: { itemLevel: true, inspectedAt: true } }
} as const;
// Signup posts also count the latest gear check's open warnings and errors (the ⚠️ badge).
export const SIGNUP_CHARACTER_SELECT = {
  ...CHARACTER_DISPLAY_SELECT,
  readinessSnapshots: { ...CHARACTER_DISPLAY_SELECT.readinessSnapshots, select: { itemLevel: true, inspectedAt: true,
    _count: { select: { findings: { where: { severity: { not: "INFO" as const }, resolved: false } } } } } }
} as const;
export const GEAR_MAX_AGE_MS = 24 * 60 * 60_000;
export function characterName(character: { name: string; displayName?: string | null }): string {
  return character.displayName?.trim() || character.name;
}

// 9.0: full Forever names ("First Last") in every bot message where one is known (owner decision, 6 November 2026).
// A Forever row can be stored under the first name only while another source (the Character display name, an unlinked
// guildmate, or the guild roster snapshot) already knows the full name. A FullNameBook is one guild's list of those, keyed
// by first name; a first name that two different full names share is left alone (ambiguous), and a name is never guessed.
export interface FullNameBook { fullFor(name: string): string | undefined }
const squash = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const lowerName = (value: string) => value.normalize("NFC").toLowerCase();
export const emptyNameBook: FullNameBook = { fullFor: () => undefined };

/** Pure: builds a guild's book from rows that carry a name and maybe a display name (Character, UnclaimedCharacter, GuildRosterEntry). */
export function fullNameBook(rows: Iterable<{ name?: string | null; displayName?: string | null }>): FullNameBook {
  const byFirst = new Map<string, Set<string>>();
  const add = (full: string) => {
    const first = lowerName(full.split(" ")[0]!);
    const set = byFirst.get(first) ?? new Set<string>();
    set.add(full); byFirst.set(first, set);
  };
  for (const row of rows) {
    const name = squash(row.name), display = squash(row.displayName);
    if (name.includes(" ")) add(name);
    else if (display.split(" ").length === 2 && lowerName(display.split(" ")[0]!) === lowerName(name)) add(display);
  }
  return { fullFor(name: string) {
    const first = lowerName(squash(name));
    const set = first && !first.includes(" ") ? byFirst.get(first) : undefined;
    return set && set.size === 1 ? [...set][0] : undefined;
  } };
}

/** Loads one guild's book from the bot's own tables. Never throws: a failed read gives an empty book (stored names are shown). */
export async function loadFullNameBook(db: { character?: { findMany: (args: never) => Promise<{ name: string; displayName: string | null }[]> }; unclaimedCharacter?: { findMany: (args: never) => Promise<{ name: string; displayName: string | null }[]> }; guildRosterEntry?: { findMany: (args: never) => Promise<{ name: string }[]> };
  publicRunPlayer?: { findMany: (args: never) => Promise<{ character: string; displayName: string | null }[]> } }, guildId: string, alsoLookUp: readonly string[] = []): Promise<FullNameBook> {
  try {
    const [linked, unclaimed, roster] = await Promise.all([
      db.character?.findMany({ where: { member: { guildId } }, select: { name: true, displayName: true }, take: 5_000 } as never) ?? [],
      db.unclaimedCharacter?.findMany({ where: { guildId }, select: { name: true, displayName: true }, take: 5_000 } as never) ?? [],
      db.guildRosterEntry?.findMany({ where: { guildId, inGuild: true }, select: { name: true }, take: 5_000 } as never) ?? []
    ]);
    const own = fullNameBook([...linked, ...unclaimed, ...roster]);
    // First names the guild's own tables cannot complete: the public runs carry the full names the addon saw ("Crashing" -> "Crashing Pally").
    // Used only for those names, so another guild's look-alike never changes a name the guild already resolves.
    // `alsoLookUp`: first names a board is about to show (a run's party) that may be in none of the guild's tables.
    const bare = [...new Set([...[...linked, ...unclaimed, ...roster].map(row => row.name), ...alsoLookUp].map(name => squash(name)).filter(name => name && !name.includes(" ") && !own.fullFor(name)))].slice(0, 2_000);
    const seen = bare.length && db.publicRunPlayer
      ? await db.publicRunPlayer.findMany({ where: { character: { in: bare }, displayName: { contains: " " } }, select: { character: true, displayName: true }, distinct: ["character", "displayName"], take: 5_000 } as never).catch(() => [])
      : [];
    if (!seen.length) return own;
    const pub = fullNameBook(seen.map(row => ({ name: row.character, displayName: row.displayName })));
    return { fullFor: (name: string) => own.fullFor(name) ?? pub.fullFor(name) };
  } catch { return emptyNameBook; }
}

/**
 * The name to show for a character: the full "First Last" when known, else what is stored. Takes a character-like object
 * or a plain name, then any mix of: a guild's FullNameBook, and `tiers` (lists of known names in priority order, e.g. the
 * linked Character's names, the roster snapshot, the run players' own names). A bare Forever first name takes the single
 * full name that starts with it (the display name, then the book, then the first tier that has exactly one); two different
 * full names are ambiguous and the stored name stays. Names that are already full, or are not Forever names, are returned as stored.
 */
function resolveCharacterName(character: string | { name: string; displayName?: string | null },
  sources: (FullNameBook | null | undefined | readonly (string | null | undefined)[])[]): string {
  const row = typeof character === "string" ? { name: character, displayName: null } : character;
  const name = squash(row.name);
  if (!name) return row.displayName?.trim() || row.name;
  if (name.includes(" ")) return name;
  const display = squash(row.displayName);
  const words = display.split(" ");
  if (words.length === 2 && lowerName(words[0]!) === lowerName(name)) return display;
  for (const source of sources) {
    if (!source) continue;
    if (!Array.isArray(source)) { const full = (source as FullNameBook).fullFor(name); if (full) return full; continue; }
    const found = new Map<string, string>();
    for (const candidate of source as readonly (string | null | undefined)[]) {
      const value = squash(candidate);
      if (value.includes(" ") && foreverSameName(value, name)) found.set(value.toLowerCase(), value);
    }
    if (found.size === 1) return [...found.values()][0]!;
    if (found.size > 1) return characterName(row);
  }
  return characterName(row);
}
const plainName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/**
 * "First Last" as a player would write it: a last name equal to the first ("Xaldin Xaldin") or the realm word
 * ("Shawir Forever", or the character's own realm) is not a last name and is dropped. Anything else is kept as sent.
 */
export function cleanCharacterName(name: string, realm?: string | null): string {
  const words = squash(name).split(" ");
  if (words.length < 2) return squash(name);
  const last = plainName(words[words.length - 1]!);
  return last === plainName(words[0]!) || last === "forever" || (!!realm && realm !== "-" && last === plainName(realm)) ? words.slice(0, -1).join(" ") : words.join(" ");
}

/** The one place that decides how a character is named in Discord output (see docs/NAME_STANDARD.md). */
export function displayCharacterName(character: string | { name: string; displayName?: string | null; realm?: string | null },
  ...sources: (FullNameBook | null | undefined | readonly (string | null | undefined)[])[]): string {
  const realm = typeof character === "string" ? undefined : character.realm;
  return cleanCharacterName(resolveCharacterName(character, sources), realm);
}

/**
 * A character for a list line or embed: the full name from `displayCharacterName`, plus " (<@id>)" when a mention is wanted
 * (the member's Discord id) or " (@name)" when only their Discord name is known. Never the Discord name on its own.
 */
export function characterLabel(character: string | { name: string; displayName?: string | null; realm?: string | null },
  options: { sources?: (FullNameBook | null | undefined | readonly (string | null | undefined)[])[]; mention?: string | null; member?: string | null } = {}): string {
  const name = displayCharacterName(character, ...(options.sources ?? []));
  return options.mention ? `${name} (<@${options.mention}>)` : options.member ? `${name} (@${options.member})` : name;
}
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
export function canonicalClass(value?: string | null): WowClass | undefined {
  const key = normalized(value ?? "");
  return CLASSES.find(name => normalized(name) === key || normalized(CLASS_NAMES_FR[name] ?? "") === key);
}

/** A class name in the guild's language ("Démoniste" for a French guild); unknown text is kept as written. */
export function localClassName(value: string | null | undefined, lang: Lang): string {
  const name = canonicalClass(value);
  return name ? (lang === "fr" ? CLASS_NAMES_FR[name] ?? name : name) : (value ?? "").trim();
}
// Playable races as the French client names them (the stored value is the English name).
const RACE_NAMES_FR: Record<string, string> = {
  human: "Humain", dwarf: "Nain", nightelf: "Elfe de la nuit", gnome: "Gnome", draenei: "Draeneï", worgen: "Worgen",
  orc: "Orc", undead: "Mort-vivant", scourge: "Mort-vivant", tauren: "Tauren", troll: "Troll", bloodelf: "Elfe de sang", goblin: "Gobelin", pandaren: "Pandaren"
};
/** A race name in the guild's language; unknown text is kept as written. */
export function localRaceName(value: string | null | undefined, lang: Lang): string {
  const text = (value ?? "").trim();
  return lang === "fr" ? RACE_NAMES_FR[normalized(text)] ?? text : text;
}

export function classEmojiMap(emojis: Iterable<{ id: string; name: string | null; animated?: boolean | null; available?: boolean | null }>): ClassEmojis {
  const result: ClassEmojis = {};
  for (const emoji of emojis) {
    if (emoji.available === false || !/^\d{15,22}$/.test(emoji.id)) continue;
    const name = CLASSES.find(value => CLASS_EMOJI_NAMES[value] === emoji.name);
    if (name) result[name] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    const spec = WOW_SPECIALIZATIONS.find(value => value.emojiName === emoji.name);
    if (spec) result[spec.key] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    for (const [key, roleName] of Object.entries(ROLE_EMOJI_NAMES)) {
      if (roleName === emoji.name) result[key as RoleEmojiKey] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }
  }
  return result;
}

// REST refresh also works without the optional Guild Expressions gateway intent.
type EmojiApplication = NonNullable<Guild["client"]["application"]>;
const applicationCatalogs = new WeakMap<EmojiApplication, { at: number; catalog: ClassEmojis; pending: Promise<ClassEmojis> | undefined }>();
async function applicationEmojis(application: EmojiApplication | null): Promise<ClassEmojis> {
  if (!application?.emojis) return {};
  const cached = applicationCatalogs.get(application);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.catalog;
  const entry = { at: 0, catalog: cached?.catalog ?? {}, pending: undefined as Promise<ClassEmojis> | undefined };
  entry.pending = application.emojis.fetch().then(emojis => {
    entry.catalog = classEmojiMap(emojis.values());
    return entry.catalog;
  }).catch(() => {
    entry.catalog = { ...entry.catalog, ...classEmojiMap(application.emojis.cache.values()) };
    return entry.catalog;
  }).finally(() => {
    entry.at = Date.now(); entry.pending = undefined;
  });
  applicationCatalogs.set(application, entry);
  return entry.pending;
}
export async function loadClassEmojis(guild: Guild): Promise<ClassEmojis> {
  const [server, application] = await Promise.all([
    guild.emojis ? guild.emojis.fetch().catch(() => guild.emojis.cache).then(emojis => classEmojiMap(emojis.values())) : Promise.resolve({}),
    applicationEmojis(guild.client?.application ?? null)
  ]);
  return { ...application, ...server };
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
// Item level and open warnings/errors of a gear check from the last 24 hours; an older check proves nothing.
export function freshGearCheck(character: DisplayCharacter | null | undefined, now = new Date()): { itemLevel: number; issues: number } | null {
  const checked = character ? gear(character, now) : null;
  if (!checked || checked.stale) return null;
  const issues = character?.readinessSnapshots?.[0]?._count?.findings ?? 0;
  return { itemLevel: checked.itemLevel, issues: Number.isInteger(issues) && issues > 0 ? issues : 0 };
}
// One icon per player, as on calendar posts: the spec icon when it is known, else the class icon.
export function characterIcon(character: DisplayCharacter | null | undefined, emojis: ClassEmojis = {}): string {
  const name = canonicalClass(character?.className);
  const spec = name ? canonicalSpecialization(name, character?.spec) : undefined;
  return (spec && emojis[spec.key]) || (name && emojis[name]) || "";
}
export const staleGearNote = (lang: Lang) => lang === "fr"
  ? "* Équipement relevé il y a plus de 24 h; synchronise l’addon pour l’actualiser."
  : "* Gear inspected over 24 hours ago; sync the addon to refresh it.";

export function characterDisplayLine(label: string, character: DisplayCharacter | null | undefined, lang: Lang, emojis: ClassEmojis = {}, now = new Date()): string {
  // Existing callers pass either the character or "member · character".
  // Replace only that exact trailing identity, never arbitrary nickname text.
  if (character?.name && character.displayName) {
    if (label === character.name) label = character.displayName;
    else if (label.endsWith(` · ${character.name}`)) label = label.slice(0, -character.name.length) + character.displayName;
  }
  if (!character?.className) return label;
  const name = canonicalClass(character.className);
  const className = name ? lang === "fr" ? CLASS_NAMES_FR[name] ?? name : name : character.className.slice(0, 50);
  const spec = canonicalSpecialization(name, character.spec);
  const icon = [name && emojis[name], spec && emojis[spec.key]].filter(Boolean).join(" ");
  const specName = spec ? lang === "fr" ? spec.french : spec.name : character.spec?.trim().slice(0, 50);
  const specialization = specName || (lang === "fr" ? "spé à préciser" : "spec not set");
  const level = character.level && Number.isInteger(character.level) && character.level > 0 ? ` · ${lang === "fr" ? "niv." : "lvl"} ${character.level}` : "";
  const inspected = gear(character, now);
  const itemLevel = inspected ? inspected.itemLevel.toLocaleString(lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 1 }) + (inspected.stale ? "*" : "") : "—";
  return `${icon ? icon + " " : ""}${label} · ${className} — ${specialization}${level} · ilvl ${itemLevel}`;
}
