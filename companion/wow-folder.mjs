// Which WoW game folder a saved file comes from. Guilded supports WoW Forever only
// (docs/plans/FOREVER_ONLY_REMOVAL.md), so the companion skips files from game folders that clearly belong
// to another WoW version (Classic Era, TBC Anniversary, Retail) and says so plainly.
// Plain ESM with no imports: the Electron main process and the renderer bundle both load it.

/**
 * "forever" for a Forever folder ("_classic_beta_" was the closed Forever beta client), "other" for a
 * folder that clearly belongs to another WoW version, null when the name does not tell. "_classic_" in
 * particular is NOT judged, because the live Forever client may save there.
 * @param {string} name the "_xxx_" game folder inside the install, or the install folder itself
 * @returns {"forever" | "other" | null}
 */
export function folderEdition(name) {
  const folder = String(name ?? "").toLowerCase();
  if (/forever/.test(folder) || /beta/.test(folder)) return "forever";
  if (folder === "_classic_era_" || folder === "_anniversary_" || folder === "_retail_") return "other";
  return null;
}

/** True when a game folder clearly belongs to a WoW version other than Forever. @param {string} name */
export const isOtherEditionFolder = (name) => folderEdition(name) === "other";

