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
  { key: "status", href: "/status/", en: "Status", fr: "État du service", group: "help" },
  { key: "companion", href: "/companion/", en: "Companion", fr: "Compagnon" }
];

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** @typedef {{ id: string, slug: string, en: string, fr: string }} EditionSection */

/** One website section per WoW edition (29 October 2026): /forever/, /classic-era/, /tbc/, /mists/
 * and /retail/. Each holds the edition's hub page and its own leaderboards, recruitment and player
 * pages (/retail/leaderboards/...). The Cloudflare Worker serves them; `id` is the bot's edition.
 * @type {EditionSection[]} */
export const EDITION_SECTIONS = [
  { id: "forever", slug: "forever", en: "WoW Forever", fr: "WoW Forever" },
  { id: "classic-era", slug: "classic-era", en: "Classic Era / Hardcore", fr: "Classic Era / Hardcore" },
  { id: "classic-tbc", slug: "tbc", en: "Burning Crusade Classic", fr: "Burning Crusade Classic" },
  { id: "classic-mists", slug: "mists", en: "Mists of Pandaria Classic", fr: "Mists of Pandaria Classic" },
  { id: "retail", slug: "retail", en: "Retail", fr: "Retail" }
];

/** An edition's section from its id ("classic-tbc") or address name ("tbc"); null when unknown.
 * @param {string | null | undefined} name
 * @returns {EditionSection | null} */
export const editionSection = (name) => EDITION_SECTIONS.find((section) => section.id === name || section.slug === name) ?? null;

// The public data pages that live inside an edition's section.
const SECTION_PAGE = /^\/(?:leaderboards|recruitment|players)(?:\/|\?|#|$)/;

/** "/retail/leaderboards/guilds/" → the edition and the page inside it ("/leaderboards/guilds/").
 * @param {string} pathname
 * @returns {{ edition: string, slug: string, rest: string } | null} */
export function splitEditionPath(pathname) {
  const match = /^\/(forever|classic-era|tbc|mists|retail)(\/.*)?$/.exec(pathname);
  return match ? { edition: editionSection(match[1]).id, slug: match[1], rest: match[2] ?? "" } : null;
}

/** Keep the selected WoW edition when navigating between public data pages: leaderboards,
 * recruitment and players move into the edition's section (an explicit ?edition= wins); the
 * signed-in /me/ page keeps ?edition=. Static content and external addresses stay unchanged.
 * @param {string} href
 * @param {string | null | undefined} edition
 */
export function editionHref(href, edition) {
  const [base, hash = ""] = href.split("#");
  const [path, search = ""] = base.split("?");
  const query = new URLSearchParams(search);
  const chosen = editionSection(query.get("edition") ?? edition);
  if (!chosen) return href;
  if (SECTION_PAGE.test(href)) {
    query.delete("edition");
    const rest = query.toString();
    return `/${chosen.slug}${path}${rest ? `?${rest}` : ""}${hash ? `#${hash}` : ""}`;
  }
  if (!/^\/me(?:\/|\?|#|$)/.test(href) || chosen.id === "forever" || query.has("edition")) return href;
  query.set("edition", chosen.id);
  return `${path}?${query}${hash ? `#${hash}` : ""}`;
}

/** Where the version switcher sends a visitor: the same kind of page in the other edition
 * (a leaderboard stays a leaderboard), or that edition's hub page.
 * @param {string} path the current page's path, with or without its edition section
 * @param {string} edition
 */
export function editionSwitchHref(path, edition) {
  const section = editionSection(edition);
  if (!section) return "/editions/";
  const page = splitEditionPath(path)?.rest ?? path;
  const data = /^\/(leaderboards|recruitment|players)(\/guilds)?(?:\/|$)/.exec(page);
  if (data) return `/${section.slug}/${data[1]}/${data[2] ? "guilds/" : ""}`;
  if (/^\/me(?:\/|$)/.test(page)) return editionHref("/me/", section.id);
  if (/^\/editions\/[a-z-]+\/$/.test(page)) return `/editions/${section.id}/`;
  return `/${section.slug}/`;
}

/** The header's "Playing: WoW Forever ▾" switcher, a <details> drop-down that works without
 * scripts. title is the drop-down's label; label(section) and href(section) give each choice.
 * @param {{ current: string | null, title: string, label: (section: EditionSection) => string, href: (section: EditionSection) => string }} options
 * @returns {string} */
export function editionMenu({ current, title, label, href }) {
  return `<details class="nav-group edition-menu" data-nav-group="edition"><summary>${title}</summary><div class="nav-menu">${EDITION_SECTIONS.map((section) => `<a href="${escape(href(section))}" data-edition="${section.slug}"${section.id === current ? ' aria-current="true"' : ""}>${label(section)}</a>`).join("")}</div></details>`;
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
  if (!/^(?:\/?|(?:.*\/)?index\.html|(?:.*\/)?(?:features|officers)\/|(?:.*\/)?editions\/(?:[a-z-]+\/)?|\/companion\/|\/(?:(?:forever|classic-era|tbc|mists|retail)\/)?(?:leaderboards|recruitment|players)(?:\/.*)?|\/me(?:\/.*)?|(?:.*\/)?(?:forever|classic-era|tbc|mists|retail)\/)$/.test(path)) return href;
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
