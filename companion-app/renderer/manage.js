// The Wishlist and Cores & prices pages. The bot decides who may change what (the member's
// Discord roles); this page only hides what the bot would refuse.
(() => {
  const $ = id => document.getElementById(id);
  const api = window.companion;
  if (!api || !api.manageView) return;
  const GUILD = '';
  const ROLES = [['TANK', 'Tank'], ['HEALER', 'Healer'], ['DPS', 'DPS']];
  const ROLE_LABEL = Object.fromEntries(ROLES);
  const PRIORITIES = [[1, 'High'], [2, 'Medium'], [3, 'Low']];
  const MODE_LABEL = { EPGP: 'GP bids', COUNCIL: 'Loot council', RESERVE: 'Soft reserves', PRIORITY: 'EPGP priority, set prices' };
  const RULES = [
    ['description', 'Description', 'text'], ['realm', 'Realm', 'text'],
    ['lootMode', 'Loot system', 'mode'],
    ['attendanceEp', 'EP for attending', 'number'], ['lateEp', 'EP for arriving late', 'number'],
    ['bossEp', 'EP per boss killed', 'number'], ['completionEp', 'Bonus EP for a full clear', 'number'],
    ['baseGp', 'Base GP', 'number'], ['decayPercent', 'Decay (%)', 'number'],
    ['reservesPerPlayer', 'Soft reserves per player (1-5)', 'number'],
    ['offspecPercent', 'Off-spec pays (% of GP)', 'number'], ['minEp', 'Minimum EP for priority', 'number']
  ];
  let view = null;
  // The core shown (null before the first load: the first core, not the guild-wide list).
  let coreChoice = null;
  let loading = false;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(child => child !== null && child !== undefined));
    return node;
  }
  function options(select, rows, selected) {
    select.replaceChildren(...rows.map(([value, label]) => el('option', { value: String(value), text: label })));
    if (selected !== undefined && selected !== null) select.value = String(selected);
  }
  function notice(id, message, ok) {
    $(id).textContent = message || ''; $(id).hidden = !message; $(id).className = `result ${ok ? 'ok' : 'bad'}`;
  }
  const say = (message, ok) => { notice('wishNotice', message, ok); notice('coreNotice', message, ok); };
  const leader = () => !!view?.me.raidLeader;
  const core = () => view?.cores.find(row => row.id === $('coreSelect').value) || null;

  async function load(keepMessage) {
    if (loading) return; loading = true;
    try {
      const result = await api.manageView();
      if (!result.ok) { view = null; $('wishPanel').hidden = true; $('corePanels').hidden = true; say(result.error || 'Could not load. Connect your Discord account in Connection & setup.', false); return; }
      view = result.data;
      if (!keepMessage) say('', true);
      $('manageItems').replaceChildren(...view.itemNames.map(name => el('option', { value: name })));
      renderWishlist(); renderCores();
    } finally { loading = false; }
  }

  // One change, then the fresh state from the bot (so the page never shows what was not saved).
  async function change(button, body) {
    if (button) button.disabled = true;
    try {
      const result = await api.manageEdit(body);
      say(result.ok ? result.data.message : result.error || 'That change was not saved.', result.ok);
      await load(true);
      return result.ok;
    } finally { if (button) button.disabled = false; }
  }

  function renderWishlist() {
    const selected = $('wishCharacter').value;
    $('wishPanel').hidden = false;
    if (!view.characters.length) {
      $('wishPanel').hidden = true;
      notice('wishNotice', 'No character is linked to your Discord account yet. Sync your addon data once, or use /character in Discord.', false);
      return;
    }
    options($('wishCharacter'), view.characters.map(row => [row.id, `${row.name}${row.isMain ? ' (main)' : ''}`]), view.characters.some(row => row.id === selected) ? selected : view.characters[0].id);
    const character = view.characters.find(row => row.id === $('wishCharacter').value);
    $('wishList').replaceChildren(...(character.wishlist.length ? character.wishlist.map(entry => {
      const priority = el('select', { class: 'narrow', 'aria-label': `Priority of ${entry.itemName}` });
      options(priority, PRIORITIES, entry.priority);
      priority.addEventListener('change', () => change(priority, { action: 'wishlist.set', characterId: character.id, item: entry.itemName, priority: Number(priority.value) }));
      const remove = el('button', { class: 'quiet', type: 'button', text: 'Remove' });
      remove.addEventListener('click', () => change(remove, { action: 'wishlist.remove', characterId: character.id, item: entry.itemName }));
      return el('div', { class: 'edit-row' }, el('span', { class: 'grow', text: entry.itemName }), priority, remove);
    }) : [el('p', { class: 'micro', text: `${character.name} has no wishlist items yet.` })]));
  }

  function renderCores() {
    const selected = coreChoice;
    const rows = [...view.cores.map(row => [row.id, row.name]), ...(view.coreLootOnly ? [] : [[GUILD, 'Guild-wide prices']])];
    $('corePanels').hidden = rows.length === 0;
    if (!rows.length) { notice('coreNotice', 'No raid core yet. Create one in Discord with /core create.', false); return; }
    options($('coreSelect'), rows, rows.some(([id]) => id === selected) ? selected : rows[0][0]);
    coreChoice = $('coreSelect').value;
    const current = core();
    $('rulesPanel').hidden = !current; $('rosterPanel').hidden = !current;
    $('coreSummary').textContent = current
      ? `${MODE_LABEL[current.effective.lootMode] || current.effective.lootMode} · ${current.effective.separatePool ? "this core's own point pool" : 'shared guild pool'}${current.schedule ? ` · ${current.schedule}` : ''}${leader() ? '' : ' · view only'}`
      : `Prices used by every core that does not set its own${leader() ? '' : ' · view only'}`;
    renderPrices(current); if (current) { renderRules(current); renderRoster(current); }
  }

  function renderPrices(current) {
    const prices = current ? current.prices : view.guildPrices;
    const coreId = current ? current.id : null;
    $('priceCount').textContent = `${prices.length} set`;
    $('priceEdit').hidden = !leader();
    $('priceList').replaceChildren(...(prices.length ? prices.map(price => {
      const label = el('span', { class: 'grow', text: price.name }, price.id ? el('span', { class: 'tag', text: `  #${price.id}` }) : null);
      if (!leader()) return el('div', { class: 'edit-row' }, label, el('span', { text: `${price.gp} GP` }));
      const gp = el('input', { class: 'number', type: 'number', min: '0', max: '100000', value: String(price.gp), 'aria-label': `Price of ${price.name}` });
      const save = el('button', { type: 'button', text: 'Save' });
      // A price given by id alone is kept by its id ("Item 19019" is only its label).
      const key = /^Item \d+$/.test(price.name) && price.id ? String(price.id) : price.name;
      save.addEventListener('click', () => { if (gp.value !== '' && Number(gp.value) >= 0) change(save, { action: 'prices.set', coreId, text: `${key} = ${Math.round(Number(gp.value))}` }); });
      const remove = el('button', { class: 'quiet', type: 'button', text: 'Remove' });
      remove.addEventListener('click', () => change(remove, { action: 'prices.remove', coreId, item: key }));
      return el('div', { class: 'edit-row' }, label, gp, save, remove);
    }) : [el('p', { class: 'micro', text: current ? `${current.name} has no prices of its own.` : 'No guild-wide prices yet.' })]));
  }

  function renderRules(current) {
    $('rulesActions').hidden = !leader();
    $('rulesGrid').replaceChildren(...RULES.map(([field, label, kind]) => {
      const own = current.own[field];
      let input;
      if (kind === 'mode') {
        input = el('select', { id: `rule-${field}` });
        options(input, [...(view.coreLootOnly ? [] : [['', `Guild default (${MODE_LABEL[current.effective.lootMode] || current.effective.lootMode})`]]), ...view.lootModes.map(mode => [mode, MODE_LABEL[mode] || mode])], own ?? (view.coreLootOnly ? current.effective.lootMode : ''));
      } else {
        const fallback = kind === 'number' ? current.effective[field] : null;
        input = el('input', { id: `rule-${field}`, type: kind, value: own === null ? '' : String(own), placeholder: fallback === null || fallback === undefined ? '' : `${fallback} (guild default)` });
        if (kind === 'number') { input.min = field === 'reservesPerPlayer' ? '1' : '0'; if (['decayPercent', 'offspecPercent'].includes(field)) input.max = '100'; if (field === 'reservesPerPlayer') input.max = '5'; }
        else input.maxLength = field === 'description' ? 300 : 60;
      }
      input.disabled = !leader();
      return el('label', {}, label, input);
    }));
  }

  function characterOptions(memberId, selected, none) {
    const member = view.members.find(row => row.id === memberId);
    const names = member ? member.characters.map(row => row.name) : [];
    if (selected && !names.includes(selected)) names.unshift(selected);
    return [...(none ? [['', none]] : []), ...names.map(name => [name, name])];
  }

  function renderRoster(current) {
    const order = { TANK: 0, HEALER: 1, DPS: 2 };
    const spots = current.members.slice().sort((a, b) => Number(a.bench) - Number(b.bench) || order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    const mains = spots.filter(spot => !spot.bench && !spot.trial).length;
    $('rosterCount').textContent = `${mains} member${mains === 1 ? '' : 's'}`;
    $('rosterAdd').hidden = !leader();
    $('rosterList').replaceChildren(...(spots.length ? spots.flatMap(spot => {
      const tags = `${spot.trial ? '  trial' : ''}${spot.bench ? '  bench' : ''}`;
      const name = el('span', { class: 'grow', text: spot.name }, tags ? el('span', { class: 'tag', text: tags }) : null);
      if (!leader()) {
        return [el('div', { class: 'edit-row' }, name, el('span', { text: `${ROLE_LABEL[spot.role]}${spot.character ? ` · ${spot.character}` : ''}` })),
          ...spot.backups.map(backup => el('div', { class: 'edit-row sub-row' }, el('span', { text: `Backup: ${backup.character} (${ROLE_LABEL[backup.role]})` })))];
      }
      const base = { coreId: current.id, memberId: spot.memberId };
      const character = el('select', { 'aria-label': `Character of ${spot.name}` });
      options(character, characterOptions(spot.memberId, spot.character, 'No character'), spot.character ?? '');
      const role = el('select', { class: 'narrow', 'aria-label': `Role of ${spot.name}` });
      options(role, ROLES, spot.role);
      const bench = el('input', { type: 'checkbox', checked: spot.bench });
      const save = el('button', { type: 'button', text: 'Save' });
      // Saving a trial member makes them a full member, as /core add does.
      save.addEventListener('click', () => change(save, { ...base, action: 'core.member.set', role: role.value, bench: bench.checked, character: character.value || null }));
      const remove = el('button', { class: 'quiet', type: 'button', text: 'Remove' });
      remove.addEventListener('click', () => change(remove, { ...base, action: 'core.member.remove' }));
      const backupCharacter = el('select', { 'aria-label': `Backup character of ${spot.name}` });
      const taken = [spot.character, ...spot.backups.map(backup => backup.character)];
      options(backupCharacter, [['', 'Add a backup character…'], ...characterOptions(spot.memberId).filter(([value]) => !taken.includes(value))], '');
      const backupRole = el('select', { class: 'narrow', 'aria-label': 'Backup role' });
      options(backupRole, ROLES, 'DPS');
      const addBackup = el('button', { class: 'quiet', type: 'button', text: 'Add backup' });
      addBackup.addEventListener('click', () => { if (backupCharacter.value) change(addBackup, { ...base, action: 'core.backup.set', character: backupCharacter.value, role: backupRole.value }); });
      return [
        el('div', { class: 'edit-row' }, name, character, role, el('label', { class: 'check' }, bench, 'Bench'), save, remove),
        ...spot.backups.map(backup => {
          const drop = el('button', { class: 'quiet', type: 'button', text: 'Remove backup' });
          drop.addEventListener('click', () => change(drop, { ...base, action: 'core.backup.remove', character: backup.character }));
          return el('div', { class: 'edit-row sub-row' }, el('span', { class: 'grow', text: `Backup: ${backup.character} (${ROLE_LABEL[backup.role]})` }), drop);
        }),
        ...(backupCharacter.options.length > 1 ? [el('div', { class: 'edit-row sub-row' }, backupCharacter, backupRole, addBackup)] : [])
      ];
    }) : [el('p', { class: 'micro', text: `${current.name} has no players yet.` })]));
    if (!leader()) return;
    const inCore = new Set(current.members.map(spot => spot.memberId));
    const previous = $('rosterMember').value;
    options($('rosterMember'), [['', 'Choose a player…'], ...view.members.filter(row => !inCore.has(row.id)).map(row => [row.id, row.displayName])], inCore.has(previous) ? '' : previous);
    options($('rosterCharacter'), characterOptions($('rosterMember').value, null, 'No character'), '');
  }

  $('wishCharacter').addEventListener('change', renderWishlist);
  $('coreSelect').addEventListener('change', () => { coreChoice = $('coreSelect').value; say('', true); renderCores(); });
  $('rosterMember').addEventListener('change', () => options($('rosterCharacter'), characterOptions($('rosterMember').value, null, 'No character'), ''));
  $('wishAdd').addEventListener('submit', async event => {
    event.preventDefault();
    if (await change($('btnWishAdd'), { action: 'wishlist.set', characterId: $('wishCharacter').value, item: $('wishItem').value.trim(), priority: Number($('wishPriority').value) })) $('wishItem').value = '';
  });
  $('priceAdd').addEventListener('submit', async event => {
    event.preventDefault();
    const current = core();
    if (await change(event.submitter, { action: 'prices.set', coreId: current ? current.id : null, text: `${$('priceItem').value.trim()} = ${Math.round(Number($('priceGp').value))}` })) { $('priceItem').value = ''; $('priceGp').value = ''; }
  });
  $('btnPriceText').addEventListener('click', async () => {
    const current = core();
    if (!$('priceText').value.trim()) return;
    if (await change($('btnPriceText'), { action: 'prices.set', coreId: current ? current.id : null, text: $('priceText').value })) $('priceText').value = '';
  });
  $('rulesForm').addEventListener('submit', event => {
    event.preventDefault();
    const current = core();
    if (!current) return;
    const changes = {};
    for (const [field, , kind] of RULES) {
      const raw = $(`rule-${field}`).value.trim();
      const value = raw === '' ? null : kind === 'number' ? Math.round(Number(raw)) : raw;
      if (value !== current.own[field]) changes[field] = value;
    }
    if (!Object.keys(changes).length) { say('Nothing changed.', true); return; }
    change(event.submitter, { action: 'core.update', coreId: current.id, base: current.own, changes });
  });
  $('rosterAdd').addEventListener('submit', event => {
    event.preventDefault();
    const current = core();
    if (!current || !$('rosterMember').value) return;
    change(event.submitter, { action: 'core.member.set', coreId: current.id, memberId: $('rosterMember').value, role: $('rosterRole').value, bench: $('rosterBench').checked, character: $('rosterCharacter').value || null });
  });
  $('btnWishReload').addEventListener('click', () => load());
  $('btnCoreReload').addEventListener('click', () => load());
  document.querySelectorAll('[data-page="wishlist"],[data-page="cores"]').forEach(button => button.addEventListener('click', () => load()));
  if (['wishlist', 'cores'].includes(new URLSearchParams(location.search).get('tab'))) load();
})();
