// Public presentation preference only. No authentication or account state.
import { localizedHref } from './nav.mjs';
(() => {
  const controls = [...document.querySelectorAll('[data-set-language]')];
  if (!controls.length) return;
  const apply = language => {
    document.documentElement.lang = language;
    for (const element of document.querySelectorAll('[data-en][data-fr]')) element.textContent = element.dataset[language];
    for (const element of document.querySelectorAll('[data-label-en][data-label-fr]')) element.setAttribute('aria-label', element.dataset[language === 'fr' ? 'labelFr' : 'labelEn']);
    for (const element of document.querySelectorAll('[data-alt-en][data-alt-fr]')) element.alt = element.dataset[language === 'fr' ? 'altFr' : 'altEn'];
    for (const element of document.querySelectorAll('meta[data-content-en][data-content-fr]')) element.content = element.dataset[language === 'fr' ? 'contentFr' : 'contentEn'];
    for (const button of controls) button.setAttribute('aria-pressed', String(button.dataset.setLanguage === language));
    for (const block of document.querySelectorAll('[data-language-copy]')) block.hidden = block.dataset.languageCopy !== language;
    for (const anchor of document.querySelectorAll('a[href]')) {
      anchor.setAttribute('href', localizedHref(anchor.getAttribute('href'), language));
    }
    const title = document.querySelector('title[data-en][data-fr]');
    if (title) document.title = title.dataset[language];
    try { window.localStorage.setItem('kc.language', language); } catch { /* the selected language still works */ }
    document.dispatchEvent(new window.CustomEvent('kc-language', { detail: language }));
  };
  let language = new URLSearchParams(window.location.search).get('lang') || (window.location.hash === '#fr' ? 'fr' : null);
  if (!['en', 'fr'].includes(language)) { try { language = window.localStorage.getItem('kc.language'); } catch { /* default below */ } }
  apply(language === 'fr' ? 'fr' : 'en');
  window.addEventListener('hashchange', () => { if (window.location.hash === '#fr') apply('fr'); });
  for (const button of controls) button.addEventListener('click', () => {
    const language = button.dataset.setLanguage;
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    window.history.replaceState(window.history.state, '', url);
    apply(language);
  });
})();
