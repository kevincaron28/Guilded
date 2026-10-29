import { CLASSES, WEEKDAYS } from "../wow-data.js";

// Recruitment listings (7.0, roadmap request 5): the structured fields officers set with
// /mod recruit, the filters on /recruitment/, and the rules for applications and player cards.

export const ROLES = ["TANK", "HEALER", "DPS"] as const;
export const LANGUAGES = ["en", "fr", "both"] as const;
export const FACTIONS = ["ALLIANCE", "HORDE"] as const;
export type Role = typeof ROLES[number];
// A listing may also ask for melee or ranged DPS; both still match someone looking as DPS.
export const LISTING_ROLES = ["TANK", "HEALER", "DPS", "MELEE", "RANGED"] as const;
export type ListingRole = typeof LISTING_ROLES[number];

const FRENCH_CLASSES: Record<string, string> = {
  guerrier: "Warrior", paladin: "Paladin", chasseur: "Hunter", voleur: "Rogue", pretre: "Priest", pretresse: "Priest",
  chaman: "Shaman", mage: "Mage", demoniste: "Warlock", druide: "Druid", "chevalier de la mort": "Death Knight",
  moine: "Monk", "chasseur de demons": "Demon Hunter", evocateur: "Evoker"
};
const ROLE_WORDS: Record<string, ListingRole> = {
  tank: "TANK", tanks: "TANK", heal: "HEALER", heals: "HEALER", healer: "HEALER", healers: "HEALER", soigneur: "HEALER", soigneurs: "HEALER",
  dps: "DPS", damage: "DPS", melee: "MELEE", melee_dps: "MELEE", cac: "MELEE", ranged: "RANGED", range: "RANGED", caster: "RANGED", casters: "RANGED", distance: "RANGED"
};
const DAY_WORDS: Record<string, string> = {
  mon: "monday", lun: "monday", lundi: "monday", tue: "tuesday", mar: "tuesday", mardi: "tuesday", wed: "wednesday", mer: "wednesday", mercredi: "wednesday",
  thu: "thursday", jeu: "thursday", jeudi: "thursday", fri: "friday", ven: "friday", vendredi: "friday", sat: "saturday", sam: "saturday", samedi: "saturday",
  sun: "sunday", dim: "sunday", dimanche: "sunday"
};

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const words = (text: string) => text.split(/[,;/]+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
const NONE = new Set(["", "any", "all", "none", "-", "tous", "toutes", "aucun"]);

export class RecruitmentError extends Error {}

export function className(text: string): string | null {
  const key = plain(text);
  const english = CLASSES.find((name) => plain(name) === key || plain(name).replace(/\s/g, "") === key.replace(/\s/g, ""));
  return english ?? FRENCH_CLASSES[key] ?? null;
}

// "Warrior, prêtre / mage" -> ["Warrior", "Priest", "Mage"]; "any" -> [] (every class).
export function parseClasses(text: string): string[] {
  if (NONE.has(plain(text))) return [];
  // "Warrior Priest" (spaces only) is two classes; "Death Knight" is one.
  const names = words(text).flatMap((part) => {
    const name = className(part);
    if (name) return [name];
    const each = part.split(/\s+/).map(className);
    if (each.every(Boolean)) return each as string[];
    throw new RecruitmentError(`Unknown class: ${part}. Use names such as Warrior, Priest, Mage (or French).`);
  });
  return CLASSES.filter((name) => names.includes(name));
}

export function parseRoles(text: string): ListingRole[] {
  if (NONE.has(plain(text))) return [];
  const roles = words(text.replace(/\s+/g, ",")).map((part) => {
    const role = ROLE_WORDS[plain(part)] ?? (LISTING_ROLES as readonly string[]).find((name) => name === part.toUpperCase());
    if (!role) throw new RecruitmentError(`Unknown role: ${part}. Use tank, healer, dps, melee or ranged.`);
    return role as ListingRole;
  });
  return LISTING_ROLES.filter((role) => roles.includes(role));
}

export function parseDays(text: string): string[] {
  if (NONE.has(plain(text))) return [];
  const days = words(text.replace(/\s+/g, ",")).map((part) => {
    const key = plain(part);
    const day = WEEKDAYS.find((name) => name === key) ?? DAY_WORDS[key] ?? DAY_WORDS[key.slice(0, 3)];
    if (!day) throw new RecruitmentError(`Unknown day: ${part}. Use mon, tue, wed... (or lun, mar, mer...).`);
    return day;
  });
  return WEEKDAYS.filter((day) => days.includes(day));
}

export function shortText(text: string | null | undefined, limit: number, label: string): string | null {
  const trimmed = (text ?? "").replace(/\s+/g, (space) => (space.includes("\n") ? "\n" : " ")).trim();
  if (trimmed.length > limit) throw new RecruitmentError(`${label} is limited to ${limit} characters.`);
  return trimmed || null;
}

// A character name as WoW allows it, with an optional realm ("Kev-Doomhowl"), or "First Last" on Forever.
const CHARACTER = /^[\p{L}][\p{L}' ]{1,30}(?:-[\p{L}0-9' ]{2,30})?$/u;
export function characterName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!CHARACTER.test(trimmed)) throw new RecruitmentError("Enter your character's name (letters only, 2-30). / Entrez le nom de votre personnage (lettres seulement, 2 à 30).");
  return trimmed;
}

export interface ListingFields {
  open: boolean; classes: string[]; roles: string[]; raidDays: string[]; raidTimes: string | null;
  language: string | null; faction: string | null; realm: string | null; note: string | null;
}

export interface PublicListing extends ListingFields {
  id: string; guildName: string; guildDiscordId: string; pageSlug: string | null; inviteUrl: string | null;
  core: { name: string; schedule: string | null } | null; updatedAt: Date;
}

export interface PublicCard {
  id: string; character: string; className: string; role: string; level: number | null; realm: string | null; faction: string | null;
  language: string | null; raidDays: string[]; note: string | null; discord: string | null; updatedAt: Date;
}

export interface Filters { kind: "all" | "guild" | "core" | "players" | "raids"; className: string | null; role: Role | null; faction: string | null; language: string | null; realm: string | null }

export function readFilters(query: URLSearchParams): Filters {
  const kind = query.get("kind");
  const role = query.get("role")?.toUpperCase();
  const faction = query.get("faction")?.toUpperCase();
  const language = query.get("language");
  return {
    kind: kind === "guild" || kind === "core" || kind === "players" || kind === "raids" ? kind : "all",
    className: query.get("class") ? className(query.get("class")!) : null,
    role: (ROLES as readonly string[]).includes(role ?? "") ? role as Role : null,
    faction: (FACTIONS as readonly string[]).includes(faction ?? "") ? faction! : null,
    language: language === "en" || language === "fr" ? language : null,
    realm: query.get("realm")?.trim().slice(0, 40) || null
  };
}

const sameRealm = (wanted: string | null, realm: string | null) => !wanted || !realm || plain(realm) === plain(wanted);
const speaks = (wanted: string | null, language: string | null) => !wanted || !language || language === "both" || language === wanted;

export function listingMatches(listing: PublicListing, filters: Filters): boolean {
  if (!listing.open || filters.kind === "players" || filters.kind === "raids") return false;
  if (filters.kind === "guild" && listing.core) return false;
  if (filters.kind === "core" && !listing.core) return false;
  if (filters.className && listing.classes.length && !listing.classes.includes(filters.className)) return false;
  if (filters.role && listing.roles.length && !listing.roles.includes(filters.role)
    && !(filters.role === "DPS" && listing.roles.some((role) => role === "MELEE" || role === "RANGED"))) return false;
  if (filters.faction && listing.faction && listing.faction !== filters.faction) return false;
  return speaks(filters.language, listing.language) && sameRealm(filters.realm, listing.realm);
}

export function cardMatches(card: PublicCard, filters: Filters): boolean {
  if (filters.kind === "guild" || filters.kind === "core" || filters.kind === "raids") return false;
  if (filters.className && card.className !== filters.className) return false;
  if (filters.role && card.role !== filters.role) return false;
  if (filters.faction && card.faction && card.faction !== filters.faction) return false;
  return speaks(filters.language, card.language) && sameRealm(filters.realm, card.realm);
}

// Limits for signed-in players. Applications: a few a day, one waiting per listing, and none to a
// guild that marked an earlier one as spam. Reports: a few a day; three different reporters hide a card.
export const LIMITS = { applicationsPerDay: 5, reportsPerDay: 10, cardSavesPerHour: 10, cardHideReports: 3, cardDays: 30, messageLength: 1000, noteLength: 300 } as const;

const CLASS_FR: Record<string, string> = {
  Warrior: "Guerrier", Paladin: "Paladin", Hunter: "Chasseur", Rogue: "Voleur", Priest: "Prêtre", Shaman: "Chaman", Mage: "Mage",
  Warlock: "Démoniste", Druid: "Druide", "Death Knight": "Chevalier de la mort", Monk: "Moine", "Demon Hunter": "Chasseur de démons", Evoker: "Évocateur"
};
const ROLE_LABELS: Record<string, [string, string]> = { TANK: ["Tank", "Tank"], HEALER: ["Healer", "Soigneur"], DPS: ["DPS", "DPS"], MELEE: ["Melee DPS", "DPS mêlée"], RANGED: ["Ranged DPS", "DPS distance"] };
const DAY_LABELS: Record<string, [string, string]> = {
  monday: ["Mon", "lun"], tuesday: ["Tue", "mar"], wednesday: ["Wed", "mer"], thursday: ["Thu", "jeu"], friday: ["Fri", "ven"], saturday: ["Sat", "sam"], sunday: ["Sun", "dim"]
};
const LANGUAGE_LABELS: Record<string, [string, string]> = { en: ["English", "Anglais"], fr: ["French", "Français"], both: ["English and French", "Français et anglais"] };
const FACTION_LABELS: Record<string, [string, string]> = { ALLIANCE: ["Alliance", "Alliance"], HORDE: ["Horde", "Horde"] };
const pickLabel = (labels: Record<string, [string, string]>, value: string, lang: "en" | "fr") => labels[value]?.[lang === "fr" ? 1 : 0] ?? value;

export const classLabel = (name: string, lang: "en" | "fr") => (lang === "fr" ? CLASS_FR[name] ?? name : name);
export const roleLabel = (role: string, lang: "en" | "fr") => pickLabel(ROLE_LABELS, role, lang);
export const dayLabel = (day: string, lang: "en" | "fr") => pickLabel(DAY_LABELS, day, lang);
export const languageLabel = (language: string, lang: "en" | "fr") => pickLabel(LANGUAGE_LABELS, language, lang);
export const factionLabel = (faction: string, lang: "en" | "fr") => pickLabel(FACTION_LABELS, faction, lang);
