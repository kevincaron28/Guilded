import { editionHref, editionMenu, editionSection, editionSwitchHref, FOOTER_COLUMNS, footerLinks, localizedHref, navLinks } from "../../site/nav.mjs";
import { currentEdition } from "./edition-context.js";
import { SITE_LOGO } from "./site-logo.js";

// The site menu (site/nav.mjs) for every bot-served page: /leaderboards/, /recruitment/, /me/ and
// the public guild pages under /g/. Plain HTML and inline CSS, no scripts: the drop-downs are
// <details> element and the phone menu is a checkbox, so they work under a script-free policy.
// It matches the static site's header (logo, six links, "Get the addon" button, EN/FR) and footer.

type Lang = "en" | "fr";

export const SITE_HEADER_STYLE = `@font-face{font-family:Inter;font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/inter-latin.woff2") format("woff2")}
body{font-family:Inter,"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
.site-top{position:sticky;top:0;z-index:20;background:#111312ed;border-bottom:1px solid var(--line)}
.site-top-inner{max-width:1280px;margin:auto;padding:14px 32px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px}
.site-top .brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);font-size:19px;font-weight:800;letter-spacing:.15em;line-height:1.2;text-decoration:none}
.site-top .brand img{flex-shrink:0;border-radius:6px}.site-top .brand-caption{display:block;font-size:8px;font-weight:500;letter-spacing:.17em;color:var(--muted);margin-top:6px}
.site-top nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 4px;font-size:13px}
.site-top nav a,.nav-group>summary{display:inline-flex;align-items:center;min-height:44px;color:var(--muted);text-decoration:none}
.site-top nav>a{padding:0 10px;border-radius:5px;white-space:nowrap}
.site-top nav a:hover,.site-top nav a[aria-current=page],.nav-group>summary:hover,.nav-group[open]>summary{color:var(--text)}
.site-top nav>a[aria-current=page]{box-shadow:inset 0 -2px var(--gold);border-radius:0}
.site-top nav a.nav-cta{margin-left:8px;padding:0 18px;border-radius:5px;background:var(--gold);color:#1b2019;font-weight:650}.site-top nav a.nav-cta:hover{background:#f4d89e;color:#1b2019}.site-top nav a.nav-cta[aria-current=page]{box-shadow:none;color:#1b2019}
.nav-group{position:relative}.nav-group>summary{list-style:none;cursor:pointer;gap:8px}.nav-group>summary::-webkit-details-marker{display:none}
.nav-group>summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.nav-group[open]>summary::after{transform:translateY(1px) rotate(225deg)}
.edition-menu{margin-right:8px}.edition-menu>summary{border:1px solid #494d40;border-radius:5px;padding:0 12px;color:var(--text)}.edition-menu>summary strong{color:var(--gold);font-weight:650}
.site-top .edition-menu a[aria-current=true]{color:var(--gold)}
.nav-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:30;width:260px;max-width:calc(100vw - 40px);box-sizing:border-box;display:grid;padding:8px;background:#181c1a;border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 40px #0009}.edition-menu .nav-menu{left:0;right:auto}
.site-top .nav-menu a{padding:0 12px;border-radius:5px;min-height:44px}.site-top .nav-menu a:hover{background:#ffffff0d}
.language-switch{display:inline-flex;margin-left:8px;border:1px solid #494d40;border-radius:5px;overflow:hidden}.site-top .language-switch a{min-height:36px;padding:0 11px;font-size:12px}
.site-top .language-switch a[aria-current=true]{background:#e8c47c1f;color:var(--gold)}
.menu-check{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.menu-label{display:none;cursor:pointer;align-items:center;gap:12px;min-height:44px;padding:0 14px;border:1px solid #505447;border-radius:4px;font-size:13px;color:var(--text)}
.menu-check:focus-visible+.menu-label{outline:3px solid #9dc7f0;outline-offset:4px}
@media(max-width:1260px){.site-top-inner{padding-left:20px;padding-right:20px}.site-top nav{font-size:12px}.site-top nav>a{padding:0 7px}.site-top nav a.nav-cta{padding:0 13px;margin-left:4px}.edition-menu{margin-right:4px}.edition-menu>summary{padding:0 9px}}
@media(max-width:940px){.site-top-inner{padding:12px 20px}.menu-label{display:inline-flex}.site-top nav{display:none;width:100%;flex-direction:column;align-items:stretch;gap:0;padding:4px 0 14px;font-size:16px}
.menu-check:checked~nav{display:flex}.site-top nav>a,.nav-group>summary{min-height:48px;padding:0 4px;border-bottom:1px solid var(--line);border-radius:0}.site-top nav>a[aria-current=page]{box-shadow:none;color:var(--gold)}
.edition-menu{display:block;margin:0 0 4px}.edition-menu>summary{display:flex;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:0 4px;justify-content:space-between}.nav-menu{position:static;width:auto;max-width:none;padding:0 0 6px 12px;background:none;border:0;box-shadow:none}.site-top .nav-menu a{min-height:48px}
.site-top nav a.nav-cta{justify-content:center;margin:14px 0 0;min-height:52px;border-bottom:0;border-radius:5px;font-size:16px}.language-switch{align-self:flex-start;margin:14px 0 0}.site-top .language-switch a{min-height:44px;padding:0 16px}}
.site-foot{margin-top:56px;padding-top:28px;border-top:1px solid var(--line)}
.footer-cols{display:grid;align-items:start;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px 32px;text-align:left}
.footer-title{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text)}
.footer-cols ul{list-style:none;margin:0;padding:0}.footer-cols a{display:inline-flex;align-items:center;min-height:34px;font-size:13px;color:var(--muted);text-decoration:none}.footer-cols a:hover{color:var(--text);text-decoration:underline}
.foot-note{margin-top:24px}
@media(max-width:700px){.footer-cols{grid-template-columns:repeat(2,minmax(0,1fr))}.footer-cols a{min-height:44px}}
.crumbs{font-size:13px;color:var(--muted);margin:14px 0 20px}.crumbs a{color:var(--muted)}.crumbs a:hover{color:var(--text)}`;

// The website's 1200 × 630 link-preview card (site/images/social/), for pages without their own.
export const SHARE_CARD = "https://guilded.kcaron.top/images/social/guilded-card.png";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The current menu entry for a path, so the page is marked in the menu. Guild pages and recruitment belong to Find a guild. */
export function currentSection(path: string): string | null {
  if (/^\/(?:recruitment|g)\//.test(path)) return "guilds";
  if (/^\/me\//.test(path)) return "my-guilded";
  return /^\/leaderboards\//.test(path) ? "leaderboards" : null;
}

/** The site header. `languages` gives this page's address in each language, for the EN/FR switch;
 * `edition` the page's WoW edition (the request's by default), shown in the version switcher. */
export function siteHeader(lang: Lang, path: string, languages?: Record<Lang, string>, edition: string = currentEdition()): string {
  const t = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const playing = editionSection(edition) ?? editionSection("forever")!;
  // "Playing: WoW Forever ▾": a link to the WoW Forever section (Guilded supports WoW Forever only).
  const versions = editionMenu({
    current: playing.id,
    title: `${t("Playing:", "Je joue à :")} <strong>${playing[lang]}</strong>`,
    label: (section) => section[lang],
    href: (section) => localizedHref(editionSwitchHref(path, section.id), lang)
  });
  const nav = versions + navLinks({
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
