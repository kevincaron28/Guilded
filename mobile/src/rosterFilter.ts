import type { CharacterCard, StandingRow } from "./api";

// Search, class and role filters and sorting for the roster lists (0.4.0). Pure, so the rules are tested without a screen.
// The server sends no "last seen" for a member, so the sorts are by name, level and (EP/GP lists) priority.

export type CharacterSort = "name" | "level";
export type StandingSort = "pr" | "name" | "ep";
export const ROLES = ["TANK", "HEALER", "DPS"] as const;
export type RoleFilter = typeof ROLES[number];

export interface RosterFilters { search: string; className: string | null; role: RoleFilter | null }
export const noFilters: RosterFilters = { search: "", className: null, role: null };

const fold = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Does the name (also with its realm) contain every word typed? Accents and case are ignored. */
export function matchesSearch(search: string, ...fields: (string | null | undefined)[]): boolean {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

/** The roles a character plays in any of its cores (a character with no core has none). */
export const rolesOf = (character: CharacterCard): string[] => [...new Set(character.cores.map((core) => core.role))];

export function filterCharacters(characters: CharacterCard[], filters: RosterFilters, sort: CharacterSort): CharacterCard[] {
  const kept = characters.filter((c) => matchesSearch(filters.search, c.displayName, c.name, c.realm, c.className, c.spec)
    && (!filters.className || c.className === filters.className)
    && (!filters.role || rolesOf(c).includes(filters.role)));
  const byName = (a: CharacterCard, b: CharacterCard) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
  return [...kept].sort(sort === "level" ? (a, b) => (b.level ?? 0) - (a.level ?? 0) || byName(a, b) : byName);
}

export function filterStandings(rows: StandingRow[], search: string, sort: StandingSort): StandingRow[] {
  const kept = rows.filter((row) => matchesSearch(search, row.character, row.realm));
  const byName = (a: StandingRow, b: StandingRow) => a.character.localeCompare(b.character);
  const order: Record<StandingSort, (a: StandingRow, b: StandingRow) => number> = {
    pr: (a, b) => b.pr - a.pr || byName(a, b), ep: (a, b) => b.ep - a.ep || byName(a, b), name: byName
  };
  return [...kept].sort(order[sort]);
}

/** Distinct class names of the characters, A to Z, for the class chips. */
export const classesOf = (characters: CharacterCard[]): string[] => [...new Set(characters.map((c) => c.className).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export const filtersActive = (filters: RosterFilters): boolean => Boolean(filters.search.trim() || filters.className || filters.role);
