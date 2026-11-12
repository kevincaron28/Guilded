// Consent-gated Google AdSense (docs/plans/ADS_CONSENT.md). Everything here is OFF until the Worker variable
// GUILDED_ADS is "on" (Cloudflare → guilded-wow → Settings → Variables; keep_vars is true so deploys keep it). The Worker
// answers every public page, static or bot-rendered, so this one switch covers both. Only ads.txt is always live (inert).
import { splitEditionPath } from "../site/nav.mjs";
import { CONSENT_SCRIPT } from "./consent-script.mjs";

export const ADS_TXT = "google.com, pub-6948243189424271, DIRECT, f08c47fec0942fa0\n";
export const adsOn = (env) => String(env?.GUILDED_ADS ?? "").trim().toLowerCase() === "on";

const CREATOR_HOSTS = ["kcaron.top", "www.kcaron.top"];
// Public pages only. Never downloads, the companion, install, sign-in, accounts, officers, or anything a program fetches.
const GUIDES = /^\/guide\/(?:|dungeons\/?|epgp\/?|discord-bot\/?|link-character\/?)$/;
const DATA_PAGE = /^\/(?:leaderboards|players)(?:\/|$)/;
const GUILD_PAGE = /^\/g\/[a-z0-9-]{1,40}\/?$/;
const FILE = /\.[a-z0-9]{2,5}$/i;

export function adPage(url) {
  if (CREATOR_HOSTS.includes(url.hostname)) return url.pathname === "/" || url.pathname === "/creator" || url.pathname.startsWith("/creator/");
  let path = url.pathname;
  if (path === "/fr" || path.startsWith("/fr/")) path = path.slice(3) || "/";
  if (path === "/") return true;
  const section = splitEditionPath(path);
  const page = section?.rest ? section.rest : path;
  if (FILE.test(page)) return false;
  return GUIDES.test(page) || DATA_PAGE.test(page) || GUILD_PAGE.test(page);
}

// Google's ad hosts, added only to the pages above.
const AD_HOSTS = {
  "script-src": ["https://pagead2.googlesyndication.com", "https://*.googlesyndication.com", "https://*.adtrafficquality.google", "https://www.googletagservices.com", "https://*.google.com"],
  "frame-src": ["https://googleads.g.doubleclick.net", "https://*.googlesyndication.com", "https://*.doubleclick.net", "https://*.google.com", "https://*.adtrafficquality.google"],
  "connect-src": ["https://pagead2.googlesyndication.com", "https://*.googlesyndication.com", "https://*.google.com", "https://*.doubleclick.net", "https://*.adtrafficquality.google"],
  "img-src": ["https:"]
};
export function adsCsp(policy) {
  const directives = new Map();
  for (const part of String(policy ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  const fallback = (directives.get("default-src") ?? ["'self'"]).filter((value) => value !== "'none'");
  for (const [name, hosts] of Object.entries(AD_HOSTS)) {
    const base = directives.get(name) ?? (name === "frame-src" ? [] : fallback);
    const merged = [...base, ...hosts.filter((host) => !base.includes(host))];
    directives.set(name, name === "script-src" && !merged.includes("'self'") ? ["'self'", ...merged] : merged);
  }
  if (!directives.has("style-src")) directives.set("style-src", ["'unsafe-inline'"]);
  return [...directives].map(([name, values]) => [name, ...values].join(" ")).join("; ");
}

export const adsTxtResponse = (request) => new Response(request.method === "HEAD" ? null : ADS_TXT, {
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" }
});
export const consentScriptResponse = (request) => new Response(request.method === "HEAD" ? null : CONSENT_SCRIPT, {
  headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" }
});

// A page view on an ad page gets the banner script and the wider CSP; everything else passes untouched.
export async function withAds(request, env, response, url = new URL(request.url)) {
  if (!adsOn(env) || request.method !== "GET" || response.status !== 200) return response;
  if (!(response.headers.get("content-type") ?? "").includes("text/html") || !adPage(url)) return response;
  const html = await response.text();
  const tag = '<script src="/consent.js" defer></script>';
  const body = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${tag}</body>`) : html + tag;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  if (headers.has("content-security-policy")) headers.set("content-security-policy", adsCsp(headers.get("content-security-policy")));
  return new Response(body, { status: 200, headers });
}
