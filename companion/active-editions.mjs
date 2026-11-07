// FOREVER-FIRST SWITCH: which WoW editions the website and bot still offer.
//
// Being retired: Guilded supports WoW Forever only, and the other editions are being removed in
// staged PRs (docs/plans/FOREVER_ONLY_REMOVAL.md). The addons, release packaging and the companion
// no longer use this file (the companion judges game folders with companion/wow-folder.mjs). The
// bot and website still read it until their stages land; stage 6 deletes it.
//
// Plain ESM with no imports so the site build and bot can load it.
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
