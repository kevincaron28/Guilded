import { PAGE_STYLE } from "./guild-page.js";
import { currentEdition } from "./edition-context.js";
import { editionHref } from "../../site/nav.mjs";
import { SITE_HEADER_STYLE, siteHeader } from "./site-header.js";

// Shared HTML for the bot-served website pages (/recruitment/, /me/, /leaderboards/). Plain
// server-rendered forms, no scripts: the pages work under a strict Content-Security-Policy.

export type Lang = "en" | "fr";
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function langFrom(query: URLSearchParams, acceptLanguage: string | undefined): Lang {
  const chosen = query.get("lang");
  if (chosen === "fr" || chosen === "en") return chosen;
  return /^\s*fr\b/i.test(acceptLanguage ?? "") ? "fr" : "en";
}

export const tr = (lang: Lang) => (en: string, fr: string) => (lang === "fr" ? fr : en);

// An internal link that keeps the page language.
export function link(path: string, lang: Lang, params: Record<string, string | null | undefined> = {}): string {
  const [base, hash = ""] = editionHref(path, currentEdition()).split("#");
  const [pathname, search = ""] = base!.split("?");
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  query.set("lang", lang);
  return `${pathname}?${query.toString()}${hash ? `#${hash}` : ""}`;
}

// The Guilded logo the public site serves (scripts/build-site.mjs copies it to /logo.png).
const SHARE_IMAGE = "https://guilded.kcaron.top/logo.png";

export const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
.notice{background:var(--panel);border-left:3px solid var(--gold);padding:12px 16px;margin:16px 0}.error{border-left-color:#e07a6b}
.code{font:700 28px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:var(--gold)}`;

export interface LayoutInput {
  shareImage?: string;
  languageParams?: Record<string, string | null | undefined>;
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
    : input.signInOn ? [`<span>${t("Your player profile is public by default; you can hide it in My Guilded.", "Votre profil joueur est public par défaut; vous pouvez le masquer dans Ma page.")}</span><a href="${escapeHtml(link("/auth/login", input.lang, { return: link(input.path, input.lang, input.languageParams) }))}">${t("Sign in with Discord", "Connexion avec Discord")}</a>`] : [];
  const language = `<a href="${escapeHtml(link(input.path, other, input.languageParams))}" hreflang="${other}">${other === "fr" ? "Français" : "English"}</a>`;
  const description = escapeHtml((input.description ?? input.title).slice(0, 160));
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(input.title)} · Guilded</title><meta name="description" content="${description}">${input.noindex ? '<meta name="robots" content="noindex">' : ""}`
    // Link previews (Discord, social sites): a pasted page shows its title, summary and the logo.
    + `<meta property="og:site_name" content="Guilded"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(input.title)}">`
    + `<meta property="og:description" content="${description}"><meta property="og:image" content="${escapeHtml(input.shareImage ?? SHARE_IMAGE)}"><meta property="og:locale" content="${input.lang === "fr" ? "fr_CA" : "en_CA"}">`
    + (input.shareImage ? '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : "")
    + `<meta name="twitter:card" content="${input.shareImage ? "summary_large_image" : "summary"}"><meta name="theme-color" content="#d4af37">`
    + `<style>${PAGE_STYLE}\n${FORM_STYLE}</style></head><body><a class="skip" href="#content">${t("Skip to content", "Aller au contenu")}</a><main>${siteHeader(input.lang, input.path)}<div class="who">${[...who, language].join("")}</div><div id="content" tabindex="-1">${input.body}</div>`
    + `<footer>${t("Made with", "Créé avec")} <a href="https://guilded.kcaron.top/">Guilded</a>. ${t("Not affiliated with Blizzard Entertainment.", "Sans affiliation avec Blizzard Entertainment.")}</footer></main></body></html>`;
}

export const options = (values: readonly { value: string; label: string }[], selected: string | null | undefined) =>
  values.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === (selected ?? "") ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
