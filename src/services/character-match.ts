// Finds a linked character by name and realm. Exact (case-insensitive) first;
// if the realm differs, a name that is unique among the guild's characters
// still matches. WoW Forever has no real realms, so the realm the addon
// reports (GetRealmName) may not equal the one the companion is configured
// with, and a single mismatch must not reject a whole import.
import { realmKey, characterReference } from "../../companion/character-identity.mjs";
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
  return sameName.length === 1 && (gameEdition ?? sameName[0]?.gameEdition ?? "forever") === "forever" ? sameName[0] : undefined;
}
