// One public address; personal pairing and guild authorization remain on the bot.
import { createOwnerResources } from "./private-resources.mjs";
import { localizedAsset } from "./localized-assets.mjs";
import { editionSection, splitEditionPath } from "../site/nav.mjs";
import { POE_ENABLED } from "../companion/active-games.mjs";

// WoW Forever's section (/forever/, /forever/leaderboards/...: site/nav.mjs). The cookie remembered a
// visitor's edition when there were several; only Forever is recognized now.
const EDITION_COOKIE = "guilded_edition";
function rememberedEdition(request) {
  const match = /(?:^|;\s*)guilded_edition=([a-z-]{1,20})(?:;|$)/.exec(request.headers.get("cookie") ?? "");
  return editionSection(match?.[1]);
}
const editionCookie = (slug) => `${EDITION_COOKIE}=${slug}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`;

const ownerResources = createOwnerResources({ resources: [
  { filename: "approved-brand-kit-v2.zip", key: "brand/approved-v2/kit.zip", type: "application/zip", title: "Approved brand kit v2", description: "Original ribbon logo, transparent emblem, brand styles and usage guide." },
  { filename: "discord-channel-copy.md", key: "discord/channel-copy.md", type: "text/markdown; charset=utf-8", title: "Discord channel copy — EN / FR", description: "Bilingual channel descriptions and reporting guidance." },
  { filename: "discord-topics-pins.json", key: "discord/topics-pins.json", type: "application/json", title: "Discord topics and pins", description: "Structured copy for the community channels." },
  { filename: "discord-research.md", key: "discord/research.md", type: "text/markdown; charset=utf-8", title: "Discord design research", description: "Public-source references behind the community structure." },
  { filename: "00-wow-forever-teaser_en_9x16.mp4", key: "clips/00-wow-forever-teaser_en_9x16.mp4", type: "video/mp4", title: "Promo clip: WoW Forever teaser (EN, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "00-wow-forever-teaser_fr_9x16.mp4", key: "clips/00-wow-forever-teaser_fr_9x16.mp4", type: "video/mp4", title: "Promo clip: Teaser WoW Forever (FR, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "01-epgp-loot_en_9x16.mp4", key: "clips/01-epgp-loot_en_9x16.mp4", type: "video/mp4", title: "Promo clip: EP/GP and loot (EN, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "01-epgp-loot_fr_9x16.mp4", key: "clips/01-epgp-loot_fr_9x16.mp4", type: "video/mp4", title: "Promo clip: EP/GP et butin (FR, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "02-crafters-readiness_en_9x16.mp4", key: "clips/02-crafters-readiness_en_9x16.mp4", type: "video/mp4", title: "Promo clip: Crafters and readiness (EN, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "02-crafters-readiness_fr_9x16.mp4", key: "clips/02-crafters-readiness_fr_9x16.mp4", type: "video/mp4", title: "Promo clip: Artisans et préparation (FR, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "03-dungeons_en_9x16.mp4", key: "clips/03-dungeons_en_9x16.mp4", type: "video/mp4", title: "Promo clip: Dungeons (EN, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "03-dungeons_fr_9x16.mp4", key: "clips/03-dungeons_fr_9x16.mp4", type: "video/mp4", title: "Promo clip: Donjons (FR, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "04-discord-signups_en_9x16.mp4", key: "clips/04-discord-signups_en_9x16.mp4", type: "video/mp4", title: "Promo clip: Discord and sign-ups (EN, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "04-discord-signups_fr_9x16.mp4", key: "clips/04-discord-signups_fr_9x16.mp4", type: "video/mp4", title: "Promo clip: Discord et inscriptions (FR, vertical)", description: "Vertical 1080x1920 clip for TikTok, Reels and Shorts. Addon screenshots, not gameplay footage." },
  { filename: "promo-captions.txt", key: "clips/captions.txt", type: "text/plain; charset=utf-8", title: "Promo clip captions", description: "Captions and hashtags in English and French for each clip." }
] });
// The bot's address. GUILDED_ORIGIN_URL (a Worker variable) can name a hostname in the site owner's
// own DNS zone; the free DuckDNS name stays as the fallback. Cloudflare sometimes fails to look up
// the DuckDNS name (error 1016, status 530): docs/SITE_RELIABILITY_2026-10-29.md.
const defaultOrigin = "https://guildedqc.duckdns.org";
function botOrigins(env) {
  const list = [];
  try {
    const configured = new URL(env.GUILDED_ORIGIN_URL ?? "");
    if (configured.protocol === "https:" && !configured.username && !configured.password && configured.pathname === "/" && !configured.search && !configured.hash) list.push(configured.origin);
  } catch { /* not configured */ }
  if (!list.includes(defaultOrigin)) list.push(defaultOrigin);
  return list;
}
const ATTEMPTS = 3;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const apiMethods = new Map([
  ["/api/v1/addon-imports", ["POST"]],
  ["/api/v1/addon-pairings", ["POST"]],
  ["/api/v1/public-runs", ["POST"]],
  ["/api/v1/standings", ["GET"]],
  // 8.5: the Google Sheets statistics feed (IMPORTDATA); the key travels in the query and is checked by the bot.
  ["/api/v1/stats-feed", ["GET"]],
  ["/api/v1/poe/visits", ["GET", "POST"]],
  ["/api/v1/poe/levels", ["POST"]],
  ["/api/v1/poe/status", ["GET"]],
  ["/api/v1/companion/logout", ["POST"]],
  ["/api/v1/companion/sign-in", ["POST"]],
  ["/api/v1/companion/sign-in/poll", ["POST"]],
  // 8.5 Track L: who is signed in and the join invite for the member's in-game guild.
  ["/api/v1/companion/me", ["GET"]],
  // Phone badge album: the signed-in member's own achievements (read-only).
  ["/api/v1/companion/achievements", ["GET"]],
  // Guilded Collection (phone card game): read, open the daily pack, craft.
  ["/api/v1/companion/cards", ["GET"]],
  ["/api/v1/companion/cards/open", ["POST"]],
  ["/api/v1/companion/cards/craft", ["POST"]],
  // Guilded Clash matches against the AI and the PvE gauntlet (ids travel in the query string or body).
  ["/api/v1/companion/clash/start", ["POST"]],
  ["/api/v1/companion/clash/match", ["GET"]],
  ["/api/v1/companion/clash/intent", ["POST"]],
  ["/api/v1/companion/clash/concede", ["POST"]],
  ["/api/v1/companion/clash/matches", ["GET"]],
  ["/api/v1/companion/clash/pve", ["GET"]],
  // Guild-only card trading (ids travel in the query string or body).
  ["/api/v1/companion/clash/trade/partners", ["GET"]],
  ["/api/v1/companion/clash/trade/cards", ["GET"]],
  ["/api/v1/companion/clash/trades", ["GET"]],
  ["/api/v1/companion/clash/trade", ["GET"]],
  ["/api/v1/companion/clash/trade/offer", ["POST"]],
  ["/api/v1/companion/clash/trade/edit", ["POST"]],
  ["/api/v1/companion/clash/trade/confirm", ["POST"]],
  ["/api/v1/companion/clash/trade/cancel", ["POST"]],
  ["/api/v1/companion/clash/trade/settings", ["POST"]],
  ["/api/v1/companion/clash/challenge", ["POST"]],
  ["/api/v1/companion/clash/accept", ["POST"]],
  ["/api/v1/companion/clash/decline", ["POST"]],
  ["/api/v1/companion/clash/challenge/partners", ["GET"]],
  ["/api/v1/companion/clash/duels", ["GET"]],
  ["/api/v1/companion/clash/duel", ["GET"]],
  ["/api/v1/companion/clash/duel/intent", ["POST"]],
  ["/api/v1/companion/clash/duel/concede", ["POST"]],
  ["/api/v1/companion/clash/ranked", ["GET"]],
  ["/api/v1/companion/clash/ranked/join", ["POST"]],
  ["/api/v1/companion/clash/ranked/leave", ["POST"]],
  ["/api/v1/companion/clash/leaderboard", ["GET"]],
  // Track M phone guildmate map (guild members only, never public) and the member's sharing switch.
  ["/api/v1/companion/guild-map", ["GET", "POST"]],
  ["/api/v1/manage", ["GET", "POST"]],
  // The Windows companion and the phone app both call this on the public site.
  // Characters, guild rank and reserves live here; the other companion routes were already forwarded.
  ["/api/v1/hub", ["GET", "POST"]]
]);
const failure = (status, error) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

// Expo web on a developer's computer calls the public site from localhost. Phone and
// desktop apps are not subject to browser CORS. Only these paths, and only a loopback
// page, receive the header. Website cookies are not included.
function mobileDevCors(request) {
  const origin = request.headers.get("origin") ?? "";
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/") && path !== "/leaderboards/summary.json") return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "accept, authorization, content-type, if-none-match, x-companion-credential",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin"
  };
}
function withMobileDevCors(request, response) {
  const cors = mobileDevCors(request);
  if (!cors) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new Error("body-limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

// Only the bot's own website cookies (__Host-guilded_*) reach the browser, never anything else.
function hostCookies(upstream) {
  const all = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  return all.filter((cookie) => /^__Host-guilded_[a-z]{1,20}=[^;]*; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(cookie));
}
function withCookies(headers, upstream) {
  const result = new Headers(headers);
  for (const cookie of hostCookies(upstream)) result.append("set-cookie", cookie);
  return result;
}

// A visitor's page view while the bot cannot be reached: a branded page that retries by itself,
// instead of Cloudflare's bare "error code" text. API callers keep a JSON error.
function unavailablePage(request, url) {
  const chosen = url.searchParams.get("lang");
  const fr = chosen === "fr" || (chosen !== "en" && /^\s*fr\b/i.test(request.headers.get("accept-language") ?? ""));
  const t = (en, frText) => (fr ? frText : en);
  const again = (url.pathname + url.search).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const home = fr ? "/?lang=fr" : "/";
  const html = `<!doctype html><html lang="${fr ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="20"><title>${t("Back in a moment", "De retour dans un instant")} · Guilded</title><link rel="icon" href="/favicon.png" type="image/png">`
    + `<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111312;color:#f4f1e8;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:560px;padding:40px 20px}.brand{display:inline-flex;align-items:center;gap:10px;color:#f4f1e8;font-weight:800;letter-spacing:.15em;text-decoration:none}h1{font-size:clamp(32px,6vw,48px);line-height:1.1;margin:28px 0 14px}p{color:#afb4ad}a{color:#e8c47c}.actions{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;margin:26px 0}.button{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:5px;background:#e8c47c;color:#1b2019;font-weight:650;text-decoration:none}.small{font-size:13px}:focus-visible{outline:3px solid #9dc7f0;outline-offset:4px}</style></head>`
    + `<body><main><a class="brand" href="${home}"><img src="/logo-88.webp" alt="" width="44" height="44">GUILDED</a><h1>${t("Back in a moment", "De retour dans un instant")}</h1>`
    + `<p>${t("Leaderboards, guild pages, player profiles and the companion are taking a short break. This page tries again by itself in 20 seconds.", "Les classements, les pages de guilde, les profils et le compagnon font une courte pause. Cette page réessaie toute seule dans 20 secondes.")}</p>`
    + `<div class="actions"><a class="button" href="${again}">${t("Try again now", "Réessayer maintenant")}</a><a href="${home}">${t("Home", "Accueil")}</a><a href="/editions/${fr ? "?lang=fr" : ""}">${t("Download the addon", "Télécharger l’addon")}</a></div>`
    + `<p class="small">${t("Downloads and guides still work. Still down after a few minutes?", "Les téléchargements et les guides fonctionnent toujours. Encore en panne dans quelques minutes ?")} <a href="https://discord.gg/YjzFwtP64V">${t("Tell us on Discord", "Dites-le-nous sur Discord")} ↗</a></p></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { status: 503, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "20",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin"
  } });
}

// The companion installer. GitHub release downloads returned 504 for hours on 8 November 2026, and streaming it from KV
// in pieces broke on the free plan (the Worker was cut off mid-download). The bot's server now keeps the installer
// (Caddy file_server at /downloads/, behind the origin gate) and the Worker hands its response body straight through:
// no JavaScript runs per chunk, so nothing cuts it off. Range requests pass through, so a browser can resume.
// If the server cannot be reached or does not have it, the visitor goes to the GitHub release instead.
const HOSTED_DOWNLOAD = /^\/downloads\/(Guilded\.Companion\.Setup(?:\.\d{1,3}\.\d{1,3}\.\d{1,4})?\.exe)$/;
const GITHUB_INSTALLER = "https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe";
const PASSED_HEADERS = ["content-length", "content-range", "accept-ranges", "last-modified", "etag"];
export async function hostedDownload(request, env, ctx, url = new URL(request.url)) {
  const match = HOSTED_DOWNLOAD.exec(url.pathname);
  if (!match) return null;
  if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
  const github = () => new Response(null, { status: 302, headers: { location: GITHUB_INSTALLER, "cache-control": "no-store" } });
  const latest = match[1] === "Guilded.Companion.Setup.exe";
  const headers = new Headers();
  if (env.GUILDED_ORIGIN_TOKEN) headers.set("x-guilded-origin", env.GUILDED_ORIGIN_TOKEN);
  for (const name of ["range", "if-none-match", "if-modified-since", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const origin of botOrigins(env)) {
    // Give up on an origin that has not started answering in 15 seconds; once it answers, the download runs as long as it needs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const upstream = await fetch(`${origin}/downloads/${match[1]}`, { method: request.method, headers, redirect: "manual", signal: controller.signal, cf: { cacheTtl: 0, cacheEverything: false } });
      clearTimeout(timer);
      if (![200, 206, 304, 416].includes(upstream.status)) { await upstream.body?.cancel(); continue; }
      const out = new Headers({
        "content-type": "application/vnd.microsoft.portable-executable",
        "content-disposition": `attachment; filename="${match[1]}"`,
        "cache-control": latest ? "no-cache" : "public, max-age=86400",
        "x-content-type-options": "nosniff"
      });
      for (const name of PASSED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) out.set(name, value);
      }
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
    } catch {
      clearTimeout(timer);
    }
  }
  return github();
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS" && mobileDevCors(request)) {
      return new Response(null, { status: 204, headers: { ...mobileDevCors(request), "cache-control": "no-store" } });
    }
    let response = await route(request, env, ctx);
    // A page inside an edition's section remembers that edition for the next visit.
    const url = new URL(request.url);
    const section = ["kcaron.top", "www.kcaron.top"].includes(url.hostname) ? null : splitEditionPath(url.pathname);
    if (section && response.status < 400) {
      const remembered = new Response(response.body, response);
      remembered.headers.append("set-cookie", editionCookie(section.slug));
      response = remembered;
    }
    return withMobileDevCors(request, response);
  }
};

async function route(request, env, ctx) {
    // Guard every hostname, including workers.dev, before any static fallback.
    const privateResponse = await ownerResources(request, env);
    if (privateResponse) return privateResponse;
    const url = new URL(request.url);
    const download = await hostedDownload(request, env, ctx, url);
    if (download) return download;
    // Keep Google's exact verification filename at HTTP 200 despite clean HTML URLs.
    if (/^\/google[a-f0-9]{8,64}\.html$/.test(url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      const asset = new URL(url);
      asset.pathname = asset.pathname.slice(0, -5);
      return env.ASSETS.fetch(new Request(asset, { method: request.method }));
    }
    // The selected creator domain shares this Worker with the existing Guilded
    // website. DNS/custom-domain activation is a separate owner setup step.
    const creator = ["kcaron.top", "www.kcaron.top"].includes(url.hostname);
    if (creator && ["/support", "/support/"].includes(url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      return Response.redirect("https://ko-fi.com/wowguilded", 302);
    }
    const creatorAssets = { "/": "/creator/", "/robots.txt": "/creator/robots.txt", "/sitemap.xml": "/creator/sitemap.xml" };
    if (creator && Object.hasOwn(creatorAssets, url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      const asset = new URL(creatorAssets[url.pathname], url);
      asset.search = url.search;
      return localizedAsset(new Request(asset, { method: request.method }), env);
    }
    // Quebec Gold's hand-written WoW pages were replaced by its live guild page on 16 October 2026.
    if (!creator && /^\/quebec-gold\/(cores|wow)\/?$/.test(url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      return new Response(null, { status: 301, headers: { location: "/g/quebec-gold/", "cache-control": "public, max-age=86400" } });
    }
    // The edition section: /forever → /forever/ (the hub page); /forever/leaderboards/... is the bot's
    // /leaderboards/... page with ?edition=forever.
    const section = creator ? null : splitEditionPath(url.pathname);
    // Guilded supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md): the removed editions' old addresses
    // lead permanently to the Forever equivalent. PoE2 pages are held (companion/active-games.mjs): temporary redirect.
    if (!creator && ["GET", "HEAD"].includes(request.method)) {
      const held = (target) => new Response(null, { status: 302, headers: { location: target + url.search, "cache-control": "no-store" } });
      const moved = (target) => new Response(null, { status: 301, headers: { location: target + url.search, "cache-control": "public, max-age=86400" } });
      if (section?.retired) return moved(`/forever${section.rest || "/"}`);
      if (/^\/editions\/(classic-era|classic-tbc|classic-mists|retail)\/?$/.test(url.pathname)) return moved("/editions/forever/");
      if (!POE_ENABLED && /^\/quebec-gold\/poe2\/?$/.test(url.pathname)) return held("/quebec-gold/");
    }
    if (section && !section.rest) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      return new Response(null, { status: 301, headers: { location: `/${section.slug}/${url.search}`, "cache-control": "public, max-age=86400" } });
    }
    const pagePath = section ? section.rest : url.pathname;
    const dataPage = /^\/(?:leaderboards|recruitment|players)(?:\/|$)/.test(pagePath);
    // A page view that still names its edition in the address (?edition=retail: older links and
    // the filter forms) moves into that edition's section; one without a section goes to the
    // visitor's remembered edition, Forever by default. Files (.json, .xml, .png) are never moved.
    if (!creator && dataPage && ["GET", "HEAD"].includes(request.method) && !/\.[a-z]{2,4}$/.test(pagePath)) {
      // Any ?edition= (older links named other editions) means the WoW Forever section.
      const asked = url.searchParams.has("edition") ? editionSection("forever") : null;
      const destination = asked ?? (section ? null : rememberedEdition(request) ?? editionSection("forever"));
      if (destination && (!section || url.searchParams.has("edition"))) {
        const query = new URLSearchParams(url.search);
        query.delete("edition");
        const rest = query.toString();
        return new Response(null, { status: 302, headers: { location: `/${destination.slug}${pagePath}${rest ? `?${rest}` : ""}`, "cache-control": "no-store" } });
      }
    }
    if (section && !dataPage) {
      // The hub page (/retail/) is a static page; anything else in a section does not exist.
      if (url.pathname.startsWith("/api/")) return failure(404, "Not found");
      return localizedAsset(request, env);
    }
    // The browser companion was removed: its old addresses lead to the static download page at
    // /companion/ (EN/FR), which is served from the site's own assets like any other page.
    if (!creator && (url.pathname === "/companion" || url.pathname.startsWith("/companion/") && url.pathname.length > 11)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      const lang = url.searchParams.get("lang");
      return new Response(null, { status: 301, headers: { location: `/companion/${lang === "fr" || lang === "en" ? `?lang=${lang}` : ""}`, "cache-control": "public, max-age=3600" } });
    }
    const api = apiMethods.has(url.pathname);
    const health = url.pathname === "/health";
    // Public guild pages, served by the bot (docs/GUILD_PAGES_DESIGN.md). Guilded host only.
    const guildPage = !creator && /^\/g\/[a-z0-9-]{1,40}\/?$/.test(url.pathname);
    // Signed-in website pages (7.0): Discord sign-in, recruitment, the player's page and the public
    // dungeon leaderboards. Rendered by the bot; the session cookie is for this host only.
    // Inside an edition's section only the public data pages exist (checked above).
    const web = !creator && url.pathname.length <= 200
      && /^\/(?:auth\/(?:login|callback|logout)|recruitment(?:\/[A-Za-z0-9._~/-]*)?|me(?:\/[A-Za-z0-9._~/-]*)?|players(?:\/[A-Za-z0-9._~/-]*)?|leaderboards(?:\/[A-Za-z0-9._~%/-]*)?)$/.test(pagePath);
    if (!api && !health && !guildPage && !web) {
      if (url.pathname.startsWith("/api/")) return failure(404, "Not found");
      return localizedAsset(request, env);
    }
    const methods = api ? apiMethods.get(url.pathname) : web ? ["GET", "HEAD", "POST"] : ["GET", "HEAD"];
    if (!methods.includes(request.method)) return failure(405, "Method not allowed");
    if (api && request.method === "POST") {
      const pairing = /\/(?:addon-pairings|companion\/sign-in)$/.test(url.pathname);
      const limiter = pairing ? env.PAIRING_ATTEMPTS : env.API_WRITES;
      if (limiter) {
        // Cloudflare supplies this header; caller-controlled forwarding headers
        // and credentials must not let an attacker choose a fresh throttle key.
        const key = request.headers.get("cf-connecting-ip") || "unknown";
        try {
          if (!(await limiter.limit({ key })).success) return new Response(JSON.stringify({ error: "Too many requests. Try again shortly." }), {
            status: 429, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "60" }
          });
        } catch { return failure(503, "Request protection is temporarily unavailable. Try again shortly."); }
      }
    }
    const headers = new Headers();
    // content-encoding: compressed uploads; if-none-match: "nothing changed" standings answers.
    // Web pages: the session cookie, Origin/Referer for the bot's CSRF check on form posts, and
    // User-Agent so a companion sign-in can name the device ("Windows PC (Chrome)") by itself.
    const forwarded = api ? ["content-type", "content-encoding", "x-companion-credential", "authorization", "accept", "if-none-match"]
      : web ? ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "user-agent"] : ["accept"];
    for (const name of forwarded) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Guilded's own headers (x-guilded-*, x-companion-*) pass through, so a new bot feature does
    // not wait for a Worker redeploy. Proxy/address headers (x-forwarded-for...) never do: the
    // bot trusts those only from its own reverse proxy.
    if (api) {
      for (const [name, value] of request.headers) {
        if (name !== 'x-guilded-origin' && /^x-(guilded|companion)-[a-z0-9-]{1,40}$/.test(name) && value.length <= 512) headers.set(name, value);
      }
    }
    // This credential belongs to the proxy, never the caller.
    if (env.GUILDED_ORIGIN_TOKEN) headers.set('x-guilded-origin', env.GUILDED_ORIGIN_TOKEN);
    if (web && url.search.length > 2_000) return failure(414, "Address is too long");
    const origins = botOrigins(env);
    // A visitor's page view (not an API call or an image) gets the branded page when the bot is unreachable.
    const pageView = (web || guildPage) && ["GET", "HEAD"].includes(request.method) && (request.headers.get("accept") ?? "").includes("text/html");
    try {
      const body = request.method === "POST" ? await limitedBody(request) : undefined;
      let upstream, target;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt) await pause(200 * attempt);
        // Build from a fixed origin and the path, never a user-supplied destination.
        target = new URL(origins[attempt % origins.length]);
        target.pathname = pagePath;
        target.search = health || guildPage ? "" : url.search;
        // A removed edition's old section (a form post; page views were redirected above) is served as WoW Forever.
        if (section) target.searchParams.set("edition", section.retired ? "forever" : section.edition);
        try {
          upstream = await fetch(target.href, {
            method: request.method, headers, ...(body ? { body } : {}),
            redirect: "manual", signal: AbortSignal.timeout(20_000),
            // A guild page is the same for every visitor: Cloudflare keeps it briefly so visits rarely reach the bot.
            cf: guildPage ? { cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "301": 3600, "404": 60, "500-599": 0 } } : { cacheTtl: 0, cacheEverything: false }
          });
        } catch (error) {
          // A timeout is not retried (the visitor already waited); other network failures are, for reads only.
          if (error?.name === "TimeoutError" || !["GET", "HEAD"].includes(request.method) || attempt === ATTEMPTS - 1) throw error;
          continue;
        }
        // 530 means Cloudflare never reached the bot (error 1016 is a failed address lookup), so even
        // a POST did not arrive and is safe to send again.
        if (upstream.status !== 530) break;
        await upstream.body?.cancel();
      }
      if (upstream.status === 530) return pageView ? unavailablePage(request, url) : failure(503, "The guild bot is temporarily unavailable. Try again shortly.");
      // 304 Not Modified is a conditional answer, not a redirect: the standings long poll gets it
      // whenever nothing changed, and must reach the companion as 304 (not "Unexpected server redirect").
      if (api && upstream.status === 304) {
        const etag = upstream.headers.get("etag");
        return new Response(null, { status: 304, headers: { "cache-control": "no-store", ...(etag ? { etag } : {}) } });
      }
      if (upstream.status >= 300 && upstream.status < 400) {
        // Never follow a redirect with credentials. Only the guild pages' local
        // canonical redirects may be returned to the browser.
        const location = upstream.headers.get("location");
        const redirect = location ? new URL(location, target) : null;
        // Only the initiating auth route may redirect the browser to its provider.
        if (web && redirect && redirect.origin === "https://discord.com" && redirect.pathname === "/oauth2/authorize" && url.pathname === "/auth/login") {
          return new Response(null, { status: upstream.status, headers: withCookies({ location: redirect.href, "cache-control": "no-store" }, upstream) });
        }
        if (web && request.method === "POST" && url.pathname === "/me/battlenet/start"
          && redirect?.origin === "https://oauth.battle.net" && redirect.pathname === "/authorize") {
          return new Response(null, { status: 303, headers: withCookies({ location: redirect.href, "cache-control": "no-store" }, upstream) });
        }
        const allowed = guildPage ? ["/g/"] : web ? ["/recruitment", "/me/", "/players", "/leaderboards", "/auth/"] : null;
        // The bot's own links include the edition's section (/retail/leaderboards/...).
        const redirectPage = splitEditionPath(redirect?.pathname ?? "")?.rest ?? redirect?.pathname;
        if (!allowed || !redirect || !origins.includes(redirect.origin) || !allowed.some((prefix) => redirectPage.startsWith(prefix))) {
          return failure(502, "Unexpected server redirect");
        }
        return new Response(null, { status: upstream.status, headers: web
          ? withCookies({ location: redirect.pathname + redirect.search, "cache-control": "no-store" }, upstream)
          : { location: redirect.pathname + redirect.search, "cache-control": "no-store" } });
      }
      const responseHeaders = new Headers(upstream.headers);
      if (!guildPage) responseHeaders.set("cache-control", "no-store");
      responseHeaders.delete("set-cookie");
      if (web) for (const cookie of hostCookies(upstream)) responseHeaders.append("set-cookie", cookie);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return error.message === "body-limit" ? failure(413, "Request body is too large")
        : pageView ? unavailablePage(request, url) : failure(502, "The guild bot is temporarily unavailable. Try again shortly.");
    }
}
