(() => {
  const api = window.companion;
  if (!api?.hubView) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  let data = null, offline = false, savedAt = '', error = '', loading = false, saving = false, generation = 0;
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(c => c != null)); return node;
  };
  const text = (value, cls = 'micro') => el('p', { class: cls, text: value });
  const when = iso => new Date(iso).toLocaleString();

  async function load() {
    if (loading) return; loading = true;
    const request = generation;
    try {
      const result = await api.hubView(window.companionLanguage.language);
      if (request !== generation) return;
      if (result.ok) { data = result.data; offline = !!result.offline; savedAt = result.savedAt || ''; error = ''; }
      else { data = null; offline = false; error = result.error || T('Connect a guild account to see your characters and server.'); }
    } catch (e) { if (request === generation) { data = null; error = e.message; } }
    finally { if (request === generation) { loading = false; render(); } }
  }

  // The one status line on Home: connected or not, last refresh, and what to do next.
  function nextStep() {
    if (!data) return T('Next: connect your Discord account in Sync & setup.');
    const todo = (data.server?.checks || []).filter(c => !c.ok && !c.optional).length;
    if (todo) return T('Next: {0} setup item(s) need an officer. Open Server.', todo);
    if (!data.characters.length) return T('Next: save in WoW and sync, so your characters appear here.');
    return T('You are all set.');
  }
  function renderStatus() {
    const node = $('hubStatus'); if (!node) return;
    let line;
    if (data && !offline) line = T('Connected to {0} · updated {1}', data.guild.name, when(data.updatedAt));
    else if (data) line = T('Not connected: showing the data saved on {0}', when(savedAt));
    else line = error ? T('Not connected: {0}', error) : T('Not connected yet.');
    node.textContent = `${line} · ${nextStep()}`;
    node.hidden = false;
  }

  function renderCharacters() {
    const host = $('charactersContent'); host.replaceChildren();
    if (!data) { host.append(text(error || T('Connect a guild account to see your characters and server.'), 'result bad')); return; }
    if (offline) host.append(text(T('Not connected: showing the data saved on {0}', when(savedAt)), 'result bad'));
    if (!data.characters.length) { host.append(text(T('No character is linked to you yet. Save in WoW and sync, or use /character pair in Discord.'))); return; }
    const groups = new Map();
    for (const c of data.characters) { const key = c.guild.name + '\0' + c.guild.edition; if (!groups.has(key)) groups.set(key, { guild: c.guild, rows: [] }); groups.get(key).rows.push(c); }
    for (const { guild, rows } of groups.values()) {
      const items = rows.map(c => {
        const name = c.displayName || c.name;
        const cores = c.cores.length
          ? c.cores.map(k => `${k.name} (${T(k.role === 'TANK' ? 'Tank' : k.role === 'HEALER' ? 'Healer' : 'DPS')}${k.bench ? ', ' + T('bench') : ''}${k.trial ? ', ' + T('trial') : ''}${k.backup ? ', ' + T('backup') : ''})`).join(' · ')
          : T('Not in a raid core');
        return el('li', { class: 'edit-row' }, el('strong', { text: name + (c.isMain ? ' ★' : '') }),
          el('span', { text: [c.className, c.level ? T('level {0}', c.level) : '', c.realm].filter(Boolean).join(' · ') }),
          el('span', { class: 'pill', text: cores }));
      });
      host.append(el('article', { class: 'panel' },
        el('div', { class: 'section-title' }, el('h2', { text: guild.name }), el('span', { class: 'pill', text: guild.current ? T('This server') : T('Another server') })),
        text(T('Edition: {0}', guild.edition)), el('ul', { class: 'edit-list' }, ...items)));
    }
  }

  function renderReserves() {
    const host = $('reservesContent'); host.replaceChildren();
    if (!data) { host.append(text(error || T('Connect a guild account to see your characters and server.'), 'result bad')); return; }
    const r = data.reserves;
    const modes = r.cores.filter(c => c.lootMode === 'RESERVE');
    host.append(el('article', { class: 'panel' }, el('h2', { text: T('Where to reserve') }),
      text(T('Soft reserves are kept in the game addon by your raid leader (/guilded reserve) and reach Discord when the companion uploads. To keep your reserves from being overwritten, reserve in game; this page shows the list.')),
      modes.length ? text(T('Cores using soft reserves: {0}', modes.map(c => `${c.name} (${T('{0} per player', c.reservesPerPlayer)})`).join(', '))) : text(T('No raid core uses soft reserves right now.'))));
    if (!r.list || !r.list.active) { host.append(text(T('No soft-reserve list is open. An officer starts one in game with /guilded reserve open.'))); return; }
    host.append(el('article', { class: 'panel' },
      el('div', { class: 'section-title' }, el('h2', { text: r.list.title || T('Soft reserves') }), el('span', { class: 'pill', text: r.list.open ? T('Open') : T('Locked') })),
      text(T('{0} per player · synced {1}', r.list.perPlayer, when(r.list.syncedAt))),
      text(T('Your reserves: {0}', r.mineCount)),
      r.items.length ? el('ul', { class: 'edit-list' }, ...r.items.map(i => el('li', { class: 'edit-row' }, el('strong', { text: i.itemName + (i.mine ? ' ★' : '') }), el('span', { text: i.characters.join(', ') })))) : text(T('Nobody has reserved yet.'))));
  }

  async function change(payload) {
    if (saving) return; saving = true; $('serverContent').inert = true;
    try {
      const result = await api.hubEdit(payload);
      notice(result.ok ? window.companionLanguage.message(result.data.message) : (result.error || T('That change was not saved.')), !result.ok);
      if (result.ok) { loading = false; await load(); }
    } catch (e) { notice(e.message, true); }
    finally { saving = false; $('serverContent').inert = false; }
  }
  function notice(message, bad) { const n = $('serverNotice'); n.textContent = message; n.className = bad ? 'result bad' : 'micro'; }

  function toggle(title, help, on, onAction, offAction, onLabel = 'Turn on', offLabel = 'Turn off') {
    const state = el('span', { class: 'pill', text: on ? T('On') : T('Off') });
    const actions = [];
    if (!on && onAction) actions.push(el('button', { type: 'button', class: 'primary', text: T(onLabel) }));
    if (on && offAction) actions.push(el('button', { type: 'button', text: T(offLabel) }));
    actions.forEach(b => b.addEventListener('click', () => change(on ? offAction : onAction)));
    return el('article', { class: 'panel' }, el('div', { class: 'section-title' }, el('h2', { text: title }), state), text(help), el('div', { class: 'actions' }, ...actions));
  }

  function renderServer() {
    const host = $('serverContent'); host.replaceChildren();
    $('serverNav').hidden = !(data && data.me.officer);
    if (!data) { host.append(text(error || T('Connect a guild account to see your characters and server.'), 'result bad')); return; }
    if (!data.me.officer) { host.append(text(T('Only officers and guild masters can see this page.'))); return; }
    if (offline) { host.append(text(T('Not connected: showing the data saved on {0}', when(savedAt)), 'result bad')); return; }
    const s = data.server;
    const checks = s.checks;
    const list = checks === null
      ? text(T('The setup checklist could not be read from Discord right now. Try again, or run /setup in Discord.'), 'result bad')
      : el('ul', { class: 'edit-list' }, ...checks.map(c => el('li', {},
        el('strong', { text: (c.ok ? T('Done') : c.optional ? T('Optional') : T('Needs attention')) + ': ' + c.label }),
        c.ok ? null : text(c.fix))));
    host.append(el('article', { class: 'panel' }, el('h2', { text: T('Server setup') }), list,
      text(T('Creating channels and roles is done in Discord with /setup start: it asks before creating anything. This page shows what is missing.'))));
    const x = s.settings;
    host.append(
      el('article', { class: 'panel' }, el('h2', { text: T('Language of bot messages') }),
        el('div', { class: 'actions' }, ...['en', 'fr'].map(code => { const b = el('button', { type: 'button', class: x.language === code ? 'primary' : '', text: code === 'fr' ? 'Français' : 'English', 'aria-pressed': String(x.language === code) }); b.addEventListener('click', () => { if (x.language !== code) change({ action: 'server.language', value: code }); }); return b; }))),
      toggle(T('Achievement announcements'), x.achievementChannelSet
        ? T('Opt-in. When on, the bot posts one public message in your achievements channel when a member unlocks something. Members who hide their profile are skipped. Nothing is posted while this is off, and what members already earned is not announced.')
        : T('Opt-in. First pick the channel in Discord with /config achievements announce:true channel:#..., then turn it on here.'),
        x.achievementAnnounce, x.achievementChannelSet ? { action: 'server.achievements', on: true } : null, { action: 'server.achievements', on: false }),
      toggle(T('Public dungeon sharing'), x.publicSharing
        ? T('On: eligible dungeon runs, including non-guild party members, can be seen on the public leaderboards. Turning it off stops new publication; runs already public stay public.')
        : T('Off. To turn it on, an officer confirms it in Discord with /mod leaderboard share:true, where the details are shown first.'),
        x.publicSharing, null, { action: 'server.publicSharing.off' }),
      toggle(T('Raid reminders'), T('Signed-up players are pinged 60 minutes before a raid starts.'), x.reminders, { action: 'server.reminders', on: true }, { action: 'server.reminders', on: false }),
      toggle(T('Weekly guild report'), T('Posts a weekly summary in the announcements channel.'), x.weeklyReport, { action: 'server.weeklyReport', on: true }, { action: 'server.weeklyReport', on: false }),
      toggle(T('Apply uploads automatically'), T('When on, what a companion uploads is applied and announced right away. When off, officers apply uploads with /import apply.'), x.autoImport, { action: 'server.autoImport', on: true }, { action: 'server.autoImport', on: false }),
      el('article', { class: 'panel' }, el('h2', { text: T('Welcome flow') }),
        text(x.welcomeChannelSet || x.welcomeDelivery === 'DM' ? T('The welcome message is set up. Change it in Discord with /setup start, step 5.') : T('Not set up. Run /setup start in Discord, step 5.'))));
  }

  function render() { renderStatus(); renderCharacters(); renderReserves(); renderServer(); }

  for (const id of ['charactersReload', 'reservesReload', 'serverReload']) $(id).addEventListener('click', () => { loading = false; void load(); });
  document.querySelectorAll('[data-page="characters"],[data-page="reserves"],[data-page="server"]').forEach(b => b.addEventListener('click', () => void load()));
  document.addEventListener('companion-language', () => { if (!saving) render(); });
  document.addEventListener('companion-connection-changing', () => { generation++; loading = false; saving = false; data = null; error = ''; render(); });
  document.addEventListener('companion-connection-changed', () => { loading = false; void load(); });
  render();
  void load();
})();
