(() => {
  const api = window.companion;
  if (!api?.hubView || !window.guildedLinkSteps) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  let config = {}, state = {}, hub = null, loading = false;

  const result = () => window.guildedLinkSteps(config, state, hub);
  function say(message, ok) { $('linkResult').textContent = message; $('linkResult').className = `result ${ok ? 'ok' : 'bad'}`; }

  function render() {
    const view = result();
    const list = $('linkList'); list.replaceChildren();
    for (const step of view.steps) {
      const row = document.createElement('li'); row.className = 'edit-row';
      const title = document.createElement('strong');
      title.textContent = (step.state === 'done' ? '✓ ' : step.state === 'todo' ? '✗ ' : '– ') + T(step.label, ...(step.args || []));
      if (step.state === 'done') row.classList.add('linked');
      row.append(title);
      if (step.next) { const next = document.createElement('span'); next.textContent = T(step.next); row.append(next); }
      list.append(row);
    }
    $('linkAllDone').hidden = !view.complete;
    const rows = window.guildedCharacterRows(hub), body = $('linkChars').querySelector('tbody');
    body.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.name, row.realm, row.wowGuild + (row.rank ? ` · ${row.rank}` : ''), row.server || '–', row.linked ? '✓ ' + T('Linked') : T('Not linked yet')]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      body.append(tr);
    }
    $('linkCharCount').textContent = rows.length ? T('{0} character(s) linked', rows.length) : '';
    $('linkChars').hidden = !rows.length; $('linkCharsEmpty').hidden = rows.length > 0 || !config.companionCredential || config.personal === true;
    const summary = $('linkSummary');
    summary.textContent = T('Links') + ': ' + window.guildedLinkSummary(view).replace('Characters', T('Characters'));
    summary.hidden = false;
    const signedIn = Boolean(config.companionCredential);
    // Leaderboards only (often: not in a server that uses Guilded yet): sign in again to reach the guild.
    const personal = signedIn && config.personal === true;
    $('btnLinkSignIn').hidden = signedIn && !personal;
    $('btnLinkSignIn').textContent = personal ? T('Link to my guild') : T('Sign in with Discord');
    $('btnLinkFind').hidden = !signedIn;
    $('btnLinkCheck').hidden = !signedIn;
    $('btnLinkBattleNet').disabled = !signedIn;
    $('linkCharsPanel').hidden = !signedIn; $('linkActionsPanel').hidden = !signedIn;
    $('btnLinkSync').hidden = !signedIn; $('btnLinkUnlink').hidden = !signedIn;
    $('btnLinkDiscord').hidden = !signedIn || !config.guildDiscordId;
    $('btnLinkSkip').hidden = signedIn;
  }

  async function load() {
    if (loading) return; loading = true;
    try {
      const all = await api.getAll(); config = all.config; state = all.state || {};
      hub = null;
      if (config.companionCredential && !config.personal) {
        const answer = await api.hubView(window.companionLanguage.language).catch(() => null);
        if (answer?.ok) hub = answer.data;
      }
    } finally { loading = false; render(); }
  }

  const guarded = (button, task) => button.addEventListener('click', async event => {
    const target = event.currentTarget;
    target.disabled = true;
    try { await task(); } catch (error) { say(error?.message || T('Something went wrong. Check your internet connection, then press the button again.'), false); } finally { target.disabled = false; render(); }
  });
  guarded($('btnLinkFind'), async () => {
    const found = await api.linkFindSavedData();
    if (!found.ok) { say(found.message || T('This action could not be completed.'), false); return; }
    if (found.already) { say(T('Already linked, nothing to do.'), true); return; }
    say(found.pending ? T('Found your WoW account. Log in to WoW and type /reload once; your characters link by themselves.') : T('Found your addon data.') + ' ' + T('In WoW, type /reload so it is saved; the companion then proves your characters.'), true);
    await load();
  });
  guarded($('btnLinkCheck'), async () => {
    await api.uploadNow();
    say(T('Sync requested. Follow its progress in Activity.'), true);
    setTimeout(() => void load(), 8000);
  });
  guarded($('btnLinkBattleNet'), async () => {
    if (window.guildedLinkSteps(config, state, hub).steps.find(step => step.id === 'battlenet')?.state === 'done') { say(T('Already linked, nothing to do.'), true); return; } await api.openBattleNet(); say(T('Finish in your browser, then come back and press Check my characters.'), true); });
  guarded($('btnLinkSync'), async () => { await api.uploadNow(); say(T('Sync requested. Follow its progress in Activity.'), true); setTimeout(() => void load(), 8000); });
  guarded($('btnLinkUnlink'), async () => { await api.removeData(); });
  guarded($('btnLinkDiscord'), async () => { if (!(await api.openDiscordServer())) say(T('Your Discord server is not known yet. Press Sign in with Discord.'), false); });
  guarded($('btnLinkDevices'), async () => { await api.openConnections(); });
  $('btnLinkSkip').addEventListener('click', () => {
    try { localStorage.setItem('guilded.companion.linkSkipped', '1'); } catch { /* the page simply shows again */ }
    document.querySelector('.nav[data-page="status"]')?.click();
  });
  // After a sign-in, find the saved data on its own when only one account has it, then re-read the links.
  document.addEventListener('companion-signed-in', async () => {
    await load();
    if (!config.personal) {
      const found = await api.linkFindSavedData().catch(() => null);
      if (found?.ok) say(T('Signed in. Your saved data was found; the companion is checking your characters.'), true);
    }
    await load(); setTimeout(() => void load(), 10000);
  });
  document.querySelectorAll('[data-page="link"],[data-page="status"]').forEach(button => button.addEventListener('click', () => void load()));
  // No saved-data file yet (addon just installed, game closed, or Guilded.lua not saved once): look again
  // by itself every 20 seconds while this window is open, so nobody has to press Find my saved data.
  // Stops by itself once a file is watched. Local read only; signed-in, guild (not leaderboards-only) mode.
  setInterval(async () => {
    if (loading || document.hidden || !config.companionCredential || config.personal || state.watching || config.watchFile) return;
    const found = await api.linkFindSavedData().catch(() => null);
    if (found?.ok) { say(found.pending ? T('Found your WoW account. Log in to WoW and type /reload once; your characters link by themselves.') : T('Found your addon data.'), true); await load(); }
  }, 20000);
  document.addEventListener('companion-language', render);
  document.addEventListener('companion-connection-changed', () => void load());
  api.onState?.(snapshot => { state = snapshot.state || state; render(); });
  void load();
})();
