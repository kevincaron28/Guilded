// Finds a linked character by name and realm. Exact (case-insensitive) first;
// if the realm differs, a name that is unique among the guild's characters
// still matches. WoW Forever has no real realms, so the realm the addon
// reports (GetRealmName) may not equal the one the companion is configured
// with, and a single mismatch must not reject a whole import.
import { realmKey, characterReference, foreverSameName } from "../../companion/character-identity.mjs";
import { currentEdition } from "./edition-context.js";

/** Manual pickers may use IDs, qualified names or an unambiguous bare name. */
export function selectedCharacter<T extends { id?: string; name: string; realm: string; displayName?: string | null }>(characters: readonly T[], value: string): T | undefined {
  const query = value.trim().toLowerCase();
  const reference = characterReference(value, "", "retail");
  const matches = characters.filter(character => character.id?.toLowerCase() === query
    || character.name.toLowerCase() === query || character.displayName?.toLowerCase() === query
    || reference.realm && character.name.toLowerCase() === reference.character.toLowerCase() && realmKey(character.realm) === reference.realm);
  if (matches.length > 1) throw new Error("Several characters have that name. Choose the character and realm from the list.");
  return matches[0];
}

export function findCharacter<T extends { name: string; realm: string; gameEdition?: string }>(characters: readonly T[], name: string, realm: string, gameEdition?: string): T | undefined {
  gameEdition ??= currentEdition();
  if (gameEdition && gameEdition !== "forever") {
    const ref = characterReference(name, realm, gameEdition);
    name = ref.character; realm = ref.realm;
  }
  const wanted = name.trim().toLowerCase();
  const sameName = characters.filter((candidate) => candidate.name.toLowerCase() === wanted && (gameEdition === undefined || (candidate.gameEdition ?? currentEdition() ?? "forever") === gameEdition));
  const exact = sameName.find((candidate) => realmKey(candidate.realm) === realmKey(realm));
  if (exact) return exact;
  if (sameName.length) return sameName.length === 1 && (gameEdition ?? sameName[0]?.gameEdition ?? "forever") === "forever" ? sameName[0] : undefined;
  return gameEdition === undefined || gameEdition === "forever" ? looseForeverMatch(characters, name, gameEdition) : undefined;
}

/**
 * WoW Forever, 8.5: keys moved from the first name to the full "First Last". A row stored as
 * "Lebowski" still matches an upload's "Lebowski Holyroller" (and the other way round) when it is
 * the only such row, and a bare row whose known full name is another alt's never does.
 */
function looseForeverMatch<T extends { name: string; realm: string; gameEdition?: string }>(characters: readonly T[], name: string, gameEdition?: string): T | undefined {
  const wanted = name.trim().replace(/\s+/g, " ").toLowerCase();
  const loose = characters.filter((candidate) => (candidate.gameEdition ?? currentEdition() ?? "forever") === (gameEdition ?? "forever")
    && foreverSameName(candidate.name, name)
    && (!wanted.includes(" ") || !(candidate as { displayName?: string | null }).displayName
      || (candidate as { displayName?: string | null }).displayName!.trim().replace(/\s+/g, " ").toLowerCase() === wanted));
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * EP/GP and DKP belong to a member, not a character. The member a ledger row's name belongs to:
 * the matching character's; for a pre-8.5 WoW Forever first name ("Lebowski") matching several
 * full-name characters, their member when they all belong to one member, or "shared" when they
 * belong to several (the row is held for an officer: SHARED_FIRST_NAME, /import held).
 */
export function ledgerOwner<T extends { name: string; realm: string; gameEdition?: string; memberId: string }>(characters: readonly T[], name: string, realm: string, gameEdition?: string): T | "shared" | undefined {
  const found = findCharacter(characters, name, realm, gameEdition);
  if (found) return found;
  const edition = gameEdition ?? currentEdition();
  if (edition && edition !== "forever") return undefined;
  const loose = characters.filter((candidate) => (candidate.gameEdition ?? currentEdition() ?? "forever") === "forever" && foreverSameName(candidate.name, name));
  const members = new Set(loose.map((candidate) => candidate.memberId));
  if (members.size === 1) return loose[0];
  return members.size > 1 ? "shared" : undefined;
}
