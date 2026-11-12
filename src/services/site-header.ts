import { siteUrl } from "../site-url.js";
import { readFileSync } from "node:fs";
import { editionHref, editionSection, FOOTER_COLUMNS, footerLinks, localizedHref, navLinks } from "../../site/nav.mjs";
import { currentEdition } from "./edition-context.js";
import { SITE_LOGO } from "./site-logo.js";

// The site menu (site/nav.mjs) for every bot-served page: /leaderboards/, /recruitment/, /me/ and
// the public guild pages under /g/. Plain HTML and inline CSS, no scripts: the drop-downs are
// <details> element and the phone menu is a checkbox, so they work under a script-free policy.
// It matches the static site's header (logo, six links, "Get the addon" button, EN/FR) and footer.

type Lang = "en" | "fr";

const chrome = readFileSync(new URL("../../site/design-tokens.css", import.meta.url), "utf8");
const chromeStart = chrome.indexOf("/* site-chrome:start */");
const chromeEnd = chrome.indexOf("/* site-chrome:end */");
export const SITE_HEADER_STYLE = `@font-face{font-family:Inter;font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/inter-latin.woff2") format("woff2")}
body{font-family:Inter,"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
${chrome.slice(chromeStart + "/* site-chrome:start */".length, chromeEnd).trim()}`;

// The website's 1200 × 630 link-preview card (site/images/social/), for pages without their own.
export const shareCard = (): string => siteUrl("/images/social/guilded-card.png");

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The current menu entry for a path, so the page is marked in the menu. Guild pages and recruitment belong to Find a guild. */
export function currentSection(path: string): string | null {
  if (/^\/(?:recruitment|g)\//.test(path)) return "community";
  if (/^\/me\//.test(path)) return "my-guilded";
  return /^\/leaderboards\//.test(path) ? "leaderboards" : null;
}

/** The site header. `languages` gives this page's address in each language, for the EN/FR switch;
 * `edition` the page's WoW edition (the request's by default), kept on public data links. */
export function siteHeader(lang: Lang, path: string, languages?: Record<Lang, string>, edition: string = currentEdition()): string {
  const t = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const playing = editionSection(edition) ?? editionSection("forever")!;
  const nav = navLinks({
    current: currentSection(path),
    href: (item) => localizedHref(editionHref(item.href, playing.id), lang),
    label: (item) => (lang === "fr" ? item.fr : item.en)
  });
  const switcher = languages ? `<div class="language-switch" role="group" aria-label="Language / Langue">${(["en", "fr"] as const)
    .map((code) => `<a href="${escape(languages[code])}" hreflang="${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ""}>${code.toUpperCase()}</a>`).join("")}</div>` : "";
  return `<header class="site-top"><div class="site-top-inner"><a class="brand" href="/?lang=${lang}"><img src="${SITE_LOGO}" alt="" width="40" height="40"><span>GUILDED<span class="brand-caption">${t("YOUR GUILD, CONNECTED.", "VOTRE GUILDE, CONNECTÉE.")}</span></span></a>`
    + `<input type="checkbox" id="site-menu" class="menu-check"><label for="site-menu" class="menu-label">Menu <span aria-hidden="true">☰</span></label>`
    + `<nav aria-label="${t("Main navigation", "Navigation principale")}">${nav}${switcher}</nav></div></header>`;
}

/** The footer columns shared with the static site (site/nav.mjs), in the page language and edition. */
export function siteFooterNav(lang: Lang, edition: string = currentEdition()): string {
  const playing = editionSection(edition) ?? editionSection("forever")!;
  return footerLinks({
    ariaLabel: lang === "fr" ? "Plan du site" : "Site map",
    href: (item) => localizedHref(editionHref(item.href, playing.id), lang),
    label: (item) => (lang === "fr" ? item.fr : item.en),
    columnLabel: (key) => FOOTER_COLUMNS[key]![lang]
  });
}

/** "Leaderboards › Guilds › Quebec Gold": each item is [label, href] (the last one has no link). */
export function breadcrumbs(lang: Lang, items: [string, string | null][], escape: (text: string) => string): string {
  return `<nav class="crumbs" aria-label="${lang === "fr" ? "Fil d'Ariane" : "Breadcrumb"}">${items.map(([label, href]) => (href ? `<a href="${escape(href)}">${escape(label)}</a>` : `<span aria-current="page">${escape(label)}</span>`)).join(" › ")}</nav>`;
}
