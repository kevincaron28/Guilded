// GAMES SWITCH. The one place that decides which games beyond WoW members are offered.
//
// Guilded also has a Path of Exile 2 (PoE2) module. While the owner concentrates on WoW Forever the
// PoE2 community on Discord stays (ACTIVE_GAMES) and PoE2 tracking is off (ACTIVE_TRACKING, below).
// Nothing is deleted: database tables, saved uploads, the code and the PoE2 docs all stay.
//
// TO TURN PoE2 COMMUNITY OFF: remove "poe2" from ACTIVE_GAMES (event boards, seasons, site pages follow). tests/forever-only-focus.test.ts proves that every surface follows.
// WoW editions: Guilded supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md).
//
// Plain ESM with no imports so the companion, site build, Worker and bot can all load it.
export const ACTIVE_GAMES = /** @type {readonly string[]} */ (["wow", "poe2"]);

// PoE2 TRACKING is a separate switch: the companion's Client.txt log tracking and settings, the /poe journal
// commands, the companion API routes, PoE2 achievements and the journal text in help/FAQ/site. It is OFF while
// the owner focuses on WoW Forever. PoE2 as a Discord community (channels, roles, event boards, seasons) stays on
// through ACTIVE_GAMES. TO BRING TRACKING BACK: ["poe2"] below.
export const ACTIVE_TRACKING = /** @type {readonly string[]} */ ([]);
export const poeTrackingEnabled = (active = ACTIVE_TRACKING) => active.includes("poe2");
export const POE_TRACKING_ENABLED = poeTrackingEnabled();

/** @param {string} game @param {readonly string[]} [active] */
export const isGameActive = (game, active = ACTIVE_GAMES) => active.includes(game);

/** True when the Path of Exile 2 module is offered. @param {readonly string[]} [active] */
export const poeEnabled = (active = ACTIVE_GAMES) => active.includes("poe2");
export const POE_ENABLED = poeEnabled();

/** Shown where an old link or command still reaches a switched-off game. */
export const GAME_ON_HOLD_NOTE = [
  "Path of Exile 2 tracking is on hold while Guilded focuses on WoW Forever. Nothing was deleted and it will come back later.",
  "Le suivi Path of Exile 2 est en pause pendant que Guilded se concentre sur WoW Forever. Rien n’a été supprimé; elle reviendra plus tard."
];

/** True when this companion config tracks PoE2: the tracking switch is on AND the member enabled it.
 * @param {{ poeEnabled?: unknown }} config @param {boolean} [tracking] */
export const poeTrackingOn = (config, tracking = POE_TRACKING_ENABLED) => tracking && config.poeEnabled === true;
