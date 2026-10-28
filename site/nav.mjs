// The one main menu for every guilded.kcaron.top page: the static site (scripts/build-site.mjs)
// and the bot-served pages (src/services/web-layout.ts). Change the menu here only.
// `bot: true` pages are served by the bot and keep the page language with ?lang=.

/** @typedef {{ key: string, href: string, en: string, fr: string, bot?: boolean }} NavItem */

/** @type {NavItem[]} */
export const SITE_NAV = [
  { key: "editions", href: "/editions/", en: "WoW versions", fr: "Versions WoW" },
  { key: "features", href: "/features/", en: "Features", fr: "Fonctions" },
  { key: "guides", href: "/docs/QUICK_START.html", en: "Guides", fr: "Guides" },
  { key: "leaderboards", href: "/leaderboards/", en: "Leaderboards", fr: "Classements", bot: true },
  // The guild directory sits under /recruitment/ because the Cloudflare Worker already forwards it.
  { key: "guilds", href: "/recruitment/guilds/", en: "Guilds", fr: "Guildes", bot: true },
  { key: "recruitment", href: "/recruitment/", en: "Recruitment", fr: "Recrutement", bot: true },
  { key: "players", href: "/players/", en: "Players", fr: "Joueurs", bot: true },
  { key: "download", href: "/#start", en: "Download", fr: "Télécharger" },
  { key: "companion", href: "/companion/", en: "Companion", fr: "Compagnon" }
];

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** Keep the selected WoW data set when navigating between public data pages.
 * Static content, external addresses and explicit edition choices stay unchanged.
 * @param {string} href
 * @param {string | null | undefined} edition
 */
export function editionHref(href, edition) {
  if (!edition || edition === "forever" || !/^(?:classic-era|classic-tbc|classic-mists|retail)$/.test(edition)
    || !/^\/(?:leaderboards|recruitment|players|me)(?:\/|\?|#|$)/.test(href)) return href;
  const [base, hash = ""] = href.split("#");
  const [path, search = ""] = base.split("?");
  const query = new URLSearchParams(search);
  if (query.has("edition")) return href;
  query.set("edition", edition);
  return `${path}?${query}${hash ? `#${hash}` : ""}`;
}

/** Keep the chosen language across translated pages and bilingual guide sections.
 * Leave external URLs, files and unrelated query parameters alone.
 * @param {string} href
 * @param {"en" | "fr"} lang
 */
export function localizedHref(href, lang) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const [base, hash = ""] = href.split("#");
  const [path, search = ""] = base.split("?");
  if (/(?:^|\/)docs\/(?:QUICK_START|MEMBER_INSTALL|DUNGEONS_GUIDE|EPGP_GUIDE|HOSTED_PILOT|SUPPORT_GUILDED)(?:\.html)?$/.test(path)) {
    return base + (hash && hash !== "fr" ? `#${hash}` : lang === "fr" ? "#fr" : "");
  }
  if (!/^(?:\/?|(?:.*\/)?index\.html|(?:.*\/)?features\/|(?:.*\/)?editions\/(?:[a-z-]+\/)?|\/companion\/|\/(?:leaderboards|recruitment|players|me)(?:\/.*)?)$/.test(path)) return href;
  const query = new URLSearchParams(search);
  query.set("lang", lang);
  return `${path}?${query}${hash ? `#${hash}` : ""}`;
}

/**
 * The menu links as HTML. label(item) gives the link text; href(item) the address
 * (defaults to item.href); current is the key of the page being shown.
 * @param {{ label: (item: NavItem) => string, href?: (item: NavItem) => string, current?: string | null }} options
 * @returns {string}
 */
export function navLinks({ label, href = (item) => item.href, current = null }) {
  return SITE_NAV.map((item) => `<a href="${escape(href(item))}"${item.key === "companion" ? ' class="nav-companion"' : ""}${item.key === current ? ' aria-current="page"' : ""}>${label(item)}</a>`).join("");
}
