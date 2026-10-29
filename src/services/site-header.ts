import { editionHref, editionMenu, editionSection, editionSwitchHref, localizedHref, NAV_GROUPS, navLinks } from "../../site/nav.mjs";
import { currentEdition } from "./edition-context.js";
import { SITE_LOGO } from "./site-logo.js";

// The site menu (site/nav.mjs) for every bot-served page: /leaderboards/, /recruitment/, /me/ and
// the public guild pages under /g/. Plain HTML and inline CSS, no scripts: the drop-downs are
// <details> elements and the phone menu is a checkbox, so they work under a script-free policy.
// It matches the static site's header (logo, caption, drop-downs, EN/FR, Companion button).

type Lang = "en" | "fr";

export const SITE_HEADER_STYLE = `@font-face{font-family:Inter;font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/inter-latin.woff2") format("woff2")}
body{font-family:Inter,"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
.site-top{position:sticky;top:0;z-index:20;background:#111312ed;border-bottom:1px solid var(--line)}
.site-top-inner{max-width:1180px;margin:auto;padding:14px 32px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px}
.site-top .brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);font-size:19px;font-weight:800;letter-spacing:.15em;line-height:1.2;text-decoration:none}
.site-top .brand img{flex-shrink:0;border-radius:6px}.site-top .brand-caption{display:block;font-size:8px;font-weight:500;letter-spacing:.17em;color:var(--muted);margin-top:6px}
.site-top nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 18px;font-size:13px}
.site-top nav a,.nav-group>summary{display:inline-flex;align-items:center;min-height:44px;color:var(--muted);text-decoration:none}
.site-top nav a:hover,.site-top nav a[aria-current=page],.nav-group>summary:hover,.nav-group.has-current>summary,.nav-group[open]>summary{color:var(--text)}
.site-top nav a.nav-companion{border:1px solid #494d40;border-radius:5px;padding:0 14px;color:var(--text)}.site-top nav a.nav-companion:hover{border-color:var(--gold)}
.nav-group{position:relative}.nav-group>summary{list-style:none;cursor:pointer;gap:8px}.nav-group>summary::-webkit-details-marker{display:none}
.nav-group>summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.nav-group[open]>summary::after{transform:translateY(1px) rotate(225deg)}
.edition-menu>summary{border:1px solid #494d40;border-radius:5px;padding:0 12px;color:var(--text)}.edition-menu>summary strong{color:var(--gold);font-weight:650}
.site-top .edition-menu a[aria-current=true]{color:var(--gold)}
.nav-menu{position:absolute;top:calc(100% + 4px);left:-14px;z-index:30;min-width:230px;display:grid;padding:8px;background:#181c1a;border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 40px #0009}
.site-top .nav-menu a{padding:0 12px;border-radius:5px;min-height:40px}.site-top .nav-menu a:hover{background:#ffffff0d}
.language-switch{display:inline-flex;border:1px solid #494d40;border-radius:5px;overflow:hidden}.site-top .language-switch a{min-height:36px;padding:0 11px;font-size:12px}
.site-top .language-switch a[aria-current=true]{background:#e8c47c1f;color:var(--gold)}
.menu-check{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.menu-label{display:none;cursor:pointer;align-items:center;gap:12px;min-height:44px;padding:0 14px;border:1px solid #505447;border-radius:4px;font-size:13px;color:var(--text)}
.menu-check:focus-visible+.menu-label{outline:3px solid #9dc7f0;outline-offset:4px}
@media(max-width:860px){.site-top-inner{padding:12px 20px}.menu-label{display:inline-flex}.site-top nav{display:none;width:100%;flex-direction:column;align-items:stretch;gap:0;padding:6px 0 10px}
.menu-check:checked~nav{display:flex}.nav-menu{position:static;min-width:0;padding:0 0 6px 16px;background:none;border:0;box-shadow:none}.site-top nav a.nav-companion{align-self:flex-start;margin-top:6px}.language-switch{align-self:flex-start;margin-top:10px}}
.crumbs{font-size:13px;color:var(--muted);margin:14px 0 20px}.crumbs a{color:var(--muted)}.crumbs a:hover{color:var(--text)}`;

// The website's 1200 × 630 link-preview card (site/images/social/), for pages without their own.
export const SHARE_CARD = "https://guilded.kcaron.top/images/social/guilded-card.png";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The current menu entry for a path, so the page is marked in the menu. Guild pages belong to Guilds. */
export function currentSection(path: string): string | null {
  if (/^\/(?:recruitment\/guilds|g)\//.test(path)) return "guilds";
  return /^\/(leaderboards|recruitment|players)\//.exec(path)?.[1] ?? null;
}

/** The site header. `languages` gives this page's address in each language, for the EN/FR switch;
 * `edition` the page's WoW edition (the request's by default), shown in the version switcher. */
export function siteHeader(lang: Lang, path: string, languages?: Record<Lang, string>, edition: string = currentEdition()): string {
  const t = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const playing = editionSection(edition) ?? editionSection("forever")!;
  // "Playing: Retail ▾": the same page in another edition (a leaderboard stays a leaderboard).
  const versions = editionMenu({
    current: playing.id,
    title: `${t("Playing:", "Je joue à :")} <strong>${playing[lang]}</strong>`,
    label: (section) => section[lang],
    href: (section) => localizedHref(editionSwitchHref(path, section.id), lang)
  });
  const nav = versions + navLinks({
    current: currentSection(path),
    href: (item) => localizedHref(editionHref(item.href, playing.id), lang),
    label: (item) => (lang === "fr" ? item.fr : item.en),
    groupLabel: (key) => NAV_GROUPS[key]![lang]
  });
  const switcher = languages ? `<div class="language-switch" role="group" aria-label="Language / Langue">${(["en", "fr"] as const)
    .map((code) => `<a href="${escape(languages[code])}" hreflang="${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ""}>${code.toUpperCase()}</a>`).join("")}</div>` : "";
  return `<header class="site-top"><div class="site-top-inner"><a class="brand" href="/?lang=${lang}"><img src="${SITE_LOGO}" alt="" width="40" height="40"><span>GUILDED<span class="brand-caption">${t("YOUR GUILD, CONNECTED.", "VOTRE GUILDE, CONNECTÉE.")}</span></span></a>`
    + `<input type="checkbox" id="site-menu" class="menu-check"><label for="site-menu" class="menu-label">Menu <span aria-hidden="true">☰</span></label>`
    + `<nav aria-label="${t("Main navigation", "Navigation principale")}">${nav}${switcher}</nav></div></header>`;
}

/** "Leaderboards › Guilds › Quebec Gold": each item is [label, href] (the last one has no link). */
export function breadcrumbs(lang: Lang, items: [string, string | null][], escape: (text: string) => string): string {
  return `<nav class="crumbs" aria-label="${lang === "fr" ? "Fil d'Ariane" : "Breadcrumb"}">${items.map(([label, href]) => (href ? `<a href="${escape(href)}">${escape(label)}</a>` : `<span aria-current="page">${escape(label)}</span>`)).join(" › ")}</nav>`;
}
