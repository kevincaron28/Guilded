// The one main menu for every guilded.kcaron.top page: the static site (scripts/build-site.mjs)
// and the bot-served pages (src/services/web-layout.ts). Change the menu here only.
// `bot: true` pages are served by the bot and keep the page language with ?lang=.
// Five top-level entries (29 October 2026 review): links with a `group` sit in that group's
// drop-down, a plain <details> element that works without scripts.

/** @typedef {{ key: string, href: string, en: string, fr: string, bot?: boolean, group?: string }} NavItem */

/** @type {Record<string, { en: string, fr: string }>} */
export const NAV_GROUPS = {
  community: { en: "Community", fr: "Communauté" },
  help: { en: "Help", fr: "Aide" }
};

/** @type {NavItem[]} */
export const SITE_NAV = [
  { key: "download", href: "/editions/", en: "Download", fr: "Télécharger" },
  { key: "features", href: "/features/", en: "Features", fr: "Fonctions" },
  { key: "leaderboards", href: "/leaderboards/", en: "Leaderboards", fr: "Classements", bot: true, group: "community" },
  // The guild directory sits under /recruitment/ because the Cloudflare Worker already forwards it.
  { key: "guilds", href: "/recruitment/guilds/", en: "Find a guild", fr: "Trouver une guilde", bot: true, group: "community" },
  { key: "recruitment", href: "/recruitment/", en: "Recruitment", fr: "Recrutement", bot: true, group: "community" },
  { key: "players", href: "/players/", en: "Players", fr: "Joueurs", bot: true, group: "community" },
  { key: "guides", href: "/docs/QUICK_START.html", en: "Guides", fr: "Guides", group: "help" },
  { key: "officers", href: "/officers/", en: "For officers", fr: "Pour les officiers", group: "help" },
  { key: "forever", href: "/forever/", en: "WoW Forever launch", fr: "Lancement de WoW Forever", group: "help" },
  { key: "discord", href: "https://discord.gg/YjzFwtP64V", en: "Ask on Discord ↗", fr: "Demander sur Discord ↗", group: "help" },
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
  if (!/^(?:\/?|(?:.*\/)?index\.html|(?:.*\/)?(?:features|officers|forever)\/|(?:.*\/)?editions\/(?:[a-z-]+\/)?|\/companion\/|\/(?:leaderboards|recruitment|players|me)(?:\/.*)?)$/.test(path)) return href;
  const query = new URLSearchParams(search);
  query.set("lang", lang);
  return `${path}?${query}${hash ? `#${hash}` : ""}`;
}

/**
 * The menu as HTML: plain links, and one drop-down per group at its first link's place. label(item)
 * gives the link text; href(item) the address (defaults to item.href); groupLabel(key) a group's
 * name; current is the key of the page being shown.
 * @param {{ label: (item: NavItem) => string, href?: (item: NavItem) => string, groupLabel?: (key: string) => string, current?: string | null }} options
 * @returns {string}
 */
export function navLinks({ label, href = (item) => item.href, groupLabel = (key) => NAV_GROUPS[key].en, current = null }) {
  const anchor = (item) => `<a href="${escape(href(item))}"${item.key === "companion" ? ' class="nav-companion"' : ""}${item.key === current ? ' aria-current="page"' : ""}>${label(item)}</a>`;
  const shown = new Set();
  return SITE_NAV.map((item) => {
    if (!item.group) return anchor(item);
    if (shown.has(item.group)) return "";
    shown.add(item.group);
    const members = SITE_NAV.filter((other) => other.group === item.group);
    const active = members.some((other) => other.key === current);
    return `<details class="nav-group${active ? " has-current" : ""}" data-nav-group="${item.group}"><summary>${groupLabel(item.group)}</summary><div class="nav-menu">${members.map(anchor).join("")}</div></details>`;
  }).join("");
}
