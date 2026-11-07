// Forever-only focus for the static site (companion/active-editions.mjs, companion/active-games.mjs).
// Pure helpers so the build and the tests share one rule; every parameter defaults to the live switch.
import { ACTIVE_EDITIONS } from "../companion/active-editions.mjs";
import { ACTIVE_GAMES, ACTIVE_TRACKING } from "../companion/active-games.mjs";

/** Previews and tests can build every page: GUILDED_ALL_PAGES=1. */
export const buildEverything = () => process.env["GUILDED_ALL_PAGES"] === "1";
const ALL_EDITIONS = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"];

/** A page of a held edition (gameEdition) or game (requiresGame) is not built. */
export const keepPage = (page, editions = buildEverything() ? ALL_EDITIONS : ACTIVE_EDITIONS, games = ACTIVE_GAMES) =>
  (!page.gameEdition || editions.includes(page.gameEdition)) && (!page.requiresGame || games.includes(page.requiresGame));

/** Without PoE2 tracking, a line marked <!--poe--> disappears and <!--poe:text--> spans are dropped; with it, the spans show. */
export const stripPoe = (markdown, poe = ACTIVE_TRACKING.includes("poe2")) => poe
  ? markdown.replace(/<!--poe:(.*?)-->/g, "$1")
  : markdown.split("\n").filter(line => !line.includes("<!--poe-->")).join("\n").replace(/<!--poe:.*?-->/g, "");

/** Without PoE2 tracking, use the page's PoE-free title and descriptions when it has them. */
export const withoutPoe = (page, poe = ACTIVE_TRACKING.includes("poe2")) => poe ? page
  : { ...page, title: page.titleNoPoe ?? page.title, description: page.descriptionNoPoe ?? page.description, descriptionFr: page.descriptionFrNoPoe ?? page.descriptionFr };
