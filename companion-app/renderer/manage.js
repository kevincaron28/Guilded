(() => {
  const $ = id => document.getElementById(id);
  const api = window.companion;
  const T = (key, ...values) => window.companionLanguage.t(key, ...values);
  const M = value => window.companionLanguage.message(value);
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
  let saving = false;

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
    $(id).textContent = M(message) || ''; $(id).hidden = !message; $(id).className = `result ${ok ? 'ok' : 'bad'}`;
  }
  const say = (message, ok) => { notice('wishNotice', message, ok); notice('coreNotice', message, ok); };
  const leader = () => !!view?.me.raidLeader;
  const core = () => view?.cores.find(row => row.id === $('coreSelect').value) || null;

  async function load(keepMessage, afterSave = false) {
    if (loading || (saving && !afterSave)) return; loading = true;
    try {
      const result = await api.manageView();
      if (!result.ok) { view = null; $('wishPanel').hidden = true; $('corePanels').hidden = true; say(result.error || T("Could not load. Connect your Discord account in Connection & setup."), false); return; }
      view = result.data;
      if (!keepMessage) say('', true);
      $('manageItems').replaceChildren(...view.itemNames.map(name => el('option', { value: name })));
      renderWishlist(); renderCores();
    } catch {
      say(T("Could not load. Check your connection and try Reload."), false);
    } finally { loading = false; }
  }

  // One change, then the fresh state from the bot (so the page never shows what was not saved).
  async function change(button, body) {
    if (saving || loading) return false;
    saving = true;
    // Inert survives translated child controls being rebuilt while the request is pending.
    $('wishPanel').inert = true; $('corePanels').inert = true;
    $('btnWishReload').disabled = true; $('btnCoreReload').disabled = true;
    if (button) button.disabled = true;
    try {
      const result = await api.manageEdit(body);
      say(result.ok ? result.data.message : result.error || T("That change was not saved."), result.ok);
      // A refused edit must retain its draft, including the original conflict-check base.
      if (result.ok) await load(true, true);
      return result.ok;
    } catch {
      say(T("Could not confirm that change. Your draft is kept. Check your connection and Reload before retrying."), false);
      return false;
    } finally {
      saving = false;
      $('wishPanel').inert = false; $('corePanels').inert = false;
      $('btnWishReload').disabled = false; $('btnCoreReload').disabled = false;
      if (button) button.disabled = false;
    }
  }

  function renderWishlist() {
    const selected = $('wishCharacter').value;
    $('wishPanel').hidden = false;
    if (!view.characters.length) {
      $('wishPanel').hidden = true;
      notice('wishNotice', T("No character is linked to your Discord account yet. Sync your addon data once, or use /character in Discord."), false);
      return;
    }
    options($('wishCharacter'), view.characters.map(row => [row.id, `${row.displayName || row.name}${row.isMain ? T(" (main)") : ''}`]), view.characters.some(row => row.id === selected) ? selected : view.characters[0].id);
    const character = view.characters.find(row => row.id === $('wishCharacter').value);
    $('wishList').replaceChildren(...(character.wishlist.length ? character.wishlist.map(entry => {
      const priority = el('select', { class: 'narrow', 'aria-label': T("Priority of {0}", entry.itemName) });
      options(priority, PRIORITIES.map(([v,label]) => [v,T(label)]), entry.priority);
      priority.addEventListener('change', () => change(priority, { action: 'wishlist.set', characterId: character.id, item: entry.itemName, priority: Number(priority.value) }));
      const remove = el('button', { class: 'quiet', type: 'button', text: T("Remove") });
      remove.addEventListener('click', () => change(remove, { action: 'wishlist.remove', characterId: character.id, item: entry.itemName }));
      return el('div', { class: 'edit-row' }, el('span', { class: 'grow', text: entry.itemName }), priority, remove);
    }) : [el('p', { class: 'micro', text: T("{0} has no wishlist items yet.", character.displayName || character.name) })]));
  }

  function renderCores() {
    const selected = coreChoice;
    const rows = [...view.cores.map(row => [row.id, row.name]), ...(view.coreLootOnly ? [] : [[GUILD, T("Guild-wide prices")]])];
    $('corePanels').hidden = rows.length === 0;
    if (!rows.length) { notice('coreNotice', T("No raid core yet. Create one in Discord with /core create."), false); return; }
    options($('coreSelect'), rows, rows.some(([id]) => id === selected) ? selected : rows[0][0]);
    coreChoice = $('coreSelect').value;
    const current = core();
    $('rulesPanel').hidden = !current; $('rosterPanel').hidden = !current;
    $('coreSummary').textContent = current
      ? `${T(MODE_LABEL[current.effective.lootMode] || current.effective.lootMode)} · ${current.effective.separatePool ? T("this core's own point pool") : T("shared guild pool")}${current.schedule ? ` · ${current.schedule}` : ''}${leader() ? '' : T(" · view only")}`
      : T("Prices used by every core that does not set its own{0}", leader() ? '' : T(" · view only"));
    renderPrices(current); if (current) { renderRules(current); renderRoster(current); }
  }

  function renderPrices(current) {
    const prices = current ? current.prices : view.guildPrices;
    const coreId = current ? current.id : null;
    $('priceCount').textContent = T("{0} set", prices.length);
    $('priceEdit').hidden = !leader();
    $('priceList').replaceChildren(...(prices.length ? prices.map(price => {
      const label = el('span', { class: 'grow', text: price.name }, price.id ? el('span', { class: 'tag', text: `  ${price.key || '#' + price.id}` }) : null);
      if (!leader()) return el('div', { class: 'edit-row' }, label, el('span', { text: `${price.gp} GP` }));
      const gp = el('input', { class: 'number', type: 'number', min: '0', max: '100000', value: String(price.gp), 'aria-label': T("Price of {0}", price.name) });
      const save = el('button', { type: 'button', text: T("Save") });
      // A price given by id alone is kept by its id ("Item 19019" is only its label).
      const key = price.key?.startsWith('#') ? `id:${price.key.slice(1)}` : /^Item \d+$/.test(price.name) && price.id ? String(price.id) : price.name;
      save.addEventListener('click', () => { if (gp.value !== '' && Number(gp.value) >= 0) change(save, { action: 'prices.set', coreId, text: `${key} = ${Math.round(Number(gp.value))}` }); });
      const remove = el('button', { class: 'quiet', type: 'button', text: T("Remove") });
      remove.addEventListener('click', () => change(remove, { action: 'prices.remove', coreId, item: key }));
      return el('div', { class: 'edit-row' }, label, gp, save, remove);
    }) : [el('p', { class: 'micro', text: current ? T("{0} has no prices of its own.", current.name) : T("No guild-wide prices yet.") })]));
  }

  function renderRules(current) {
    $('rulesActions').hidden = !leader();
    $('rulesGrid').replaceChildren(...RULES.map(([field, label, kind]) => {
      const own = current.own[field];
      let input;
      if (kind === 'mode') {
        input = el('select', { id: `rule-${field}` });
        options(input, [...(view.coreLootOnly ? [] : [['', T("Guild default ({0})", T(MODE_LABEL[current.effective.lootMode] || current.effective.lootMode))]]), ...view.lootModes.map(mode => [mode, T(MODE_LABEL[mode] || mode)])], own ?? (view.coreLootOnly ? current.effective.lootMode : ''));
      } else {
        const fallback = kind === 'number' ? current.effective[field] : null;
        input = el('input', { id: `rule-${field}`, type: kind, value: own === null ? '' : String(own), placeholder: fallback === null || fallback === undefined ? '' : T("{0} (guild default)", fallback) });
        if (kind === 'number') { input.min = field === 'reservesPerPlayer' ? '1' : '0'; if (['decayPercent', 'offspecPercent'].includes(field)) input.max = '100'; if (field === 'reservesPerPlayer') input.max = '5'; }
        else input.maxLength = field === 'description' ? 300 : 60;
      }
      input.disabled = !leader();
      return el('label', {}, T(label), input);
    }));
  }

  function characterOptions(memberId, selected, none) {
    const member = view.members.find(row => row.id === memberId);
    const names = member ? member.characters.map(row => row.name) : [];
    if (selected && !names.includes(selected)) names.unshift(selected);
    return [...(none ? [['', none]] : []), ...names.map(name => [name, member?.characters.find(row => row.name === name)?.displayName || name])];
  }

  function renderRoster(current) {
    const order = { TANK: 0, HEALER: 1, DPS: 2 };
    const spots = current.members.slice().sort((a, b) => Number(a.bench) - Number(b.bench) || order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    const mains = spots.filter(spot => !spot.bench && !spot.trial).length;
    $('rosterCount').textContent = T("{0} member{1}", mains, mains === 1 ? '' : 's');
    $('rosterAdd').hidden = !leader();
    $('rosterList').replaceChildren(...(spots.length ? spots.flatMap(spot => {
      const tags = `${spot.trial ? T("  trial") : ''}${spot.bench ? T("  bench") : ''}`;
      const name = el('span', { class: 'grow', text: spot.name }, tags ? el('span', { class: 'tag', text: tags }) : null);
      if (!leader()) {
        return [el('div', { class: 'edit-row' }, name, el('span', { text: `${T(ROLE_LABEL[spot.role])}${spot.character ? ` · ${spot.characterDisplayName || spot.character}` : ''}` })),
          ...spot.backups.map(backup => el('div', { class: 'edit-row sub-row' }, el('span', { text: T("Backup: {0} ({1})", backup.displayName || backup.character, T(ROLE_LABEL[backup.role])) })))];
      }
      const base = { coreId: current.id, memberId: spot.memberId };
      const character = el('select', { 'aria-label': T("Character of {0}", spot.name) });
      options(character, characterOptions(spot.memberId, spot.character, T("No character")), spot.character ?? '');
      const role = el('select', { class: 'narrow', 'aria-label': T("Role of {0}", spot.name) });
      options(role, ROLES.map(([v,label]) => [v,T(label)]), spot.role);
      const bench = el('input', { type: 'checkbox', checked: spot.bench });
      const save = el('button', { type: 'button', text: T("Save") });
      // Saving a trial member makes them a full member, as /core add does.
      save.addEventListener('click', () => change(save, { ...base, action: 'core.member.set', role: role.value, bench: bench.checked, character: character.value || null }));
      const remove = el('button', { class: 'quiet', type: 'button', text: T("Remove") });
      remove.addEventListener('click', () => change(remove, { ...base, action: 'core.member.remove' }));
      const backupCharacter = el('select', { 'aria-label': T("Backup character of {0}", spot.name) });
      const taken = [spot.character, ...spot.backups.map(backup => backup.character)];
      options(backupCharacter, [['', T("Add a backup character…")], ...characterOptions(spot.memberId).filter(([value]) => !taken.includes(value))], '');
      const backupRole = el('select', { class: 'narrow', 'aria-label': T("Backup role") });
      options(backupRole, ROLES.map(([v,label]) => [v,T(label)]), 'DPS');
      const addBackup = el('button', { class: 'quiet', type: 'button', text: T("Add backup") });
      addBackup.addEventListener('click', () => { if (backupCharacter.value) change(addBackup, { ...base, action: 'core.backup.set', character: backupCharacter.value, role: backupRole.value }); });
      return [
        el('div', { class: 'edit-row' }, name, character, role, el('label', { class: 'check' }, bench, T("Bench")), save, remove),
        ...spot.backups.map(backup => {
          const drop = el('button', { class: 'quiet', type: 'button', text: T("Remove backup") });
          drop.addEventListener('click', () => change(drop, { ...base, action: 'core.backup.remove', character: backup.character }));
          return el('div', { class: 'edit-row sub-row' }, el('span', { class: 'grow', text: T("Backup: {0} ({1})", backup.displayName || backup.character, T(ROLE_LABEL[backup.role])) }), drop);
        }),
        ...(backupCharacter.options.length > 1 ? [el('div', { class: 'edit-row sub-row' }, backupCharacter, backupRole, addBackup)] : [])
      ];
    }) : [el('p', { class: 'micro', text: T("{0} has no players yet.", current.name) })]));
    if (!leader()) return;
    const inCore = new Set(current.members.map(spot => spot.memberId));
    const previous = $('rosterMember').value;
    options($('rosterMember'), [['', T("Choose a player…")], ...view.members.filter(row => !inCore.has(row.id)).map(row => [row.id, row.displayName])], inCore.has(previous) ? '' : previous);
    options($('rosterCharacter'), characterOptions($('rosterMember').value, null, T("No character")), '');
  }

  $('wishCharacter').addEventListener('change', renderWishlist);
  $('coreSelect').addEventListener('change', () => { coreChoice = $('coreSelect').value; say('', true); renderCores(); });
  $('rosterMember').addEventListener('change', () => options($('rosterCharacter'), characterOptions($('rosterMember').value, null, T("No character")), ''));
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
    if (!Object.keys(changes).length) { say(T("Nothing changed."), true); return; }
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
  document.addEventListener('companion-language', () => {
    if (!view) return;
    // Relabel the same view without throwing away unsaved prices, rules or roster edits.
    const controls = () => [...document.querySelectorAll('#wishPanel input, #wishPanel select, #wishPanel textarea, #corePanels input, #corePanels select, #corePanels textarea')];
    const drafts = controls().map(node => ({ value: node.value, checked: node.checked }));
    renderWishlist(); renderCores();
    controls().forEach((node, index) => {
      const draft = drafts[index];
      if (!draft) return;
      node.value = draft.value;
      if (node.type === 'checkbox') node.checked = draft.checked;
    });
  });
  if (['wishlist', 'cores'].includes(new URLSearchParams(location.search).get('tab'))) load();
})();
