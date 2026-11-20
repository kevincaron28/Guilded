import { gameEditionOf } from "./game-edition.mjs";

export const realmKey = value => String(value ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

const bareLower = value => String(value ?? "").split("-")[0].trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
/**
 * WoW Forever names during the 8.5 move from first-name keys to full "First Last" names: the
 * same name, or one side is a bare first name (an older addon, a row stored before the fix)
 * and the other a full name starting with it. Callers accept the loose match only when it is
 * the single candidate (see foreverNameMatches).
 */
/**
 * (Character ids, docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md) The character id the addon read from a GUID: lowercase hex of the
 * low part, no leading zeros, 1-16 digits. Anything else is "no id" (undefined), never an error.
 */
export function characterId(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!/^[0-9a-f]{1,16}$/.test(text)) return undefined;
  const stripped = text.replace(/^0+/, "");
  return stripped === "" ? undefined : stripped;
}
/** The shared rule, pairwise: both ids known -> equal ids decide; otherwise the name rule (foreverSameName). */
export function sameCharacter(a, b, idA, idB) {
  const x = characterId(idA), y = characterId(idB);
  if (x && y) return x === y;
  return foreverSameName(a, b);
}
export function foreverSameName(a, b) {
  const x = bareLower(a), y = bareLower(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.includes(" ") ? [y, x] : [x, y];
  return !short.includes(" ") && long.includes(" ") && long.startsWith(`${short} `);
}
/** Items whose name is exactly `name`; failing that, the single loose (first-name) match, or none. */
export function foreverNameMatches(items, name, nameOf = item => item.name, id, idOf = item => item.id) {
  // With an id: the items holding it are the answer; items holding another id are never the character; items without an id match by name.
  const wantedId = characterId(id);
  if (wantedId) {
    const byId = items.filter(item => characterId(idOf(item)) === wantedId);
    if (byId.length) return byId;
    items = items.filter(item => !characterId(idOf(item)));
  }
  const wanted = bareLower(name);
  const exact = items.filter(item => bareLower(nameOf(item)) === wanted);
  if (exact.length) return exact;
  const loose = items.filter(item => foreverSameName(nameOf(item), name));
  return loose.length === 1 ? loose : [];
}
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
