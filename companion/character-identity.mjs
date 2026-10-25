import { gameEditionOf } from "./game-edition.mjs";

export const realmKey = value => String(value ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
export function characterReference(name, realm, edition = "forever") {
  if (edition === "forever") return { character: String(name), realm: String(realm) };
  const match = String(name).match(/^([^\s-]+)-(.+)$/);
  return { character: match?.[1] ?? String(name), realm: realmKey(match?.[2] ?? realm) };
}
export function characterKey(name, realm, edition = "forever") {
  const ref = characterReference(name, realm, edition);
  return edition === "forever" ? ref.character.trim().normalize("NFC").toLowerCase()
    : `${ref.character.trim().normalize("NFC").toLowerCase()}-${ref.realm}`;
}

/** Apply the same identity rule to every character reference in an export. */
export function normalizeExportIdentities(value, edition, defaultRealm) {
  if (Array.isArray(value)) return value.map(row => normalizeExportIdentities(row, edition, defaultRealm));
  if (!value || typeof value !== "object") return value;
  const out = Object.fromEntries(Object.entries(value).map(([key, row]) => [key, normalizeExportIdentities(row, edition, defaultRealm)]));
  if (typeof out.character === "string" && typeof out.realm === "string") Object.assign(out, characterReference(out.character, out.realm || defaultRealm, edition));
  if (typeof out.name === "string" && typeof out.class === "string" && typeof out.realm === "string") {
    if (out.gameEdition !== undefined || out.interface !== undefined) {
      if (gameEditionOf(out) !== edition) throw new Error("The saved file contains characters from different WoW editions.");
    }
    const ref = characterReference(out.name, out.realm || defaultRealm, edition);
    Object.assign(out, { name: ref.character, realm: ref.realm, gameEdition: edition });
  }
  return out;
}
