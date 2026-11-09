// Problems panel (8.5, track F1). The desktop app decides which problems exist
// (companion/problems.mjs, sent with every state update); this page words each one with
// How to fix steps, a Fix it button where the companion can do it, and Copy report for the developer.
(() => {
  const api = window.companion;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  let problems = [];
  let shownKey = '';

  const edition = id => id ? window.guildedProfileEditionLabel(id, window.companionLanguage.language) : T('WoW Forever');
  const go = page => window.showPage(page);
  // Install addon / Update addon: the companion downloads the matching Forever build, checks it
  // and puts it in this game folder's AddOns (companion-app/addon-installer.cjs).
  const installAddon = async () => {
    const result = await api.installAddon();
    if (!result.ok) throw new Error(window.companionLanguage.message(result.message));
    return result.message;
  };
  const downloadYourself = { label: T('Download it myself'), run: async () => { await api.openAddonDownload(); } };
  const note = (message, ok = true) => { const target = $('reportNote'); $('reportPanel').hidden = false; target.textContent = message; target.className = ok ? 'micro' : 'result bad'; };

  // id → wording and the fix. Every string is a T() literal so the French check covers it.
  function describe(problem) {
    const d = problem.data || {};
    switch (problem.id) {
      case 'settings-not-saved': return {
        title: T('Settings could not be saved.'),
        detail: d.stuck ? T('Windows protected storage is not answering. What you change now is kept only until the companion closes.') : T('Windows refused to save the settings. What you change now is kept only until the companion closes.'),
        steps: [T('Keep the companion open: it keeps syncing with what it has in memory.'), T('Restart Windows, then open the companion and check your Discord link and WoW folder.'), T('Still showing? Copy the report and send it to the developer, with startup.log from the Guilded Companion folder in %APPDATA%.')],
        fix: null
      };
      case 'disk-space-low': return {
        title: T('Not enough disk space: {0} MB free, about {1} MB needed. Free space with Windows Settings > Storage, then retry.', d.freeMb, d.neededMb),
        steps: [T('Choose Open Storage settings and remove temporary files or apps you no longer use.'), T('Then choose Check again. Updates and the addon install wait until there is room, so nothing stops halfway.')],
        fix: { label: T('Open Storage settings'), run: async () => { await api.openStorageSettings(); return null; } },
        alt: { label: T('Check again'), run: async () => { const result = await api.checkDiskSpace(); if (!result.ok) throw new Error(result.message); return result.message; } }
      };
      case 'sign-in-expired': return {
        title: T('Your Discord sign-in has expired or was removed.'),
        steps: [T('Choose Sign in with Discord.'), T('Approve in your browser, then come back here.'), T('Your settings and addon data stay as they are.')],
        fix: { label: T('Sign in with Discord'), run: async () => { go('settings'); $('btnSignIn').click(); } }
      };
      case 'bot-unreachable': return {
        title: d.offline ? T('This PC is offline.') : T('The companion cannot reach the Guilded bot.'),
        steps: [T('Check that this PC is connected to the internet.'), T('If the internet works, the bot may be restarting: the companion tries again by itself.'), T('Still failing after an hour? Copy the report and send it to the developer.')],
        fix: { label: T('Try again'), run: async () => { await api.recoverSync(); await api.uploadNow(); return T('Trying again. Follow the result in Activity.'); } }
      };
      case 'addon-missing': return {
        title: T('The Guilded addon is not installed in this WoW folder.'),
        steps: d.expected === 'forever'
          ? [T('Close World of Warcraft.'), T('Choose Install addon: the companion puts Guilded in Interface > AddOns of this game folder.'), T('Start WoW, tick Guilded in the AddOns list at the character screen, log in and type /reload.')]
          : [T('Close World of Warcraft.'), T('Download Guilded for {0} and put it in Interface > AddOns of this game folder.', edition(d.expected)), T('Start WoW, tick Guilded in the AddOns list at the character screen, log in and type /reload.')],
        fix: d.expected === 'forever' ? { label: T('Install addon'), run: installAddon } : { label: T('Get the addon'), run: async () => { await api.openAddonDownload(); } },
        alt: d.expected === 'forever' ? downloadYourself : null
      };
      case 'addon-wrong-edition': return {
        title: T('The Guilded addon in this folder is for {0}, but this folder needs the {1} build.', d.installed || T('another WoW version'), edition(d.expected)),
        steps: d.expected === 'forever'
          ? [T('Close World of Warcraft.'), T('Choose Update addon: the companion moves the old Guilded folder to Interface > Guilded backups and installs the {0} build.', edition(d.expected)), T('Start WoW and type /reload.')]
          : [T('Close World of Warcraft.'), T('Delete the Guilded folder in Interface > AddOns, then install the {0} build.', edition(d.expected)), T('Start WoW and type /reload.')],
        fix: d.expected === 'forever' ? { label: T('Update addon'), run: installAddon } : { label: T('Get the addon'), run: async () => { await api.openAddonDownload(); } },
        alt: d.expected === 'forever' ? downloadYourself : null
      };
      case 'addon-outdated': return {
        title: T('Your Guilded addon is version {0}; this companion matches version {1}.', d.installed, d.current),
        steps: [T('Close World of Warcraft.'), T('Choose Update addon: the companion moves the old Guilded folder to Interface > Guilded backups and installs the {0} build.', edition('forever')), T('Start WoW and type /reload.')],
        fix: { label: T('Update addon'), run: installAddon },
        alt: downloadYourself
      };
      case 'saved-file-missing': return d.chosen === false ? {
        title: T('Your WoW folder is not chosen yet.'),
        steps: [T('Choose WoW folder and pick your World of Warcraft folder: the companion finds your account.'), T('Then choose Save & start syncing.')],
        fix: { label: T('Choose WoW folder'), run: async () => { go('settings'); $('btnPickFolder').click(); } }
      } : {
        title: d.othersSaved ? T('WoW saved your other addons, but not Guilded.') : T('Guilded has not saved its data yet.'),
        steps: [T('At the WoW character screen, open AddOns and tick Guilded.'), T('Log in and type /reload (or log out once).'), T('Still nothing? Choose WoW folder and pick the folder you play from.')],
        fix: { label: T('Find my addon data'), run: async () => { const found = await api.linkFindSavedData(); return found.ok ? T('Found your addon data.') : found.message; } }
      };
      case 'saved-file-not-updated': return d.moved ? {
        title: T('Your addon data seems to be in another WoW folder now.'),
        steps: [T('Choose Switch folders: the companion watches the newer file.'), T('Nothing is deleted; you can switch back in Connection & setup.')],
        fix: { label: T('Switch folders'), run: async () => { const result = await api.switchLiveFolder(); return result.path ? T('Switched. Now watching {0}', result.path) : null; } }
      } : {
        title: T("Your last /reload did not save the Guilded addon's data."),
        steps: [T('WoW saved your other addons but not Guilded: it may be turned off or out of date.'), T('At the character screen, open AddOns, tick Guilded and tick Load out of date AddOns.'), T('Log in, type /reload and wait a few seconds. A Lua error from Guilded? Copy the report for the developer.')],
        fix: null
      };
      case 'upload-rejected': return {
        title: d.applyError ? T('Your sync was received but could not be applied.') : T('Guilded refused your last sync.'),
        detail: d.reason ? T('The bot said: {0}', window.companionLanguage.message(d.reason)) : null,
        steps: [T('Read the reason above.'), T('If it mentions permissions, a character or your guild, ask an officer.'), T('Otherwise copy the report and send it to the developer.')],
        fix: d.applyError ? null : { label: T('Try again'), run: async () => { await api.uploadNow(); return T('Trying again. Follow the result in Activity.'); } }
      };
      case 'wow-running-update': return {
        title: T('WoW is still running the old Guilded addon ({0}); version {1} is installed.', d.running || T('older version'), d.installed),
        steps: [T('Exit World of Warcraft completely: a /reload does not load new addon files.'), T('Start WoW again. The new Guilded loads by itself.')],
        fix: null
      };
      case 'companion-outdated': return {
        title: T('Guilded Companion {0} is available; you have {1}.', d.latest, d.current),
        steps: d.store ? [T('Open Microsoft Store, then Downloads and updates, and choose Get updates.'), T('Your settings and Discord link are kept.')] : [T('Choose Update now.'), T('The companion restarts by itself. Your settings and Discord link are kept.')],
        fix: { label: d.store ? T('Open Store updates') : T('Update now'), run: async () => { if (d.store || !api.installUpdate) { await api.openUpdate(); return null; } const result = await api.installUpdate(); return result.message; } }
      };
      default: return null;
    }
  }

  async function copyReport(button) {
    button.disabled = true;
    try {
      const report = await api.copyProblemReport();
      $('reportText').textContent = report.text;
      note(T('Report {0} is copied. Paste it in Discord with /report bug, or send it to your officer. It holds no file paths, names or passwords.', report.reference));
      $('reportPanel').scrollIntoView({ block: 'nearest' });
    } catch (error) { note(error?.message || T('The report could not be copied.'), false); }
    finally { button.disabled = false; }
  }

  function render() {
    const count = problems.length;
    $('btnProblems').hidden = count === 0;
    $('problemCount').textContent = String(count);
    $('btnProblems').title = T('{0} problem(s): open to see how to fix', count);
    $('btnProblems').setAttribute('aria-label', T('{0} problem(s): open to see how to fix', count));
    $('problemsNone').hidden = count > 0;
    const key = JSON.stringify(problems) + window.companionLanguage.language;
    if (key === shownKey) return; // the state arrives every few seconds: rebuild only on change
    shownKey = key;
    const host = $('problemList'); host.replaceChildren();
    for (const problem of problems) {
      const text = describe(problem);
      if (!text) continue;
      const card = document.createElement('article'); card.className = 'panel problem-card'; card.dataset.problem = problem.id;
      const title = document.createElement('h2'); title.textContent = text.title;
      card.append(title);
      if (text.detail) { const detail = document.createElement('p'); detail.className = 'problem-detail'; detail.textContent = text.detail; card.append(detail); }
      const how = document.createElement('h3'); how.textContent = T('How to fix');
      const steps = document.createElement('ol'); steps.className = 'help-list';
      for (const step of text.steps) { const item = document.createElement('li'); item.textContent = step; steps.append(item); }
      const actions = document.createElement('div'); actions.className = 'actions';
      const result = document.createElement('p'); result.className = 'result'; result.setAttribute('role', 'status');
      if (text.fix) {
        const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'primary'; fix.textContent = text.fix.label;
        fix.addEventListener('click', async () => {
          fix.disabled = true;
          try { const message = await text.fix.run(); if (message) { result.textContent = window.companionLanguage.message(message); result.className = 'result ok'; } }
          catch (error) { result.textContent = error?.message || T('This action could not be completed.'); result.className = 'result bad'; }
          finally { fix.disabled = false; }
        });
        actions.append(fix);
      }
      if (text.alt) {
        const alt = document.createElement('button'); alt.type = 'button'; alt.textContent = text.alt.label;
        alt.addEventListener('click', async () => {
          try { const message = await text.alt.run(); if (message) { result.textContent = window.companionLanguage.message(message); result.className = 'result ok'; } }
          catch (error) { result.textContent = error?.message || T('This action could not be completed.'); result.className = 'result bad'; }
        });
        actions.append(alt);
      }
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = T('Copy report for the developer');
      copy.addEventListener('click', () => copyReport(copy));
      actions.append(copy);
      card.append(how, steps, actions, result);
      host.append(card);
    }
  }

  // The Overview banner offers the same install while the addon is missing or older.
  const wowRunningNow = () => (problems || []).some(problem => problem.id === 'wow-running-update');
  let addonOffer = null, installing = false;
  function renderAddonOffer() {
    // (9.0) Installed and matching: still one visible button, to reinstall it.
    const current = addonOffer && addonOffer.action === 'none' && addonOffer.reason === 'up-to-date';
    const offer = addonOffer && (addonOffer.action !== 'none' || current) ? addonOffer : null;
    $('addonBanner').hidden = !offer;
    if (!offer) return;
    $('addonBanner').classList.toggle('quiet-banner', !!current);
    if (current) {
      $('addonTitle').textContent = T('Guilded addon {0} is installed', offer.installed || '?');
      $('addonText').textContent = T('It matches this companion. Reinstall it if WoW lists it as missing or out of date; your current folder is kept as a backup.');
      $('btnInstallAddon').textContent = T('Reinstall addon');
      $('btnInstallAddon').disabled = installing || wowRunningNow();
      return;
    }
    const update = offer.action === 'update';
    $('addonTitle').textContent = update ? T('A newer Guilded addon is ready') : T('The Guilded addon is not installed yet');
    $('addonText').textContent = offer.blocked === 'wow-running'
      ? T('Exit World of Warcraft first: WoW is running.')
      : update ? T('The companion can update Guilded in your WoW folder. Your old folder is kept as a backup.') : T('The companion can put Guilded in your WoW folder for you.');
    $('btnInstallAddon').textContent = update ? T('Update addon') : T('Install addon');
    $('btnInstallAddon').disabled = installing || offer.blocked === 'wow-running';
  }
  $('btnInstallAddon').addEventListener('click', async event => {
    const button = event.currentTarget, result = $('addonResult');
    installing = true; button.disabled = true; result.textContent = T('Downloading and checking the addon...'); result.className = 'result';
    try {
      if (addonOffer?.action === 'none') { const answer = await api.reinstallAddon(); if (!answer.ok) throw new Error(window.companionLanguage.message(answer.message)); result.textContent = answer.message; }
      else result.textContent = await installAddon();
      result.className = 'result ok';
    }
    catch (error) { result.textContent = error?.message || T('This action could not be completed.'); result.className = 'result bad'; }
    finally { installing = false; renderAddonOffer(); }
  });
  const take = snapshot => {
    if (snapshot && 'addonAction' in snapshot) { addonOffer = snapshot.addonAction; renderAddonOffer(); }
    if (Array.isArray(snapshot?.problems)) { problems = snapshot.problems; render(); }
  };
  $('btnProblems').addEventListener('click', () => go('problems'));
  $('btnCopyReport').addEventListener('click', event => copyReport(event.currentTarget));
  // No internet is a problem too; the desktop app cannot tell on its own.
  const online = () => { void api.setOnline?.(navigator.onLine).catch(() => {}); };
  window.addEventListener('online', online);
  window.addEventListener('offline', online);
  if (!navigator.onLine) online();
  document.addEventListener('companion-language', () => { shownKey = ''; render(); renderAddonOffer(); });
  api.onState?.(take);
  api.getAll().then(take).catch(() => {});
})();
