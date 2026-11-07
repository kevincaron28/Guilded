// Shared by the companion and the bot. Guilded supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md).
// GAME_EDITIONS still names the removed editions because stored rows (guilds, characters, runs, seasons)
// carry their ids and must stay readable: this file PARSES any of them. New data is refused at the upload
// entry points with assertForeverEdition().
export const GAME_EDITIONS = /** @type {const} */ (["forever", "classic-era", "classic-tbc", "classic-mists", "retail"]);

/** The only edition Guilded accepts new data for. */
export const SUPPORTED_EDITION = "forever";

/** The one plain answer to data from another WoW version. */
export const FOREVER_ONLY_MESSAGE = "Guilded supports WoW Forever only. This data comes from another WoW version; nothing was saved.";

/** Throws FOREVER_ONLY_MESSAGE unless the edition is WoW Forever. @param {string} edition */
export function assertForeverEdition(edition) {
  if (edition !== SUPPORTED_EDITION) throw new Error(FOREVER_ONLY_MESSAGE);
}

/** @typedef {typeof GAME_EDITIONS[number]} GameEdition */

/** @param {unknown} value @returns {GameEdition | null} */
export function editionFromInterface(value) {
  if (!Number.isInteger(value)) return null;
  const api = Number(value);
  if (api === 16001) return "forever";
  if (api >= 11500 && api < 11600) return "classic-era";
  if (api >= 20500 && api < 20600) return "classic-tbc";
  if (api >= 50500 && api < 50600) return "classic-mists";
  if (api >= 120000 && api < 130000) return "retail";
  return null;
}

/**
 * Missing metadata belongs to the legacy Forever format. Explicit unknown or
 * contradictory metadata must never silently enter that legacy namespace.
 * @param {{ gameEdition?: unknown, interface?: unknown }} source
 * @returns {GameEdition}
 */
export function gameEditionOf(source) {
  const stated = source.gameEdition;
  const observed = source.interface === undefined ? undefined : editionFromInterface(source.interface);
  if (observed === null) throw new Error("Unrecognized WoW client interface. Update Guilded before syncing this client.");
  if (stated !== undefined && !GAME_EDITIONS.some(edition => edition === stated)) throw new Error("Unrecognized WoW edition.");
  if (stated !== undefined && observed !== undefined && stated !== observed) throw new Error("WoW edition does not match the recorded client interface.");
  return /** @type {GameEdition} */ (stated ?? observed ?? "forever");
}

/** @param {{ gameEdition?: unknown, interface?: unknown }} source */
export function editionMetadata(source) {
  const gameEdition = gameEditionOf(source);
  return { gameEdition, ...(source.interface !== undefined ? { interface: Number(source.interface) } : {}) };
}

/** @param {{ gameEdition?: unknown, interface?: unknown }} local @param {{ gameEdition?: unknown, interface?: unknown }} remote */
export function assertSameEdition(local, remote) {
  if (gameEditionOf(local) !== gameEditionOf(remote)) throw new Error("The saved file and Discord guild use different WoW editions. Choose the matching file before syncing.");
}
