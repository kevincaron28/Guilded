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
  const fr = document.documentElement.lang === 'fr';
  try {
    const url = new URL(document.querySelector('#guild-address').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(fr ? 'Utilisez l’adresse HTTPS de votre guilde, sans identifiant, mot de passe ni jeton.' : 'Use your guild’s HTTPS address without a username, password or token.');
    const guild = url.searchParams.get('guild');
    url.pathname = '/companion/'; url.search = ''; url.hash = '';
    if (guild && /^\d{17,20}$/.test(guild)) url.searchParams.set('guild', guild);
    const link = document.createElement('a'); link.href = url.href; link.textContent = (fr ? 'Continuer vers ' : 'Continue to ') + url.hostname + ' →';
    result.replaceChildren(link);
  } catch (error) { result.textContent = error instanceof TypeError ? (fr ? 'Saisissez l’adresse HTTPS complète de votre guilde.' : 'Enter your guild’s complete HTTPS address.') : error.message; }
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

// Menu drop-downs (<details>, usable without this script): one open at a time; a click elsewhere
// or Escape closes them.
const navGroups = [...document.querySelectorAll('.nav-group')];
for (const group of navGroups) group.addEventListener('toggle', () => {
  if (group.open) for (const other of navGroups) if (other !== group) other.open = false;
});
document.addEventListener('click', event => {
  for (const group of navGroups) if (group.open && !group.contains(event.target)) group.open = false;
});
document.addEventListener('keydown', event => {
  const open = event.key === 'Escape' && navGroups.find(group => group.open);
  if (open) { open.open = false; open.querySelector('summary').focus(); }
});

// The header's version switcher outside an edition's pages: show the visitor's remembered WoW
// version (the guilded_edition cookie the website sets in /forever/, /retail/...).
const remembered = /(?:^|;\s*)guilded_edition=([a-z-]{1,20})/.exec(document.cookie)?.[1];
for (const menu of document.querySelectorAll('.edition-menu')) {
  const choice = remembered && menu.querySelector(`a[data-edition="${remembered}"]`);
  const playing = menu.querySelector('[data-edition-playing]');
  if (!choice || !playing) continue;
  playing.querySelector('strong').innerHTML = choice.innerHTML;
  playing.hidden = false;
  menu.querySelector('[data-edition-none]').hidden = true;
}

// "This week on Guilded" and each edition hub's leaderboard: public numbers from the bot
// (summary.json, no player names). Those numbers stay hidden when they cannot load, e.g. in the
// static preview; the hub's links to the full leaderboard still work.
const live = document.querySelector('[data-live-summary]');
if (live) {
  const numbers = live.querySelector('[data-live="numbers"]') ?? live;
  fetch(`${live.dataset.liveSummary || '/leaderboards/summary.json'}?lang=${document.documentElement.lang === 'fr' ? 'fr' : 'en'}`, { headers: { accept: 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (!data || typeof data.ratedRunsThisWeek !== 'number') return;
      live.querySelector('[data-live="runs"]').textContent = String(data.ratedRunsThisWeek);
      live.querySelector('[data-live="guilds"]').textContent = String(Number(data.guilds) || 0);
      const runs = Array.isArray(data.topRuns) ? data.topRuns.slice(0, 3) : [];
      const list = live.querySelector('[data-live="top"]');
      list.replaceChildren(...runs.map(run => {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = String(run.dungeon);
        item.append(name, ` · ${run.levels} · ${run.time} · ${run.score}`);
        return item;
      }));
      list.hidden = !runs.length;
      live.querySelector('[data-live="empty"]').hidden = runs.length > 0;
      if (!runs.length && !live.querySelector('.sample-board')) {
        const fr = document.documentElement.lang === 'fr';
        const sample = document.createElement('div');
        sample.className = 'sample-board';
        const title = document.createElement('p');
        title.className = 'eyebrow';
        title.textContent = fr ? 'EXEMPLE · PAS DE VRAIS ESSAIS' : 'EXAMPLE · NOT REAL RUNS';
        const rows = document.createElement('ol');
        rows.setAttribute('aria-label', fr ? 'Exemple de classement' : 'Example leaderboard');
        [['Dungeon name', '+12', '31:42', '412'], ['Dungeon name', '+11', '28:05', '388'], ['Dungeon name', '+10', '26:50', '351']].forEach(([dungeon, level, time, score], index) => {
          const item = document.createElement('li');
          item.append(`#${index + 1} `, Object.assign(document.createElement('strong'), { textContent: dungeon }), ` · ${level} · ${time} · ${score}`);
          rows.append(item);
        });
        sample.append(title, rows);
        live.querySelector('.live-runs').append(sample);
      }
      numbers.hidden = false;
    })
    .catch(() => { /* the rest of the page does not depend on it */ });
}

// Status page: probe the public health and leaderboard routes from the visitor's browser.
{
  const board = document.querySelector('[data-status-board]');
  if (board) {
    const show = (key, ok, text) => {
      const row = board.querySelector(`[data-status="${key}"]`);
      row.dataset.state = ok ? 'up' : 'down';
      row.querySelector('[data-status-text]').textContent = text;
    };
    const probe = async (url) => {
      const started = Date.now();
      const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      return { response, ms: Math.round(Date.now() - started) };
    };
    show('site', true, 'You are reading this page, so it is up.');
    Promise.all([
      probe('/health').then(async ({ response, ms }) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json().catch(() => ({}));
        show('bot', true, `Up${data.version ? ` · version ${data.version}` : ''} · ${ms} ms`);
      }).catch(() => show('bot', false, 'Not answering right now. See the steps below.')),
      probe('/leaderboards/summary.json').then(({ response, ms }) => {
        if (!response.ok) throw new Error(String(response.status));
        show('boards', true, `Up · ${ms} ms`);
      }).catch(() => show('boards', false, 'Not answering right now. See the steps below.'))
    ]).then(() => {
      board.parentElement.querySelector('[data-status-meta]').textContent = `Checked ${new Date().toLocaleTimeString()}.`;
    });
  }
}
// Forever launch countdown on the home page (a fixed UTC moment, so it is right in every time zone).
{
  const box = document.querySelector('[data-launch]');
  if (box) {
    const launch = Date.parse(box.dataset.launch);
    const render = () => {
      const fr = document.documentElement.lang === 'fr';
      const left = launch - Date.now();
      if (left <= 0) { box.textContent = box.dataset[fr ? 'frAfter' : 'enAfter']; return false; }
      const days = Math.floor(left / 864e5);
      const hours = Math.floor(left % 864e5 / 36e5);
      const minutes = Math.floor(left % 36e5 / 6e4);
      box.textContent = `${box.dataset[fr ? 'frBefore' : 'enBefore']} ${days} ${fr ? 'j' : 'd'} ${hours} h ${minutes} min`;
      return true;
    };
    box.hidden = false;
    if (render()) setInterval(render, 5000);
  }
}