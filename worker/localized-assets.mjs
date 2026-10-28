import { localizedHref } from '../site/nav.mjs';
import { decodeHTML } from 'entities';

// Translate the authored bilingual markup before sending HTML to crawlers and
// browsers. User-generated bot pages retain their own server-side translations.
export async function localizedAsset(request, env) {
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
