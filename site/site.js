// The navigation remains visible when JavaScript is unavailable.
for (const header of document.querySelectorAll('.site-header')) {
  const toggle = header.querySelector('.menu-toggle');
  const navigation = header.querySelector('nav');
  if (!toggle || !navigation) continue;
  const close = () => {
    toggle.setAttribute('aria-expanded', 'false');
    header.classList.remove('is-open');
  };
  toggle.hidden = false;
  header.classList.add('nav-ready');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    header.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  });
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && header.classList.contains('is-open')) {
      close();
      toggle.focus();
    }
  });
  document.defaultView.matchMedia('(min-width: 981px)').addEventListener('change', close);
}

// Standard tab keyboard behavior: arrows, Home and End move and select.
for (const tour of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...tour.querySelectorAll('[role="tab"]')];
  const select = tab => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next]);
      tabs[next].focus();
    });
  }
}

const form = document.querySelector('#open-companion');
form?.addEventListener('submit', event => {
  event.preventDefault();
  const result = document.querySelector('#address-result');
  try {
    const url = new URL(document.querySelector('#guild-address').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use your guild’s HTTPS address without a username, password or token.');
    const guild = url.searchParams.get('guild');
    url.pathname = '/companion/'; url.search = ''; url.hash = '';
    if (guild && /^\d{17,20}$/.test(guild)) url.searchParams.set('guild', guild);
    const link = document.createElement('a'); link.href = url.href; link.textContent = 'Continue to ' + url.hostname + ' →';
    result.replaceChildren(link);
  } catch (error) { result.textContent = error.message || 'Enter your guild’s complete HTTPS address.'; }
});
for (const block of document.querySelectorAll('pre')) {
  const code = block.querySelector('code');
  if (!code) continue;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'copy'; button.textContent = 'Copy';
  button.setAttribute('aria-label', document.documentElement.lang === 'fr' ? 'Copier ce bloc de commandes' : 'Copy this command block');
  if (document.documentElement.lang === 'fr') button.textContent = 'Copier';
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.textContent); button.textContent = document.documentElement.lang === 'fr' ? 'Copié' : 'Copied'; }
    catch { button.textContent = document.documentElement.lang === 'fr' ? 'Sélectionnez et copiez le texte' : 'Select and copy the text'; }
  });
  block.before(button);
}
