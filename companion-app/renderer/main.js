// The single companion window (redo C2). A thin view over the same engine and IPC as the old window:
// the model is companion/main-status.mjs (window.guildedMainStatus); every button calls an existing
// IPC channel. Nothing here changes what syncs.
const languageUI = window.companionLanguage;
const T = (key, ...values) => languageUI.t(key, ...values);
const M = (value) => languageUI.message(value);
const $ = (id) => document.getElementById(id);
const api = window.companion;

let snapshot = { config: {}, state: {}, problems: [], savedFile: null, addonAction: null, update: null, otherAccount: null };
let me = null, storePackage = false, version = '', logs = [];
let signIn = null;

function ago(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return T('Not yet');
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return T('Just now');
  if (seconds < 3600) return T('{0} min ago', Math.floor(seconds / 60));
  if (seconds < 86400) return T('{0} hr ago', Math.floor(seconds / 3600));
  return T('{0} days ago', Math.floor(seconds / 86400));
}
// Model text is an English key plus values; a value { ago } is a time worded here.
const words = (entry) => {
  if (!entry) return '';
  const [key, ...values] = entry;
  if (key && typeof key === 'object' && key.ago) return ago(key.ago);
  return T(key, ...values);
};
const say = (message, ok = true) => { const notice = $('notice'); notice.textContent = message ? M(message) : ''; notice.hidden = !message; notice.dataset.ok = ok ? 'true' : 'false'; };

function render() {
  const status = window.guildedMainStatus({
    config: snapshot.config, state: snapshot.state || {}, problems: snapshot.problems || [], savedFile: snapshot.savedFile,
    addonAction: snapshot.addonAction, wowRunning: snapshot.addonAction?.blocked === 'wow-running', update: snapshot.update, otherAccount: snapshot.otherAccount, me
  });
  for (const entry of status.lines) {
    const row = $('line-' + entry.id);
    row.dataset.tone = entry.tone;
    row.querySelector('.text').textContent = words(entry.text);
    row.querySelector('.detail').textContent = words(entry.detail);
    const button = row.querySelector('button');
    button.hidden = !entry.button;
    if (entry.button) { button.textContent = T(entry.button.label); button.onclick = () => run(entry.button.action); }
  }
  const needs = status.needsYou;
  $('needs').hidden = !needs;
  if (needs) {
    $('needs').dataset.tone = needs.tone;
    $('needsText').textContent = words(needs.text);
    $('needsDetail').textContent = words(needs.detail);
    $('needsButtons').replaceChildren(...needs.buttons.map((button) => { const el = document.createElement('button'); el.type = 'button'; el.className = 'small'; el.textContent = T(button.label); el.onclick = () => run(button.action); return el; }));
  }
  $('btnSync').disabled = !status.syncNow.enabled;
  $('btnSync').textContent = status.syncNow.busy ? T('Sending your data…') : T('Sync now');
  $('version').textContent = version ? T('Version {0}', version) : '';
  renderAdvanced();
}

function renderAdvanced() {
  const config = snapshot.config || {};
  $('advFolder').textContent = config.watchFile || T('Not found yet');
  const name = me?.account?.displayName || me?.account?.username;
  $('advDiscord').textContent = config.companionCredential ? (name ? T('{0} (Discord)', name) : T('Signed in with Discord')) : T('This PC, not signed in');
  $('btnSwitch').hidden = !config.companionCredential;
  $('btnSignIn').hidden = Boolean(config.companionCredential);
  const servers = Array.isArray(snapshot.state?.device?.servers) ? snapshot.state.device.servers : [];
  const wanted = ['', ...servers.map((server) => server.discordId)].join('|');
  $('serverRow').hidden = !servers.length;
  if ($('serverList').dataset.servers !== wanted) {
    $('serverList').dataset.servers = wanted;
    $('serverList').replaceChildren(new Option(T('Automatic (from your guild)'), ''), ...servers.map((server) => new Option(server.name || server.discordId, server.discordId)));
  }
  $('storeUpdate').hidden = !storePackage;
  $('btnStore').hidden = !storePackage;
  $('autoUpdateRow').hidden = storePackage;
  const problems = snapshot.problems || [];
  $('noProblems').hidden = problems.length > 0;
  $('problemList').replaceChildren(...problems.map((problem) => { const item = document.createElement('li'); item.textContent = T(PROBLEM_TEXT[problem.id] || problem.id); return item; }));
  $('activity').replaceChildren(...logs.slice(-30).reverse().map((entry) => { const item = document.createElement('li'); item.textContent = `${new Date(entry.time).toLocaleTimeString(languageUI.language)} ${M(entry.message)}`; return item; }));
}
const PROBLEM_TEXT = {
  'settings-not-saved': 'Your settings could not be saved.', 'disk-space-low': 'Not enough disk space.', 'sign-in-expired': 'Your Discord sign-in expired.',
  'bot-unreachable': "Guilded's server is not answering.", 'addon-missing': 'The Guilded addon is not installed.', 'addon-wrong-edition': 'The wrong version of the addon is installed.',
  'addon-outdated': 'Your Guilded addon is older than this companion.', 'saved-file-missing': 'Waiting for WoW to save your addon data.', 'saved-file-not-updated': 'Waiting for WoW to save your addon data.',
  'upload-rejected': 'Guilded refused your last sync.', 'wow-running-update': 'Restart WoW to use the updated addon.', 'companion-outdated': 'A new version of the companion is out.'
};

// ---- actions: each one is an existing IPC call ----
async function run(action) {
  say('');
  try {
    switch (action) {
      case 'sign-in': return await runSignIn(false);
      case 'sign-in-switch': return await runSignIn(true);
      case 'pick-wow-folder': { const result = await api.pickWowFolder(); if (result?.message) say(result.message, result.ok !== false); return; }
      case 'install-addon': { const answer = await api.installAddon(); say(answer.message, answer.ok); return; }
      case 'retry': await api.recoverSync(); await api.uploadNow(); say(T('Trying again.')); return;
      case 'sync-now': await api.uploadNow(); say(T('Syncing now.')); return;
      case 'toggle-tracking': await api.toggleTracking(); return;
      case 'problems': case 'choose-server': showAdvanced(true); return;
      case 'storage': await api.openStorageSettings(); return;
      case 'switch-folder': { const answer = await api.switchLiveFolder(); if (answer?.path) say(T('Switched. Now watching {0}', answer.path)); return; }
      case 'account-yes': case 'account-no': {
        const answer = action === 'account-yes' ? await api.accountYes() : await api.accountNo();
        if (answer?.account) say(action === 'account-yes' ? T('{0} syncs too from now on.', answer.account) : T('{0} will not sync. You will not be asked again.', answer.account), answer.ok !== false);
        return;
      }
      case 'copy-officer-message': {
        const guild = snapshot.state?.device?.guild?.name || snapshot.config.wowGuildName || snapshot.config.wowGuild || '';
        const text = "Hello! Could you run /setup in our guild's Discord server so the Guilded companion can sync our guild " + guild + '? Thank you!\nBonjour ! Pourriez-vous lancer /setup sur le serveur Discord de notre guilde pour que le compagnon Guilded puisse synchroniser notre guilde ' + guild + ' ? Merci !';
        try { await navigator.clipboard.writeText(text); say(T('Copied. Paste it to an officer of your guild.')); } catch { say(T('Could not copy. Ask an officer of your guild to run /setup on its Discord server.'), false); }
        return;
      }
      case 'open-store': await api.openUpdate(); return;
      case 'install-update': { const answer = await api.installUpdate(); say(answer?.message, answer?.ok !== false); return; }
      default: return;
    }
  } catch (error) { say(error?.message || T('This action could not be completed.'), false); }
}

async function runSignIn(switchAccount) {
  say(T('Opening Discord sign-in…'));
  const started = switchAccount ? await api.signInSwitch() : await api.signInStart({});
  if (!started.ok) { say(started.message || T('The sign-in could not start. Check your internet connection, then try again.'), false); return; }
  $('signInWait').hidden = false;
  $('signInLine').textContent = started.automatic ? T('Your browser opened. Choose your server there and press Connect.') : T('Your browser opened. Type {0} on the sign-in page.', started.confirm);
  signIn = started;
  let result;
  try { result = await api.signInWait(); } catch (error) { result = { ok: false, message: error?.message }; }
  $('signInWait').hidden = true;
  signIn = null;
  const outcome = window.guildedSignIn.signInOutcome(result);
  say(outcome.message, outcome.ok);
  if (result?.ok) { await reload(); await loadMe(); }
}
api.onSignInRestarted?.((started) => { if (signIn) { signIn = started; $('signInLine').textContent = T('That sign-in expired, so a new one opened in your browser (it may be behind this window).'); } });
$('btnSignInCancel').onclick = async () => { await api.signInCancel(); $('signInWait').hidden = true; signIn = null; say(T('Sign-in cancelled.'), false); };

async function loadMe() {
  me = null;
  if (!snapshot.config.companionCredential) { render(); return; }
  try { const answer = await api.companionMe(); me = answer?.ok ? answer : null; } catch { me = null; }
  render();
}
async function reload() {
  const all = await api.getAll();
  snapshot = { ...snapshot, otherAccount: all.otherAccount ?? null, config: all.config, state: all.state, problems: all.problems, savedFile: all.savedFile, addonAction: all.addonAction, update: all.update };
  storePackage = all.storePackage === true; version = all.version || '';
  logs = all.logs || logs;
  $('autostart').checked = all.autostart === true;
  $('autoUpdate').checked = all.config.autoUpdate !== false;
  render();
}

// ---- Advanced view ----
function showAdvanced(on) {
  $('home').hidden = on; $('advanced').hidden = !on;
  document.title = on ? T('Advanced') + ' · ' + T('Guilded Companion') : T('Guilded Companion');
  if (on) $('btnBack').focus(); else $('btnAdvanced').focus();
}
$('btnAdvanced').onclick = () => showAdvanced(true);
$('btnBack').onclick = () => showAdvanced(false);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('advanced').hidden) showAdvanced(false); });
$('btnSync').onclick = () => run('sync-now');
$('btnFolder').onclick = () => run('pick-wow-folder');
$('btnFind').onclick = async () => { const answer = await api.repair(); $('repairResult').textContent = answer?.summary ? T('Repair: {0} fixed, {1} need you, {2} failed.', answer.summary.fixed, answer.summary.needsYou, answer.summary.failed) : ''; await reload(); };
$('btnRepair').onclick = $('btnFind').onclick;
$('btnSignIn').onclick = () => run('sign-in');
$('btnSwitch').onclick = () => run('sign-in-switch');
$('btnServer').onclick = async () => { const answer = await api.deviceChooseServer($('serverList').value); say(answer?.message, answer?.ok !== false); };
$('linkConnections').onclick = (event) => { event.preventDefault(); void api.openConnections(); };
$('autostart').onchange = async (event) => { event.target.checked = await api.setAutostart(event.target.checked); };
$('autoUpdate').onchange = async (event) => { event.target.checked = await api.setAutoUpdate(event.target.checked); };
$('btnStore').onclick = () => api.openStoreListing();
$('btnReport').onclick = async () => { const report = await api.copyProblemReport(); $('reportNote').textContent = T('Support summary {0} is copied. Paste it in Discord with /report bug, or send it to an officer. It holds no file paths, names or passwords.', report.reference); };
$('btnReset').onclick = () => api.removeData();
$('btnExport').onclick = async () => { $('exportResult').textContent = ''; const result = await api.exportSheets(undefined); if (!result.canceled) $('exportResult').textContent = M(result.message); };
$('btnGRM').onclick = async () => { const result = await api.convertGRM({ guild: $('grmGuild').value, realm: $('grmRealm').value, edition: 'forever', includePrivate: $('grmPrivate').checked }); if (!result.canceled) $('grmResult').textContent = M(result.message); };
$('btnOld').onclick = () => api.openOldWindow();
for (const id of ['language', 'advLanguage']) $(id).addEventListener('change', async (event) => { languageUI.set(event.target.value); await api.setLanguage?.(event.target.value); $('language').value = $('advLanguage').value = languageUI.language; render(); });
document.addEventListener('companion-language', () => { $('language').value = $('advLanguage').value = languageUI.language; });
window.addEventListener('online', () => { void api.recoverSync?.().catch(() => {}); });

api.onState((next) => { snapshot = { ...snapshot, state: next.state, problems: next.problems, savedFile: next.savedFile, addonAction: next.addonAction, update: next.update, otherAccount: next.otherAccount }; render(); });
api.onUpdateProgress?.((percent) => say(T('Downloading and checking the update: {0}%', percent)));
api.onLog((entry) => { logs = [...logs, entry].slice(-100); renderAdvanced(); });
$('language').value = $('advLanguage').value = languageUI.language;
reload().then(loadMe).catch((error) => say(error?.message || T('This action could not be completed.'), false));
// "Just now / 3 min ago" stays true while the window is open.
setInterval(render, 60_000);
