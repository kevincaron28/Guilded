// Simpler companion (8.5, track F2): the Reserves, Wishlist, Raid prices and Roster & loot
// settings pages stay out of the menu until the member's guild uses raid cores or soft reserves.
// Decided from the hub answer the app already loads at start (src/services/companion-hub.ts).
// Once a page has been shown on this PC it stays (`remembered`), so the menu never shrinks under
// the member because one request failed. Nothing is deleted: the pages and their data are intact.

export const OPTIONAL_PAGES = Object.freeze(["reserves", "wishlist", "pricing", "cores"]);

/**
 * @param {any} hub the hub-view answer's data, or null when it could not be read
 * @param {Record<string, boolean>} [remembered] pages already shown on this PC
 * @returns {Record<string, boolean>} page name → shown in the menu
 */
export function pagesInUse(hub, remembered = {}) {
  const used = Object.fromEntries(OPTIONAL_PAGES.map((page) => [page, remembered?.[page] === true]));
  const reserves = hub?.reserves;
  if (!reserves || typeof reserves !== "object") return used;
  const cores = Array.isArray(reserves.cores) ? reserves.cores : [];
  // A raid core means raid loot: prices, the roster, and wishlists shown on item tooltips.
  if (cores.length > 0) used.cores = used.pricing = used.wishlist = true;
  // A soft-reserve list was ever opened, or a core reserves its loot.
  if (reserves.list || cores.some((core) => core?.lootMode === "RESERVE")) used.reserves = true;
  return used;
}
