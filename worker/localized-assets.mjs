import { localizedHref } from '../site/nav.mjs';
import { decodeHTML } from 'entities';
import { GUIDE_REDIRECTS } from '../site/static-redirects.mjs';

/** Static-page redirects applied before an asset is read.
 * /editions/ is the old one-card chooser; the downloads are on /download/.
 * /editions/forever/ stays a real page. Old PoE2 and Diablo pages live on Quebec Gold.
 * Query (including ?lang=) is kept. worker/index.mjs is left to the mobile-launch PR.
 * @param {URL} url
 * @returns {string | null}
 */
// The table lives in site/static-redirects.mjs so the site build can leave redirecting pages out of the sitemap.


// French copies live at /fr/<same path>. Data pages, the companion and edition roots stay on ?lang=
// because the Worker routes those itself (worker/index.mjs, PR #345).
const FRENCH_SKIP = /^\/(?:companion|forever|classic-era|tbc|mists|retail|leaderboards|recruitment|players|me|auth|g|health|api|downloads)(?:\/|$)/;

function isFolderPage(pathname) {
  if (FRENCH_SKIP.test(pathname)) return false;
  if (pathname === "/") return true;
  if (/\.(?:css|js|mjs|json|png|jpe?g|gif|webp|svg|ico|woff2?|map|txt|xml)$/i.test(pathname)) return false;
  return pathname.endsWith("/") || pathname.endsWith(".html") || !pathname.split("/").pop().includes(".");
}

function stripFr(pathname) {
  if (pathname === "/fr" || pathname === "/fr/") return "/";
  if (pathname.startsWith("/fr/")) return pathname.slice(3);
  return null;
}

function toFr(pathname) {
  if (pathname === "/fr" || pathname.startsWith("/fr/")) return pathname.endsWith("/") || pathname.includes(".") ? pathname : `${pathname}/`;
  if (pathname === "/") return "/fr/";
  return `/fr${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function searchWithoutLang(url) {
  const query = new URLSearchParams(url.searchParams);
  query.delete("lang");
  const rest = query.toString();
  return rest ? `?${rest}` : "";
}

export function staticRedirect(url) {
  if (/^\/quebec-gold\/(?:poe2|diablo)\/?$/.test(url.pathname)) return `/quebec-gold/${url.search}`;
  // /editions/forever/ stays a real page: the Worker already sends removed-edition addresses there
  // in one hop (worker/index.mjs, owned by PR #345).
  const stripped = stripFr(url.pathname);
  const path = stripped ?? url.pathname;
  const french = stripped !== null || url.searchParams.get("lang") === "fr";
  let target = null;
  if (GUIDE_REDIRECTS[path]) target = GUIDE_REDIRECTS[path];
  if (target) {
    const dest = french && isFolderPage(target) ? toFr(target) : target;
    const search = dest.startsWith("/fr") ? searchWithoutLang(url) : url.search;
    return `${dest}${search}`;
  }
  if (stripped === null && url.searchParams.get("lang") === "fr" && isFolderPage(path)) {
    const normalized = path === "/" || path.endsWith("/") || path.endsWith(".html") ? path : `${path}/`;
    return `${toFr(normalized)}${searchWithoutLang(url)}`;
  }
  if (stripped !== null && isFolderPage(path) && path !== "/" && !path.endsWith("/") && !path.endsWith(".html")) {
    return `${toFr(`${path}/`)}${searchWithoutLang(url)}`;
  }
  return null;
}

function languageUrl(raw, language) {
  const target = new URL(decodeHTML(raw));
  if (language === "fr" && isFolderPage(target.pathname)) {
    target.pathname = toFr(target.pathname);
    target.searchParams.delete("lang");
  } else if (language === "fr") target.searchParams.set("lang", "fr");
  else target.searchParams.delete("lang");
  return target.href;
}

// Translate the authored bilingual markup before sending HTML to crawlers and
// browsers. User-generated bot pages retain their own server-side translations.
export async function localizedAsset(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    const location = staticRedirect(url);
    if (location) return new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=86400" } });
  }
  const stripped = stripFr(url.pathname);
  let assetRequest = request;
  let language = url.searchParams.get("lang");
  if (stripped && (request.method === "GET" || request.method === "HEAD")) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = stripped;
    assetRequest = new Request(assetUrl, { method: request.method });
    language = language || "fr";
  }
  const response = await env.ASSETS.fetch(assetRequest);
  if (!['en', 'fr'].includes(language) || !response.headers.get('content-type')?.startsWith('text/html')) return response;
  const rewrite = new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('lang', language); } })
    .on('[data-en][data-fr]', { element(el) { el.setInnerContent(decodeHTML(el.getAttribute(`data-${language}`))); } })
    .on('[data-language-copy]', { element(el) {
      if (el.getAttribute('data-language-copy') === language) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    } })
    .on('[data-alt-en][data-alt-fr]', { element(el) { el.setAttribute('alt', decodeHTML(el.getAttribute(`data-alt-${language}`))); } })
    .on('[data-label-en][data-label-fr]', { element(el) { el.setAttribute('aria-label', decodeHTML(el.getAttribute(`data-label-${language}`))); } })
    .on('meta[data-content-en][data-content-fr]', { element(el) { el.setAttribute('content', decodeHTML(el.getAttribute(`data-content-${language}`))); } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', languageUrl(el.getAttribute('content'), language)); } })
    .on('[data-set-language]', { element(el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-set-language') === language)); } })
    .on('a[href]', { element(el) { el.setAttribute('href', localizedHref(decodeHTML(el.getAttribute('href')), language)); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', languageUrl(el.getAttribute('href'), language)); } })
    .on('link[rel="alternate"]', { element(el) {
      if (el.getAttribute('hreflang') === 'fr') el.setAttribute('href', languageUrl(el.getAttribute('href'), 'fr'));
    } });
  const headers = new Headers(response.headers);
  headers.set('content-language', language);
  headers.delete('content-length');
  headers.delete('etag');
  return rewrite.transform(new Response(response.body, { status: response.status, headers }));
}
