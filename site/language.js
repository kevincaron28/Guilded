// Public presentation preference only. No authentication or account state.
(() => {
  const controls = [...document.querySelectorAll('[data-set-language]')];
  if (!controls.length) return;
  const apply = language => {
    document.documentElement.lang = language;
    for (const element of document.querySelectorAll('[data-en][data-fr]')) element.textContent = element.dataset[language];
    for (const element of document.querySelectorAll('[data-label-en][data-label-fr]')) element.setAttribute('aria-label', element.dataset[language === 'fr' ? 'labelFr' : 'labelEn']);
    for (const button of controls) button.setAttribute('aria-pressed', String(button.dataset.setLanguage === language));
    for (const block of document.querySelectorAll('[data-language-copy]')) block.hidden = block.dataset.languageCopy !== language;
    try { window.localStorage.setItem('kc.language', language); } catch { /* the selected language still works */ }
    document.dispatchEvent(new window.CustomEvent('kc-language', { detail: language }));
  };
  let language = new URLSearchParams(window.location.search).get('lang');
  if (!['en', 'fr'].includes(language)) { try { language = window.localStorage.getItem('kc.language'); } catch { /* default below */ } }
  apply(language === 'fr' ? 'fr' : 'en');
  for (const button of controls) button.addEventListener('click', () => apply(button.dataset.setLanguage));
})();
