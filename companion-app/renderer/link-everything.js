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
      title.textContent = (step.state === 'done' ? '✓ ' : step.state === 'todo' ? '✗ ' : '– ') + T(step.label) + (step.count ? ` (${step.count})` : '');
      row.append(title);
      if (step.next) { const next = document.createElement('span'); next.textContent = T(step.next); row.append(next); }
      list.append(row);
    }
    $('linkAllDone').hidden = !view.complete;
    const summary = $('linkSummary');
    summary.textContent = T('Links') + ': ' + window.guildedLinkSummary(view).replace('Characters', T('Characters'));
    summary.hidden = false;
    const signedIn = Boolean(config.companionCredential);
    $('btnLinkSignIn').hidden = signedIn;
    $('btnLinkFind').hidden = !signedIn || Boolean(config.watchFile);
    $('btnLinkCheck').hidden = !signedIn;
    $('btnLinkBattleNet').disabled = !signedIn;
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
    try { await task(); } catch (error) { say(error.message, false); } finally { target.disabled = false; render(); }
  });
  guarded($('btnLinkFind'), async () => {
    const found = await api.linkFindSavedData();
    if (!found.ok) { say(found.message || T('This action could not be completed.'), false); return; }
    say(T('Found your addon data.') + ' ' + T('In WoW, type /reload so it is saved; the companion then proves your characters.'), true);
    await load();
  });
  guarded($('btnLinkCheck'), async () => {
    await api.uploadNow();
    say(T('Sync requested. Follow its progress in Activity.'), true);
    setTimeout(() => void load(), 8000);
  });
  guarded($('btnLinkBattleNet'), async () => { await api.openBattleNet(); say(T('Finish in your browser, then come back and press Check my characters.'), true); });
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
  document.addEventListener('companion-language', render);
  document.addEventListener('companion-connection-changed', () => void load());
  api.onState?.(snapshot => { state = snapshot.state || state; render(); });
  void load();
})();
