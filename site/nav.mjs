// The one main menu for every guilded.kcaron.top page: the static site (scripts/build-site.mjs)
// and the bot-served pages (src/services/web-layout.ts). Change the menu and footer here only.
// `bot: true` pages are served by the bot and keep the page language with ?lang=.
// 2 November 2026 rebuild: six visible entries and no hidden drop-downs for them. "Get the addon"
// (`cta`) is the one button. Everything else (officers, companion, status, Discord...) sits in the
// footer columns below, which every page shows.

/** @typedef {{ key: string, href: string, en: string, fr: string, bot?: boolean, cta?: boolean }} NavItem */

/** @type {NavItem[]} */
export const SITE_NAV = [
  { key: "features", href: "/features/", en: "Features", fr: "Fonctions" },
  { key: "guides", href: "/docs/QUICK_START.html", en: "Guides", fr: "Guides" },
  { key: "leaderboards", href: "/leaderboards/", en: "Leaderboards", fr: "Classements", bot: true },
  // The guild directory sits under /recruitment/ because the Cloudflare Worker already forwards it.
  { key: "guilds", href: "/recruitment/guilds/", en: "Find a guild", fr: "Trouver une guilde", bot: true },
  { key: "my-guilded", href: "/me/", en: "My Guilded", fr: "Mon Guilded", bot: true },
  { key: "download", href: "/editions/", en: "Get the addon", fr: "Obtenir l’addon", cta: true }
];

/** @typedef {{ key: string, href: string, en: string, fr: string, column: string, bot?: boolean }} FooterItem */

/** @type {Record<string, { en: string, fr: string }>} */
export const FOOTER_COLUMNS = {
  product: { en: "Guilded", fr: "Guilded" },
  community: { en: "Community", fr: "Communauté" },
  help: { en: "Help", fr: "Aide" },
  about: { en: "About", fr: "À propos" }
};

/** @type {FooterItem[]} */
export const FOOTER_NAV = [
  { key: "download", column: "product", href: "/editions/", en: "Get the addon", fr: "Obtenir l’addon" },
  { key: "features", column: "product", href: "/features/", en: "Features", fr: "Fonctions" },
  { key: "officers", column: "product", href: "/officers/", en: "For officers", fr: "Pour les officiers" },
  { key: "companion", column: "product", href: "/companion/", en: "Companion app", fr: "Application compagnon" },
  { key: "forever", column: "product", href: "/forever/", en: "WoW Forever launch", fr: "Lancement de WoW Forever" },
  { key: "leaderboards", column: "community", href: "/leaderboards/", en: "Leaderboards", fr: "Classements", bot: true },
  { key: "guilds", column: "community", href: "/recruitment/guilds/", en: "Find a guild", fr: "Trouver une guilde", bot: true },
  { key: "recruitment", column: "community", href: "/recruitment/", en: "Recruitment", fr: "Recrutement", bot: true },
  { key: "players", column: "community", href: "/players/", en: "Players", fr: "Joueurs", bot: true },
  { key: "my-guilded", column: "community", href: "/me/", en: "My Guilded", fr: "Mon Guilded", bot: true },
  { key: "discord", column: "community", href: "https://discord.gg/YjzFwtP64V", en: "Ask on Discord ↗", fr: "Demander sur Discord ↗" },
  { key: "guides", column: "help", href: "/docs/QUICK_START.html", en: "Quick start", fr: "Démarrage rapide" },
  { key: "install", column: "help", href: "/docs/MEMBER_INSTALL.html", en: "Install guide", fr: "Guide d’installation" },
  { key: "setup-help", column: "help", href: "/docs/AI_SETUP_HELP.html", en: "Setup help", fr: "Aide à la configuration" },
  { key: "status", column: "help", href: "/status/", en: "Service status", fr: "État du service" },
  { key: "privacy", column: "help", href: "/docs/PRIVACY.html", en: "Privacy", fr: "Confidentialité" },
  { key: "support", column: "about", href: "/docs/SUPPORT_GUILDED.html", en: "Support Guilded", fr: "Soutenir Guilded" },
  { key: "releases", column: "about", href: "https://github.com/kevincaron28/Guilded/releases", en: "Releases ↗", fr: "Versions ↗" },
  { key: "quebec-gold", column: "about", href: "/quebec-gold/", en: "Quebec Gold", fr: "Quebec Gold" },
  { key: "kcaron", column: "about", href: "https://kcaron.top/", en: "By KCaron ↗", fr: "Par KCaron ↗" }
];

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** @typedef {{ id: string, slug: string, en: string, fr: string }} EditionSection */

/** One website section per WoW edition (29 October 2026): /forever/, /classic-era/, /tbc/, /mists/
 * and /retail/. Each holds the edition's hub page and its own leaderboards, recruitment and player
 * pages (/retail/leaderboards/...). The Cloudflare Worker serves them; `id` is the bot's edition.
 * @type {EditionSection[]} */
export const EDITION_SECTIONS = [
  { id: "forever", slug: "forever", en: "WoW Forever", fr: "WoW Forever" },
  { id: "classic-era", slug: "classic-era", en: "Classic Era", fr: "Classic Era" },
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
 * The menu as HTML: one plain link per entry, no drop-downs; the `cta` entry is the button.
 * label(item) gives the link text; href(item) the address (defaults to item.href); current is the
 * key of the page being shown.
 * @param {{ label: (item: NavItem) => string, href?: (item: NavItem) => string, current?: string | null }} options
 * @returns {string}
 */
export function navLinks({ label, href = (item) => item.href, current = null }) {
  return SITE_NAV.map((item) => `<a href="${escape(href(item))}"${item.cta ? ' class="nav-cta"' : ""}${item.key === current ? ' aria-current="page"' : ""}>${label(item)}</a>`).join("");
}

/**
 * The footer columns as HTML, the same on every page: Guilded, Community, Help and About.
 * label(item) gives the link text, href(item) the address, columnLabel(key) a column's title.
 * @param {{ label: (item: FooterItem) => string, href?: (item: FooterItem) => string, columnLabel?: (key: string) => string, ariaLabel?: string }} options
 * @returns {string}
 */
export function footerLinks({ label, href = (item) => item.href, columnLabel = (key) => FOOTER_COLUMNS[key].en, ariaLabel = "Site map" }) {
  const columns = Object.keys(FOOTER_COLUMNS).map((key) => `<div class="footer-col"><p class="footer-title">${columnLabel(key)}</p><ul>${FOOTER_NAV.filter((item) => item.column === key).map((item) => `<li><a href="${escape(href(item))}">${label(item)}</a></li>`).join("")}</ul></div>`);
  return `<nav class="footer-cols" aria-label="${escape(ariaLabel)}">${columns.join("")}</nav>`;
}
