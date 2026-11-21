import { siteUrl } from "../site-url.js";
import { PAGE_STYLE } from "./guild-page.js";
import { currentEdition } from "./edition-context.js";
import { editionHref } from "../../site/nav.mjs";
import { shareCard, SITE_HEADER_STYLE, siteFooterNav, siteHeader } from "./site-header.js";

// Shared HTML for the bot-served website pages (/recruitment/, /me/, /leaderboards/). Plain
// server-rendered forms, no scripts: the pages work under a strict Content-Security-Policy.

export type Lang = "en" | "fr";
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** MIME type of a share image from its extension: the website cards are JPEG, score cards and the default card are PNG. */
export const shareImageType = (path?: string): string => /\.jpe?g(?:\?|$)/i.test(path ?? "") ? "image/jpeg" : "image/png";

// The public, indexable website pages (an edition section prefix is allowed). Their HTML depends only on
// the address (?lang=fr), never on the visitor's Accept-Language, so a crawler and a browser see one page.
const PUBLIC_PAGE = /^(?:\/forever)?\/(?:leaderboards|recruitment|players)(?:\/|$)/;
export const isPublicPage = (path: string | undefined): boolean => PUBLIC_PAGE.test(path ?? "");

export function langFrom(query: URLSearchParams, acceptLanguage: string | undefined, path?: string): Lang {
  const chosen = query.get("lang");
  if (chosen === "fr" || chosen === "en") return chosen;
  if (isPublicPage(path)) return "en";
  return /^\s*fr\b/i.test(acceptLanguage ?? "") ? "fr" : "en";
}

export const tr = (lang: Lang) => (en: string, fr: string) => (lang === "fr" ? fr : en);

// An internal link that keeps the page language.
export function link(path: string, lang: Lang, params: Record<string, string | null | undefined> = {}): string {
  const [base, hash = ""] = editionHref(path, currentEdition()).split("#");
  const [pathname, search = ""] = base!.split("?");
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  // English is the default of the public pages: no ?lang=en there (one clean address per page). Other pages
  // (/me/, which follows Accept-Language) keep it so choosing English still sticks.
  if (lang !== "en" || !isPublicPage(pathname)) query.set("lang", lang);
  const search2 = query.toString();
  return `${pathname}${search2 ? `?${search2}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The French address of a public page, like the static site's: `/fr` + the English path (`https://host/fr/forever/leaderboards/`). The Worker serves it as the page with ?lang=fr. */
export function frenchUrl(englishUrl: string): string {
  const url = new URL(englishUrl);
  url.pathname = `/fr${url.pathname}`;
  return url.href;
}

export const SECURITY_HEADERS = {
  // data: is the inline header logo (site-logo.ts); font-src is the website's own Inter font.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store"
};

const FORM_STYLE = `${SITE_HEADER_STYLE}
form.inline{display:inline}label{display:block;margin:10px 0 4px;color:var(--muted);font-size:14px}
input,select,textarea{width:100%;background:#0c0e0d;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:9px 10px;font:inherit}
input[type=checkbox],input[type=radio]{width:1.125rem;height:1.125rem;padding:0;margin:3px 0;flex-shrink:0;accent-color:var(--gold)}
label.check-label{display:flex;align-items:flex-start;gap:10px;margin:16px 0}label.check-label span{min-width:0}
.availability-revoke{margin-top:16px}
textarea{min-height:120px}button,.button{cursor:pointer;border:0;font:inherit}button.link{background:none;color:var(--gold);padding:0;text-decoration:underline}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}.filters button{padding:10px}
.who{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;justify-content:flex-end;font-size:13px;color:var(--muted);margin:8px 0 0}.who button.link{font-size:13px}
.notice{background:var(--panel);border-left:3px solid var(--gold);padding:12px 16px;margin:16px 0}.trust-confirmed{color:#7bc47f}.trust-reported{color:var(--gold)}.error{border-left-color:#e07a6b}
.code{font:700 28px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:var(--gold)}
@media(max-width:480px){main{padding-top:16px}h1{font-size:32px;margin:0 0 8px}h2{margin:24px 0 10px}.table-wrap{overflow-x:visible}}`;

export interface LayoutInput {
  shareImage?: string;
  languageParams?: Record<string, string | null | undefined>;
  /** Full <title> text when the page needs its own search-result title (replaces "title · Guilded"). */
  documentTitle?: string;
  /** Structured data (schema.org) written as one JSON-LD block. */
  jsonLd?: unknown;
  lang: Lang; title: string; description?: string; path: string; body: string; noindex?: boolean;
  account: { username: string; displayName: string | null } | null; csrf: string | null; signInOn: boolean;
}

export function layout(input: LayoutInput): string {
  const t = tr(input.lang);
  const other: Lang = input.lang === "fr" ? "en" : "fr";
  // One item per link: a <form> cannot sit inside a <p> (the browser closes the <p> early).
  const who = input.account
    ? [`<span>${t("Signed in as", "Connecté :")} <strong>${escapeHtml(input.account.displayName ?? input.account.username)}</strong></span>`,
      `<a href="${link("/me/", input.lang)}">${t("My page", "Ma page")}</a>`,
      `<form class="inline" method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${escapeHtml(input.csrf ?? "")}"><button class="link" type="submit">${t("Sign out", "Déconnexion")}</button></form>`]
    : input.signInOn ? [`<a href="${escapeHtml(link("/auth/login", input.lang, { return: link(input.path, input.lang, input.languageParams) }))}">${t("Sign in with Discord", "Connexion avec Discord")}</a>`] : [];
  const here = link(input.path, input.lang, input.languageParams);
  const languages = input.lang === "fr" ? { en: link(input.path, other, input.languageParams), fr: here } : { en: here, fr: link(input.path, other, input.languageParams) };
  const description = escapeHtml((input.description ?? input.title).slice(0, 160));
  // The canonical address is the clean, English, unfiltered page as the website serves it (inside the edition's section).
  // Every filter and page number points back at it; /fr/ + the path is the French alternate of the same page.
  const bare = (input.path.split("?")[0] || "/");
  const bareNoSlash = bare.replace(/\/+$/, "");
  const leaf = /^\/(?:leaderboards\/(?:character|run|guild)\/[^/]+|g\/[^/]+)$/.test(bareNoSlash);
  const canonicalPath = editionHref(leaf ? bareNoSlash : `${bareNoSlash}/`, currentEdition()).split("?")[0]!;
  const canonical = siteUrl(canonicalPath);
  const frenchCanonical = frenchUrl(canonical);
  const here2 = input.lang === "fr" ? frenchCanonical : canonical;
  const alternates = input.noindex ? "" : `<link rel="canonical" href="${here2}"><link rel="alternate" hreflang="en" href="${canonical}"><link rel="alternate" hreflang="fr" href="${frenchCanonical}"><link rel="alternate" hreflang="x-default" href="${canonical}"><meta property="og:url" content="${here2}">`;
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="google-adsense-account" content="ca-pub-6948243189424271">`
    + `<title>${escapeHtml(input.documentTitle ?? `${input.title} · Guilded`)}</title><meta name="description" content="${description}">${input.noindex ? '<meta name="robots" content="noindex">' : alternates}`
    // Link previews (Discord, social sites): a pasted page shows its title, summary and the logo.
    + `<meta property="og:site_name" content="Guilded"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(input.documentTitle ?? input.title)}">`
    // Score cards and the website's own card (the default) are both 1200 × 630 PNGs.
    + `<meta property="og:description" content="${description}"><meta property="og:image" content="${escapeHtml(input.shareImage ?? shareCard())}"><meta property="og:locale" content="${input.lang === "fr" ? "fr_CA" : "en_CA"}">`
    + `<meta property="og:image:type" content="${shareImageType(input.shareImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#d4af37">`
    + `<link rel="icon" href="/favicon.png" type="image/png"><style>${PAGE_STYLE}\n${FORM_STYLE}</style>${input.jsonLd && !input.noindex ? `<script type="application/ld+json">${JSON.stringify(input.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}</head><body><a class="skip" href="#content">${t("Skip to content", "Aller au contenu")}</a>${siteHeader(input.lang, input.path, languages)}<main><div id="content" tabindex="-1">${input.body}</div>${who.length ? `<div class="who">${who.join("")}</div>` : ""}`
    + `<footer class="site-foot">${siteFooterNav(input.lang)}<p class="foot-note">${t("Made with", "Créé avec")} <a href="${siteUrl("/")}">Guilded</a>. ${t("Not affiliated with Blizzard Entertainment.", "Sans affiliation avec Blizzard Entertainment.")}</p></footer></main></body></html>`;
}

export const options = (values: readonly { value: string; label: string }[], selected: string | null | undefined) =>
  values.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === (selected ?? "") ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");

