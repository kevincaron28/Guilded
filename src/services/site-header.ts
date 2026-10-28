import { editionHref, localizedHref, navLinks } from "../../site/nav.mjs";
import { currentEdition } from "./edition-context.js";

// The site menu (site/nav.mjs) for every bot-served page: /leaderboards/, /recruitment/, /me/ and
// the public guild pages under /g/. Plain HTML and inline CSS, no scripts.

type Lang = "en" | "fr";

export const SITE_HEADER_STYLE = `.site-top{display:flex;flex-wrap:wrap;gap:10px 28px;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px}
.site-top .brand{color:var(--text);font-weight:800;letter-spacing:.15em;text-decoration:none}.site-top nav{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px}
.site-top nav a{display:inline-flex;align-items:center;min-height:44px;color:var(--muted);text-decoration:none}.site-top nav a:hover,.site-top nav a[aria-current=page]{color:var(--text)}.site-top nav a.nav-companion{color:var(--gold)}
.crumbs{font-size:13px;color:var(--muted);margin:14px 0 20px}.crumbs a{color:var(--muted)}.crumbs a:hover{color:var(--text)}`;

/** The current menu entry for a path, so the page is marked in the menu. Guild pages belong to Guilds. */
export function currentSection(path: string): string | null {
  if (/^\/(?:recruitment\/guilds|g)\//.test(path)) return "guilds";
  return /^\/(leaderboards|recruitment|players)\//.exec(path)?.[1] ?? null;
}

export function siteHeader(lang: Lang, path: string): string {
  const nav = navLinks({ current: currentSection(path), href: (item) => localizedHref(editionHref(item.href, currentEdition()), lang), label: (item) => (lang === "fr" ? item.fr : item.en) });
  return `<header class="site-top"><a class="brand" href="/?lang=${lang}">GUILDED</a><nav aria-label="${lang === "fr" ? "Navigation principale" : "Main navigation"}">${nav}</nav></header>`;
}

/** "Leaderboards › Guilds › Quebec Gold": each item is [label, href] (the last one has no link). */
export function breadcrumbs(lang: Lang, items: [string, string | null][], escape: (text: string) => string): string {
  return `<nav class="crumbs" aria-label="${lang === "fr" ? "Fil d'Ariane" : "Breadcrumb"}">${items.map(([label, href]) => (href ? `<a href="${escape(href)}">${escape(label)}</a>` : `<span aria-current="page">${escape(label)}</span>`)).join(" › ")}</nav>`;
}
