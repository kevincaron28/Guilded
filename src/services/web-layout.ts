import { PAGE_STYLE } from "./guild-page.js";
import { navLinks } from "../../site/nav.mjs";

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
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  query.set("lang", lang);
  return `${path}?${query.toString()}`;
}

export const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store"
};

const FORM_STYLE = `form.inline{display:inline}label{display:block;margin:10px 0 4px;color:var(--muted);font-size:14px}
input,select,textarea{width:100%;background:#0c0e0d;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:9px 10px;font:inherit}
textarea{min-height:120px}button,.button{cursor:pointer;border:0;font:inherit}button.link{background:none;color:var(--gold);padding:0;text-decoration:underline}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}.filters button{padding:10px}
.site-top{display:flex;flex-wrap:wrap;gap:10px 28px;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px}
.site-top .brand{color:var(--text);font-weight:800;letter-spacing:.15em;text-decoration:none}.site-top nav{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px}
.site-top nav a{color:var(--muted);text-decoration:none}.site-top nav a:hover,.site-top nav a[aria-current=page]{color:var(--text)}.site-top nav a.nav-companion{color:var(--gold)}
.who{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:flex-end;font-size:13px;color:var(--muted);margin:8px 0 0}
.notice{background:var(--panel);border-left:3px solid var(--gold);padding:12px 16px;margin:16px 0}.error{border-left-color:#e07a6b}
.code{font:700 28px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:var(--gold)}`;

export interface LayoutInput {
  lang: Lang; title: string; description?: string; path: string; body: string; noindex?: boolean;
  account: { username: string; displayName: string | null } | null; csrf: string | null; signInOn: boolean;
}

export function layout(input: LayoutInput): string {
  const t = tr(input.lang);
  const other: Lang = input.lang === "fr" ? "en" : "fr";
  const who = input.account
    ? `${t("Signed in as", "Connecté :")} <strong>${escapeHtml(input.account.displayName ?? input.account.username)}</strong> · <a href="${link("/me/", input.lang)}">${t("My page", "Ma page")}</a> · <form class="inline" method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${escapeHtml(input.csrf ?? "")}"><button class="link" type="submit">${t("Sign out", "Déconnexion")}</button></form>`
    : input.signInOn ? `<a href="${link("/auth/login", input.lang, { return: input.path })}">${t("Sign in with Discord", "Connexion avec Discord")}</a>` : "";
  // The same menu as the static site (site/nav.mjs); bot pages keep the language.
  const current = /^\/(leaderboards|recruitment)\//.exec(input.path)?.[1] ?? null;
  const nav = navLinks({ current, href: (item) => (item.bot ? link(item.href, input.lang) : item.href), label: (item) => (input.lang === "fr" ? item.fr : item.en) });
  const language = `<a href="${link(input.path, other)}" hreflang="${other}">${other === "fr" ? "Français" : "English"}</a>`;
  const description = escapeHtml((input.description ?? input.title).slice(0, 160));
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(input.title)} · Guilded</title><meta name="description" content="${description}">${input.noindex ? '<meta name="robots" content="noindex">' : ""}`
    + `<style>${PAGE_STYLE}\n${FORM_STYLE}</style></head><body><main><header class="site-top"><a class="brand" href="/">GUILDED</a><nav aria-label="${t("Main navigation", "Navigation principale")}">${nav}</nav></header><p class="who">${who ? `<span>${who}</span>` : ""}<span>${language}</span></p>${input.body}`
    + `<footer>${t("Made with", "Créé avec")} <a href="https://guilded.kcaron.top/">Guilded</a>. ${t("Not affiliated with Blizzard Entertainment.", "Sans affiliation avec Blizzard Entertainment.")}</footer></main></body></html>`;
}

export const options = (values: readonly { value: string; label: string }[], selected: string | null | undefined) =>
  values.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === (selected ?? "") ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
