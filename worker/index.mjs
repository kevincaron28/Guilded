// One public address; personal pairing and guild authorization remain on the bot.
import { createOwnerResources } from "./private-resources.mjs";
import { localizedAsset } from "./localized-assets.mjs";
import { editionSection, splitEditionPath } from "../site/nav.mjs";

// Each WoW edition has its own section (/retail/, /retail/leaderboards/...: site/nav.mjs). The
// visitor's last edition is remembered in this cookie, so /leaderboards/ opens that edition.
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
  { filename: "discord-research.md", key: "discord/research.md", type: "text/markdown; charset=utf-8", title: "Discord design research", description: "Public-source references behind the community structure." }
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
  ["/api/v1/poe/visits", ["GET", "POST"]],
  ["/api/v1/poe/status", ["GET"]],
  ["/api/v1/companion/logout", ["POST"]],
  ["/api/v1/companion/sign-in", ["POST"]],
  ["/api/v1/companion/sign-in/poll", ["POST"]],
  ["/api/v1/manage", ["GET", "POST"]]
]);
const failure = (status, error) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

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

export default {
  async fetch(request, env) {
    const response = await route(request, env);
    // A page inside an edition's section remembers that edition for the next visit.
    const url = new URL(request.url);
    const section = ["kcaron.top", "www.kcaron.top"].includes(url.hostname) ? null : splitEditionPath(url.pathname);
    if (!section || response.status >= 400) return response;
    const remembered = new Response(response.body, response);
    remembered.headers.append("set-cookie", editionCookie(section.slug));
    return remembered;
  }
};

async function route(request, env) {
    // Guard every hostname, including workers.dev, before any static fallback.
    const privateResponse = await ownerResources(request, env);
    if (privateResponse) return privateResponse;
    const url = new URL(request.url);
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
    // Edition sections: /retail → /retail/ (the hub page); /retail/leaderboards/... is the bot's
    // /leaderboards/... page with ?edition=retail.
    const section = creator ? null : splitEditionPath(url.pathname);
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
      const asked = editionSection(url.searchParams.get("edition"));
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
    const companion = url.pathname === "/companion" || url.pathname.startsWith("/companion/");
    const api = apiMethods.has(url.pathname);
    const health = url.pathname === "/health";
    // Public guild pages, served by the bot (docs/GUILD_PAGES_DESIGN.md). Guilded host only.
    const guildPage = !creator && /^\/g\/[a-z0-9-]{1,40}\/?$/.test(url.pathname);
    // Signed-in website pages (7.0): Discord sign-in, recruitment, the player's page and the public
    // dungeon leaderboards. Rendered by the bot; the session cookie is for this host only.
    // Inside an edition's section only the public data pages exist (checked above).
    const web = !creator && url.pathname.length <= 200
      && /^\/(?:auth\/(?:login|callback|logout)|recruitment(?:\/[A-Za-z0-9._~/-]*)?|me(?:\/[A-Za-z0-9._~/-]*)?|players(?:\/[A-Za-z0-9._~/-]*)?|leaderboards(?:\/[A-Za-z0-9._~%/-]*)?)$/.test(pagePath);
    if (!companion && !api && !health && !guildPage && !web) {
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
    // Web pages: the session cookie, and Origin/Referer for the bot's CSRF check on form posts.
    const forwarded = api ? ["content-type", "content-encoding", "x-companion-credential", "authorization", "accept", "if-none-match"]
      : web ? ["accept", "accept-language", "content-type", "cookie", "origin", "referer"] : ["accept"];
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
    const pageView = (web || guildPage || companion) && ["GET", "HEAD"].includes(request.method) && (request.headers.get("accept") ?? "").includes("text/html");
    try {
      const body = request.method === "POST" ? await limitedBody(request) : undefined;
      let upstream, target;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt) await pause(200 * attempt);
        // Build from a fixed origin and the path, never a user-supplied destination.
        target = new URL(origins[attempt % origins.length]);
        target.pathname = pagePath;
        target.search = health || guildPage ? "" : url.search;
        if (section) target.searchParams.set("edition", section.edition);
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
      if (upstream.status >= 300 && upstream.status < 400) {
        // Never follow a redirect with credentials. Only the companion's and guild pages' local
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
        const allowed = companion ? ["/companion/"] : guildPage ? ["/g/"] : web ? ["/recruitment", "/me/", "/players", "/leaderboards", "/auth/"] : null;
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
      if (companion && request.method === "GET" && upstream.status === 200
        && upstream.headers.get("content-type")?.startsWith("text/html")) {
        const html = (await upstream.text()).replace('<nav aria-label="Main navigation">',
          '<nav aria-label="Main navigation"><a class="nav" href="/">Website &amp; guides</a>');
        responseHeaders.delete("content-length");
        responseHeaders.delete("content-encoding");
        return new Response(html, { status: upstream.status, headers: responseHeaders });
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return error.message === "body-limit" ? failure(413, "Request body is too large")
        : pageView ? unavailablePage(request, url) : failure(502, "The guild bot is temporarily unavailable. Try again shortly.");
    }
}
