// Finds a linked character by name and realm. Exact (case-insensitive) first;
// if the realm differs, a name that is unique among the guild's characters
// still matches. WoW Forever has no real realms, so the realm the addon
// reports (GetRealmName) may not equal the one the companion is configured
// with, and a single mismatch must not reject a whole import.
export function findCharacter<T extends { name: string; realm: string; gameEdition?: string }>(characters: readonly T[], name: string, realm: string, gameEdition?: string): T | undefined {
  const wanted = name.trim().toLowerCase();
  const sameName = characters.filter((candidate) => candidate.name.toLowerCase() === wanted && (gameEdition === undefined || (candidate.gameEdition ?? "forever") === gameEdition));
  const exact = sameName.find((candidate) => candidate.realm.toLowerCase() === realm.trim().toLowerCase());
  if (exact) return exact;
  return sameName.length === 1 && (gameEdition ?? sameName[0]?.gameEdition ?? "forever") === "forever" ? sameName[0] : undefined;
}
