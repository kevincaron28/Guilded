// Which static pages are built: WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md), and PoE2 pages follow the
// held-game switch (companion/active-games.mjs). Pure helpers so the build and the tests share one rule.
import { ACTIVE_GAMES, ACTIVE_TRACKING } from "../companion/active-games.mjs";

/** A page of another WoW edition (gameEdition) or of a held game (requiresGame) is not built. */
export const keepPage = (page, games = ACTIVE_GAMES) =>
  (!page.gameEdition || page.gameEdition === "forever") && (!page.requiresGame || games.includes(page.requiresGame));

/** Without PoE2 tracking, a line marked <!--poe--> disappears and <!--poe:text--> spans are dropped; with it, the spans show. */
export const stripPoe = (markdown, poe = ACTIVE_TRACKING.includes("poe2")) => poe
  ? markdown.replace(/<!--poe:(.*?)-->/g, "$1")
  : markdown.split("\n").filter(line => !line.includes("<!--poe-->")).join("\n").replace(/<!--poe:.*?-->/g, "");

/** Without PoE2 tracking, use the page's PoE-free title and descriptions when it has them. */
export const withoutPoe = (page, poe = ACTIVE_TRACKING.includes("poe2")) => poe ? page
  : { ...page, title: page.titleNoPoe ?? page.title, description: page.descriptionNoPoe ?? page.description, descriptionFr: page.descriptionFrNoPoe ?? page.descriptionFr };
