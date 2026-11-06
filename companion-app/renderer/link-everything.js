(() => {
  const api = window.companion;
  if (!api?.hubView || !window.guildedLinkSteps) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  let config = {}, state = {}, hub = null, loading = false;
  // Track L wizard: who is signed in and the guild server to join (companion-me), the problems list,
  // and the watched file's last save.
  let me = null, problems = [], savedFile = null, autoLinked = false, joinPoll = null, detecting = null;
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();

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
    renderWizard();
  }

  // The first-run wizard (companion/link-wizard.mjs): 3 steps, the step's own help, and checks.
  function renderWizard() {
    const wizard = window.guildedLinkWizard.linkWizard({ config, state, hub, me: me?.ok ? me : null, problems, savedFile });
    const list = $('wizardSteps'); list.replaceChildren();
    for (const step of wizard.steps) { const item = document.createElement('li'); item.className = step.state; item.textContent = T(step.label); list.append(item); }
    const who = wizard.identity;
    $('wizardIdentity').hidden = !who;
    if (who) {
      $('wizardName').textContent = who.displayName && who.displayName !== who.username ? `${who.displayName} (@${who.username})` : who.username;
      $('wizardAvatar').hidden = !who.avatarUrl;
      if (who.avatarUrl && $('wizardAvatar').src !== who.avatarUrl) $('wizardAvatar').src = who.avatarUrl;
    }
    const join = wizard.join;
    $('wizardJoin').hidden = !join;
    if (join) {
      $('wizardJoinText').textContent = T(...join.text);
      $('btnJoinServer').hidden = join.kind !== 'invite';
      $('btnJoinServer').textContent = T('Join {0}', join.server || '');
      $('btnJoinServer').dataset.invite = join.inviteUrl || '';
      $('btnJoinContinue').hidden = join.kind === 'invite' || join.kind === 'joined';
      // Joined since: continue by itself, once (the browser opens with the server chosen).
      if (join.kind === 'joined' && !autoLinked) { autoLinked = true; $('btnLinkSignIn').click(); }
      if (join.kind === 'invite') watchJoin(); else stopJoinWatch();
    } else stopJoinWatch();
    $('wizardCharacters').hidden = !wizard.charactersHelp;
    if (wizard.charactersHelp) { $('wizardCharactersText').textContent = T(wizard.charactersHelp.text); $('btnDetectNow').hidden = !wizard.charactersHelp.canDetect; }
    const checks = $('wizardDiagnostics'); checks.replaceChildren();
    for (const item of wizard.diagnostics) {
      const row = document.createElement('li'); row.className = item.ok ? 'ok' : 'bad'; row.textContent = T(item.text);
      if (item.fix) { const fix = document.createElement('span'); fix.className = 'fix'; fix.textContent = T(item.fix); row.append(fix); }
      checks.append(row);
    }
    $('wizardDiagnose').hidden = wizard.diagnostics.length === 0;
    // The success screen, once per server and account on this PC (it mirrors the Discord DM).
    const key = 'guilded.companion.linkCelebrated:' + window.guildedLinkWizard.successKey(config, me?.ok ? me : null);
    let seen = true;
    try { seen = !wizard.success || storage?.getItem(key) === '1'; } catch { seen = true; }
    $('linkSuccess').hidden = seen;
    $('linkWizard').hidden = !seen;
    if (!seen) {
      const names = wizard.success.names.join(', ') + (wizard.success.more ? T(' and {0} more', wizard.success.more) : '');
      $('linkSuccessText').textContent = wizard.success.server ? T("You're linked on {0}: {1}.", wizard.success.server, names) : T("You're linked: {0}.", names);
      $('btnLinkSuccessDone').onclick = () => { try { storage?.setItem(key, '1'); } catch { /* shows again next time */ } $('linkSuccess').hidden = true; $('linkWizard').hidden = false; };
    }
  }

  // Joined the guild's server in Discord? Look every 10 seconds while the page is open.
  function watchJoin() {
    if (joinPoll) return;
    joinPoll = setInterval(async () => {
      if (document.hidden) return;
      const answer = await api.companionMe().catch(() => null);
      if (answer?.ok) { me = answer; renderWizard(); }
    }, 10000);
  }
  function stopJoinWatch() { if (joinPoll) { clearInterval(joinPoll); joinPoll = null; } }

  async function load() {
    if (loading) return; loading = true;
    try {
      const all = await api.getAll(); config = all.config; state = all.state || {};
      problems = Array.isArray(all.problems) ? all.problems : []; savedFile = all.savedFile || null;
      me = config.companionCredential ? await api.companionMe().catch(() => null) : null;
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
  guarded($('btnJoinServer'), async () => {
    if (!(await api.openInvite($('btnJoinServer').dataset.invite))) { say(T('This action could not be completed.'), false); return; }
    say(T('Accept the invite in Discord. The companion continues by itself once you are in.'), true);
    watchJoin();
  });
  guarded($('btnJoinContinue'), async () => { $('btnLinkSignIn').click(); });
  guarded($('btnDiagnoseAgain'), async () => { await load(); });
  guarded($('btnCopySupport'), async () => {
    const report = await api.copyProblemReport();
    $('supportNote').textContent = T('Support summary {0} is copied. Paste it in Discord with /report bug, or send it to an officer. It holds no file paths, names or passwords.', report.reference);
  });
  // Detect now: wait for WoW's next save (the companion sends it by itself), then look again.
  guarded($('btnDetectNow'), async () => {
    if (detecting) return;
    const since = new Date().toISOString();
    $('detectNowStatus').textContent = T('Waiting for WoW to save. In WoW, type /reload.');
    detecting = setInterval(async () => {
      const all = await api.getAll().catch(() => null);
      const saved = all && (window.guildedLinkWizard.savedSince(all.savedFile, since) || (all.state?.lastUpload?.at && all.state.lastUpload.at > since));
      if (saved) {
        clearInterval(detecting); detecting = null;
        $('detectNowStatus').textContent = T('Saved. Checking your characters...');
        setTimeout(() => void load().then(() => { $('detectNowStatus').textContent = hub?.characters?.length ? T('{0} character(s) linked', hub.characters.length) : T('Sent, but no character matched yet. Press Check my characters in a minute; if it stays empty, open Discord, type /character claim and pick yours.'); }), 8000);
      } else if (Date.now() - Date.parse(since) > 5 * 60 * 1000) {
        clearInterval(detecting); detecting = null;
        $('detectNowStatus').textContent = T('No save seen in 5 minutes. In WoW, make sure Guilded is ticked in AddOns, then type /reload and press Detect now again.');
      }
    }, 3000);
  });
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
  api.onState?.(snapshot => { state = snapshot.state || state; if (Array.isArray(snapshot.problems)) problems = snapshot.problems; if (snapshot.savedFile !== undefined) savedFile = snapshot.savedFile; render(); });
  void load();
})();
