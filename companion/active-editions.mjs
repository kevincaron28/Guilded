// FOREVER-FIRST SWITCH. The one place that decides which WoW editions members are offered.
//
// Guilded builds, tests and keeps data for every edition (Forever, Classic Era, TBC, Mists,
// Retail). While the owner concentrates on WoW Forever, only the editions listed here appear in
// member-facing choices: the companion's saved-file search, the website's download pages, the
// installer instructions and the bot's setup/help text. Nothing is deleted: addon builds, edition
// calendars, saved uploads, existing guilds and published artifacts are untouched, and a guild
// that already uses another edition keeps working.
//
// TO BRING THE OTHER EDITIONS BACK: put the ids back, for example
//   export const ACTIVE_EDITIONS = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"];
// (or `[...GAME_EDITIONS]`), run the tests and release. No other file needs editing; the tests in
// tests/active-editions.test.* prove every surface follows this list.
//
// Plain ESM with no imports so the companion (engine), site build and bot can all load it.
export const ACTIVE_EDITIONS = /** @type {readonly string[]} */ (["forever"]);

const ALL = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"];

/** Names used in prose, [English, French]. */
export const EDITION_NAMES = /** @type {Record<string, [string, string]>} */ ({
  forever: ["WoW Forever", "WoW Forever"],
  "classic-era": ["Classic Era/Hardcore", "Classic Era/Hardcore"],
  "classic-tbc": ["TBC Anniversary", "TBC Anniversary"],
  "classic-mists": ["Mists Classic", "Mists Classic"],
  retail: ["Retail", "Retail"]
});

/** @param {string} edition @param {readonly string[]} [active] */
export const isEditionActive = (edition, active = ACTIVE_EDITIONS) => active.includes(edition);

/** Editions in canonical order that are switched on. @param {readonly string[]} [active] */
export const activeEditions = (active = ACTIVE_EDITIONS) => ALL.filter((edition) => active.includes(edition));

/** Editions switched off (kept, just not offered). @param {readonly string[]} [active] */
export const heldEditions = (active = ACTIVE_EDITIONS) => ALL.filter((edition) => !active.includes(edition));

/** "WoW Forever", "Forever or Retail", "A, B and C". @param {0|1} lang @param {readonly string[]} [active] */
export function editionList(lang, active = ACTIVE_EDITIONS, joiner = ["or", "ou"]) {
  const names = activeEditions(active).map((edition) => EDITION_NAMES[edition][lang]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${joiner[lang]} ${names.at(-1)}`;
}

/**
 * Which edition a WoW game folder (the "_xxx_" folder inside the install, or the install folder
 * itself) belongs to. "_classic_beta_" is the closed WoW Forever beta client, so it counts as
 * Forever. A folder that names no edition returns null and is never treated as another edition:
 * "_classic_" in particular is NOT judged, because the live Forever client may save there.
 * @param {string} name @returns {string | null}
 */
export function folderEdition(name) {
  const folder = String(name ?? "").toLowerCase();
  if (/forever/.test(folder) || /beta/.test(folder)) return "forever";
  if (folder === "_classic_era_") return "classic-era";
  if (folder === "_anniversary_") return "classic-tbc";
  if (folder === "_retail_") return "retail";
  return null;
}

/** True when a game folder is on hold: it clearly belongs to an edition that is switched off.
 * @param {string} name @param {readonly string[]} [active] */
export function isFolderOnHold(name, active = ACTIVE_EDITIONS) {
  const edition = folderEdition(name);
  return edition !== null && !active.includes(edition);
}

/** Shown when the only WoW install found is for an edition that is switched off. */
export const ON_HOLD_NOTE = [
  "Guilded is focused on WoW Forever for now. Support for this WoW version is on hold and will come back later; nothing was changed or deleted.",
  "Guilded se concentre sur WoW Forever pour le moment. La prise en charge de cette version de WoW est en pause et reviendra plus tard; rien n’a été modifié ni supprimé."
];
