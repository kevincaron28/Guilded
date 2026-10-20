// The one main menu for every guilded.kcaron.top page: the static site (scripts/build-site.mjs)
// and the bot-served pages (src/services/web-layout.ts). Change the menu here only.
// `bot: true` pages are served by the bot and keep the page language with ?lang=.

/** @typedef {{ key: string, href: string, en: string, fr: string, bot?: boolean }} NavItem */

/** @type {NavItem[]} */
export const SITE_NAV = [
  { key: "features", href: "/features/", en: "Features", fr: "Fonctions" },
  { key: "guides", href: "/docs/QUICK_START.html", en: "Guides", fr: "Guides" },
  { key: "leaderboards", href: "/leaderboards/", en: "Leaderboards", fr: "Classements", bot: true },
  { key: "recruitment", href: "/recruitment/", en: "Recruitment", fr: "Recrutement", bot: true },
  { key: "players", href: "/players/", en: "Players", fr: "Joueurs", bot: true },
  { key: "download", href: "/#start", en: "Download", fr: "Télécharger" },
  { key: "companion", href: "/companion/", en: "Companion", fr: "Compagnon" }
];

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/**
 * The menu links as HTML. label(item) gives the link text; href(item) the address
 * (defaults to item.href); current is the key of the page being shown.
 * @param {{ label: (item: NavItem) => string, href?: (item: NavItem) => string, current?: string | null }} options
 * @returns {string}
 */
export function navLinks({ label, href = (item) => item.href, current = null }) {
  return SITE_NAV.map((item) => `<a href="${escape(href(item))}"${item.key === "companion" ? ' class="nav-companion"' : ""}${item.key === current ? ' aria-current="page"' : ""}>${label(item)}</a>`).join("");
}
