import type { RaidRole } from "@prisma/client";
import { GROUP_KINDS, type GroupKind } from "./dungeon-group.js";

// Group alerts (5.0): members opt in to pings for the kinds of group they want and say which
// roles they play. When a group is posted, the bot mentions only the opted-in members who fit it:
//   - the kind is one they asked for;
//   - one of their linked characters is inside the group's level range (unknown levels count as
//     a fit: they opted in, and the bot cannot tell);
//   - for a dungeon, one of their roles is still needed (read from the title: "need tank").
// The group's leader is never pinged.

export const ALL_ROLES: RaidRole[] = ["TANK", "HEALER", "DPS"];
// More mentions than this and the post turns into a wall of names.
export const MAX_ALERT_MENTIONS = 40;

// Classic dungeons and their usual level range, in English and French, to guess a group's level
// range from its title when the leader leaves the Levels box empty.
export const DUNGEON_LEVELS: { names: string[]; min: number; max: number }[] = [
  { names: ["ragefire chasm", "ragefire", "rfc", "gouffre de ragefeu", "ragefeu"], min: 13, max: 18 },
  { names: ["wailing caverns", "wc", "cavernes des lamentations", "lamentations"], min: 17, max: 24 },
  { names: ["deadmines", "vc", "mortemines"], min: 17, max: 26 },
  { names: ["shadowfang keep", "shadowfang", "sfk", "donjon d'ombrecroc", "ombrecroc"], min: 22, max: 30 },
  { names: ["blackfathom deeps", "blackfathom", "bfd", "profondeurs de brassenoire", "brassenoire"], min: 24, max: 32 },
  { names: ["stormwind stockade", "stockade", "stocks", "la prison"], min: 24, max: 32 },
  { names: ["gnomeregan", "gnomer"], min: 29, max: 38 },
  { names: ["razorfen kraul", "rfk", "kraal de tranchebauge"], min: 29, max: 38 },
  { names: ["scarlet monastery", "sm", "monastere ecarlate", "graveyard", "library", "armory", "cathedral"], min: 30, max: 45 },
  { names: ["razorfen downs", "rfd", "souilles de tranchebauge"], min: 37, max: 46 },
  { names: ["uldaman", "ulda"], min: 41, max: 51 },
  { names: ["zul'farrak", "zulfarrak", "zf"], min: 44, max: 54 },
  { names: ["maraudon", "mara"], min: 46, max: 55 },
  { names: ["sunken temple", "temple of atal'hakkar", "temple d'atal'hakkar", "atal'hakkar", "st"], min: 50, max: 56 },
  { names: ["blackrock depths", "brd", "profondeurs de rochenoire"], min: 52, max: 60 },
  { names: ["lower blackrock spire", "lbrs", "pic de rochenoire inferieur"], min: 55, max: 60 },
  { names: ["upper blackrock spire", "ubrs", "pic de rochenoire superieur"], min: 58, max: 60 },
  { names: ["dire maul", "dm north", "dm east", "dm west", "hache-tripes", "hache tripes"], min: 56, max: 60 },
  { names: ["scholomance", "scholo"], min: 58, max: 60 },
  { names: ["stratholme", "strat"], min: 58, max: 60 }
];

// "Stratholme" -> "stratholme"; accents dropped so French titles match without them.
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Whole-word match, so "st" does not match "strat" or "first".
function containsWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9'])${escaped}($|[^a-z0-9'])`).test(text);
}

// The level range of the dungeon named in a title, or null. Longer names win ("upper blackrock
// spire" before "blackrock"), and "Deadmines" wins over the "vc" abbreviation.
export function dungeonLevelsFromTitle(title: string): { min: number; max: number } | null {
  const text = fold(title);
  let best: { min: number; max: number; length: number } | null = null;
  for (const dungeon of DUNGEON_LEVELS) {
    for (const name of dungeon.names) {
      if (containsWord(text, name) && (!best || name.length > best.length)) best = { min: dungeon.min, max: dungeon.max, length: name.length };
    }
  }
  return best ? { min: best.min, max: best.max } : null;
}

// The Levels box: "55-60", "55 à 60", "60", "55+" or empty. Returns null for empty or unreadable.
export function parseLevelRange(text: string | null | undefined): { min: number; max: number } | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  const clamp = (n: number) => Math.max(1, Math.min(80, n));
  const range = value.match(/^(\d{1,2})\s*(?:-|–|to|a|à)\s*(\d{1,2})$/i);
  if (range) {
    const a = clamp(Number(range[1])), b = clamp(Number(range[2]));
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const plus = value.match(/^(\d{1,2})\s*\+$/);
  if (plus) return { min: clamp(Number(plus[1])), max: 80 };
  const single = value.match(/^(\d{1,2})$/);
  if (single) return { min: clamp(Number(single[1])), max: clamp(Number(single[1])) };
  return null;
}

// The roles a dungeon title asks for ("need tank and healer", "LF heal", "besoin d'un soigneur").
// Empty when the title names none (then every role is wanted).
export function rolesFromTitle(title: string): RaidRole[] {
  const text = fold(title);
  const roles: RaidRole[] = [];
  if (/\btanks?\b/.test(text)) roles.push("TANK");
  if (/\b(heals?|healers?|healz|soigneurs?|soins?|heal)\b/.test(text)) roles.push("HEALER");
  if (/\b(dps|damage|degats)\b/.test(text)) roles.push("DPS");
  return roles;
}

export interface AlertGroup {
  kind: GroupKind;
  minLevel: number | null;
  maxLevel: number | null;
  // Roles still needed; empty = any role.
  rolesNeeded: RaidRole[];
  leaderDiscordId: string;
}

export interface AlertCandidate {
  discordUserId: string;
  kinds: string[];
  roles: string[];
  // Levels of the member's linked characters (null when not known).
  levels: (number | null)[];
}

export function fitsGroup(group: AlertGroup, candidate: AlertCandidate): boolean {
  if (candidate.discordUserId === group.leaderDiscordId) return false;
  if (!candidate.kinds.includes(group.kind)) return false;
  if (group.minLevel !== null || group.maxLevel !== null) {
    const min = group.minLevel ?? 1, max = group.maxLevel ?? 80;
    const known = candidate.levels.filter((level): level is number => typeof level === "number");
    if (known.length > 0 && !known.some((level) => level >= min && level <= max)) return false;
  }
  if (GROUP_KINDS[group.kind].roles && group.rolesNeeded.length > 0) {
    const plays = candidate.roles.length > 0 ? candidate.roles : ALL_ROLES;
    if (!group.rolesNeeded.some((role) => plays.includes(role))) return false;
  }
  return true;
}

// The Discord ids to mention for a new group, capped at MAX_ALERT_MENTIONS.
export function alertRecipients(group: AlertGroup, candidates: AlertCandidate[], alreadyPinged: Set<string> = new Set()): string[] {
  return candidates
    .filter((candidate) => !alreadyPinged.has(candidate.discordUserId) && fitsGroup(group, candidate))
    .map((candidate) => candidate.discordUserId)
    .slice(0, MAX_ALERT_MENTIONS);
}

// A short line for the alerts panel: "Dungeon, PvP · as Tank, Healer" / "Off".
export function describeAlert(kinds: string[], roles: string[], label: (kind: GroupKind) => string, roleLabel: (role: RaidRole) => string, off: string, anyRole: string): string {
  const valid = kinds.filter((kind): kind is GroupKind => kind in GROUP_KINDS);
  if (valid.length === 0) return off;
  const who = roles.length === 0 ? anyRole : roles.filter((role): role is RaidRole => (ALL_ROLES as string[]).includes(role)).map(roleLabel).join(", ");
  return `${valid.map(label).join(", ")} · ${who}`;
}
