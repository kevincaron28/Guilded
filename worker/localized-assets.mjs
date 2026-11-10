import { localizedHref } from '../site/nav.mjs';
import { decodeHTML } from 'entities';

/** Static-page redirects applied before an asset is read.
 * /editions/ is the old one-card chooser; the downloads are on /download/.
 * /editions/forever/ stays a real page. Old PoE2 and Diablo pages live on Quebec Gold.
 * Query (including ?lang=) is kept. worker/index.mjs is left to the mobile-launch PR.
 * @param {URL} url
 * @returns {string | null}
 */
const GUIDE_REDIRECTS = {
  "/start": "/guide/start/",
  "/start/": "/guide/start/",
  "/features": "/",
  "/features/": "/",
  "/officers": "/guide/officers/",
  "/officers/": "/guide/officers/",
  "/guides/install": "/guide/install/",
  "/guides/install/": "/guide/install/",
  "/guides/link": "/guide/link-character/",
  "/guides/link/": "/guide/link-character/",
  "/docs/QUICK_START": "/guide/start/",
  "/docs/QUICK_START.html": "/guide/start/",
  "/docs/MEMBER_INSTALL": "/guide/install/",
  "/docs/MEMBER_INSTALL.html": "/guide/install/",
  "/docs/DUNGEONS_GUIDE": "/guide/dungeons/",
  "/docs/DUNGEONS_GUIDE.html": "/guide/dungeons/",
  "/docs/EPGP_GUIDE": "/guide/epgp/",
  "/docs/EPGP_GUIDE.html": "/guide/epgp/"
};

export function staticRedirect(url) {
  if (/^\/quebec-gold\/(?:poe2|diablo)\/?$/.test(url.pathname)) return `/quebec-gold/${url.search}`;
  // /editions/forever/ stays a real page: the Worker already sends removed-edition addresses there
  // in one hop (worker/index.mjs, owned by PR #345).
  if (url.pathname === "/editions" || url.pathname === "/editions/") return `/download/${url.search}`;
  const guide = GUIDE_REDIRECTS[url.pathname];
  if (guide) return `${guide}${url.search}`;
  return null;
}

// Translate the authored bilingual markup before sending HTML to crawlers and
// browsers. User-generated bot pages retain their own server-side translations.
export async function localizedAsset(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    const location = staticRedirect(url);
    if (location) return new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=86400" } });
  }
  const response = await env.ASSETS.fetch(request);
  const language = new URL(request.url).searchParams.get('lang');
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
    .on('meta[property="og:url"]', { element(el) {
      const url = new URL(decodeHTML(el.getAttribute('content')));
      if (language === 'fr') url.searchParams.set('lang', 'fr'); else url.searchParams.delete('lang');
      el.setAttribute('content', url.href);
    } })
    .on('[data-set-language]', { element(el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-set-language') === language)); } })
    .on('a[href]', { element(el) { el.setAttribute('href', localizedHref(decodeHTML(el.getAttribute('href')), language)); } })
    .on('link[rel="canonical"]', { element(el) {
      const url = new URL(decodeHTML(el.getAttribute('href')));
      if (language === 'fr') url.searchParams.set('lang', 'fr'); else url.searchParams.delete('lang');
      el.setAttribute('href', url.href);
    } });
  const headers = new Headers(response.headers);
  headers.set('content-language', language);
  headers.delete('content-length');
  headers.delete('etag');
  return rewrite.transform(new Response(response.body, { status: response.status, headers }));
}
