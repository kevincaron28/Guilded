import { gameEditionOf } from "./game-edition.mjs";

export const realmKey = value => String(value ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

const bareLower = value => String(value ?? "").split("-")[0].trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
/** An id as sent or stored (hex string, bigint or number); empty means unknown. */
const idText = value => value === undefined || value === null || value === "" ? null : String(value);

/**
 * WoW Forever names during the 8.5 move from first-name keys to full "First Last" names: the
 * same name, or one side is a bare first name (an older addon, a row stored before the fix)
 * and the other a full name starting with it. Callers accept the loose match only when it is
 * the single candidate (see foreverNameMatches).
 * Character IDs (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md), always on: with both ids known they alone decide (equal = same
 * character, even renamed); with one id known only the exact name counts, never the loose first-name branch. The loose rule below
 * runs only when neither side has an id (rows and reports not yet stamped).
 */
export function foreverSameName(a, b, idA, idB) {
  const x = bareLower(a), y = bareLower(b);
  const p = idText(idA), q = idText(idB);
  if (p !== null && q !== null) return p === q;
  if (p !== null || q !== null) return !!x && x === y;
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.includes(" ") ? [y, x] : [x, y];
  return !short.includes(" ") && long.includes(" ") && long.startsWith(`${short} `);
}
/**
 * Items whose name is exactly `name`; failing that, the single loose (first-name) match, or none.
 * Items may carry `wowId` (bigint or null). A loose match never lands on an item with an id; with `refId` (the report's id) the item
 * holding that id wins, and an item with a different id never matches, even by exact name.
 */
export function foreverNameMatches(items, name, nameOf = item => item.name, refId = /** @type {unknown} */ (null)) {
  const wanted = bareLower(name);
  let exact = items.filter(item => bareLower(nameOf(item)) === wanted);
  const ref = idText(refId);
  if (ref !== null) {
    const held = items.find(item => idText(item.wowId) === ref);
    if (held) return [held];
    exact = exact.filter(item => idText(item.wowId) === null);
  }
  if (exact.length) return exact;
  const loose = items.filter(item => idText(item.wowId) === null && foreverSameName(nameOf(item), name));
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
