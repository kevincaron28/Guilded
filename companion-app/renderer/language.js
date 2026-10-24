import catalog from '../i18n.cjs';

export function createLanguageUI(document, storage, browserLanguage, url) {
  const query = new URL(url).searchParams.get('lang');
  let stored;
  try { stored = storage?.getItem('guilded.companion.language'); } catch { /* optional storage */ }
  let language = catalog.normalizeLanguage(query || stored || browserLanguage);
  const explicit = ['en', 'fr'].includes(query) || ['en', 'fr'].includes(stored);
  const texts = [], attributes = [], originals = new Map();
  // Record only initial, authored markup. Never observe or rewrite later user data.
  const walker = document.createTreeWalker(document.body, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script,style,code')) continue;
    const key = node.textContent.trim();
    if (key) texts.push({ node, original: node.textContent, key, last: node.textContent });
  }
  for (const element of document.querySelectorAll('[id]')) originals.set(element.id, {
    text: element.textContent, placeholder: element.getAttribute('placeholder')
  });
  for (const element of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    for (const name of ['placeholder', 'aria-label', 'title']) {
      const key = element.getAttribute(name);
      if (key) attributes.push({ element, name, key, last: key });
    }
  }
  const ui = {
    get language() { return language; },
    explicit,
    t: (key, ...values) => catalog.translate(language, key, ...values),
    message: value => catalog.message(language, value),
    original: (id, attribute) => originals.get(id)?.[attribute || 'text'] ?? '',
    set(value, persist = true) {
      language = catalog.normalizeLanguage(value);
      if (persist) { try { storage?.setItem('guilded.companion.language', language); } catch { /* still translates */ } }
      document.documentElement.lang = language;
      for (const item of texts) {
        if (!item.node.isConnected || item.node.textContent !== item.last) continue;
        item.last = item.original.replace(item.key, () => ui.t(item.key));
        item.node.textContent = item.last;
      }
      for (const item of attributes) {
        if (item.element.getAttribute(item.name) !== item.last) continue;
        item.last = ui.t(item.key);
        item.element.setAttribute(item.name, item.last);
      }
      const control = document.getElementById('language');
      if (control) control.value = language;
      document.dispatchEvent(new CustomEvent('companion-language'));
    }
  };
  ui.set(language, false);
  return ui;
}
