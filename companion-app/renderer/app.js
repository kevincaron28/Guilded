const languageUI = window.companionLanguage;
const T = (key, ...values) => languageUI.t(key, ...values);
const M = value => languageUI.message(value);
const $ = id => document.getElementById(id);
const api = window.companion;
api.getAll().then(all => document.body.classList.toggle("poe-off", !all?.focus?.poeTracking)).catch(() => {}); // Forever-only focus: companion/active-games.mjs
window.addEventListener('online', () => { void api.recoverSync?.().catch(() => {}); });
const desktopNavigation = matchMedia('(min-width:1001px)');
function closeNavigation() { document.body.classList.remove('nav-open'); $('btnNav').setAttribute('aria-expanded','false'); $('navBackdrop').hidden = true; document.querySelector('.sidebar').inert = !desktopNavigation.matches; document.querySelector('.workspace').inert = false; }
$('btnNav').addEventListener('click', () => { const open = $('btnNav').getAttribute('aria-expanded') !== 'true'; if (!open) { closeNavigation(); return; } document.body.classList.add('nav-open'); $('btnNav').setAttribute('aria-expanded','true'); $('navBackdrop').hidden = false; document.querySelector('.sidebar').inert = false; document.querySelector('.workspace').inert = true; document.querySelector('.nav.active').focus(); });
$('navBackdrop').addEventListener('click',closeNavigation);
document.addEventListener('keydown',event => {
  if (event.key !== 'Tab' || !document.body.classList.contains('nav-open')) return;
  const focusable = [...document.querySelectorAll('.sidebar button, .sidebar a[href], .sidebar summary')].filter(element => !element.hidden && element.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('keydown',event => { if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { closeNavigation(); $('btnNav').focus(); } });
desktopNavigation.addEventListener('change',closeNavigation);
const modeLabel = mode => T(({STANDARD:'Trade / Standard', HARDCORE:'Hardcore', SSF:'Solo self-found', SSF_HARDCORE:'Solo self-found Hardcore'})[mode] || mode || '');
const fields = ['uploadUrl','guildDiscordId','pairingCode','watchFile','realm','wowGuild','standingsIntervalMinutes'];
const names = {status:'Sync',link:'Link everything',characters:'Guild',server:'Server',wow:'Tools',settings:'Settings',activity:'Activity',help:'Help & privacy',problems:'Problems'};
let lastSnapshot;
let storePackage = false; // Microsoft Store build: its update banner opens the Store (F5)
let savedConfig = {};
let entries = [];
let toastTimer;
function ago(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return T("Not yet");
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return T("Just now");
  if (seconds < 3600) return T("{0} min ago", Math.floor(seconds / 60));
  if (seconds < 86400) return T("{0} hr ago", Math.floor(seconds / 3600));
  return T("{0} days ago", Math.floor(seconds / 86400));
}
const POE_PAGES = new Set(['poe']); // pages that exist only while PoE2 tracking is on (companion/active-games.mjs)
function showPage(name) {
  // PoE2 has no screen in the companion. A stale tab=poe, or any missing page, stays on Sync.
  if (!names[name] || !document.getElementById('page-' + name) || (POE_PAGES.has(name) && document.body.classList.contains('poe-off'))) name = 'status';
  const selectedNav = document.querySelector(`.nav[data-page="${name}"]`);
  if (selectedNav?.closest('details')) selectedNav.closest('details').open = true;
  document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== `page-${name}`);
  document.querySelectorAll('.nav').forEach(button => { const active = button.dataset.page === name; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = T(names[name]);
  document.title = T("{0} · Guilded Companion", T(names[name]));
  closeNavigation();
  const heading = document.querySelector('#page-' + name + ' h1');
  if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
  window.scrollTo({top:0});
}
document.querySelectorAll('[data-page],[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page || button.dataset.go)));
function toast(message, error = false) {
  $('toast').textContent = M(message); $('toast').hidden = false; $('toast').classList.toggle('error',error); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000);
}
async function action(button, task) {
  button.disabled = true; button.dataset.busy = "true";
  try { return await task(); } catch (error) { toast(error.message || T("This action could not be completed."),true); }
  finally { button.disabled = false; delete button.dataset.busy; if (lastSnapshot) renderState(lastSnapshot); }
}
const bind = (id, task) => { const el = $(id); if (el) el.addEventListener('click', event => action(event.currentTarget, task)); };
const fieldValue = id => $(id)?.value.trim() ?? '';
const readForm = () => ({...Object.fromEntries(fields.map(id => [id, fieldValue(id)])), wowEnabled:$('wowEnabled').checked, poeEnabled:false, syncEnabled:$('syncEnabled').checked});
const say = (message, ok) => { $('formResult').textContent = M(message); $('formResult').className = `result ${ok ? 'ok' : 'bad'}`; };
function gameFields() { if ($('wowSettings')) $('wowSettings').hidden = !$('wowEnabled').checked; }
['wowEnabled'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', gameFields); });
function pill(id, text, level) { $(id).textContent = text; $(id).className = `pill ${level || ''}`; }
// The version panel (owner request, 7 November): what is installed, what is out, and the one thing
// to do, in plain words (update-check.cjs versionStatus decides the state).
let versionInfo = null, versionTimer = null;
const when = (iso) => iso ? new Date(iso).toLocaleString(languageUI.language, { dateStyle: 'medium', timeStyle: 'short' }) : '';
function versionTexts(info) {
  const auto = info.autoUpdate ? T("New versions download by themselves and install when you quit or restart the companion.") : T("Automatic updates are off: choose Check now from time to time, or turn them back on in Settings.");
  const checked = info.checkedAt ? T("Latest release: {0} · checked {1}", info.latest || '?', when(info.checkedAt)) : '';
  switch (info.status) {
    case 'up-to-date': return { title: T("Guilded Companion {0} is up to date", info.installed), line: checked, help: auto };
    case 'update-ready': return { title: T("Version {0} is ready to install", info.latest), line: T("You have {0}.", info.installed), help: T("It installs by itself when you quit or restart the companion. Install now does it at once: the companion closes and restarts in about a minute."), button: T("Install now") };
    case 'update-available': return { title: T("Version {0} is available", info.latest), line: T("You have {0}.", info.installed), help: T("Update now downloads it, checks it and restarts the companion. Your settings and Discord link are kept."), button: T("Update now") };
    case 'installing': return { title: T("Installing the update…"), line: T("You have {0}.", info.installed), help: T("The companion closes and restarts by itself.") };
    case 'store-update': return { title: info.latest ? T("Version {0} is out; you have {1}", info.latest, info.installed) : T("A Microsoft Store update is waiting"), line: '', help: T("Microsoft Store installs it: choose Open Microsoft Store, then Update on the Guilded Companion page."), button: T("Open Microsoft Store") };
    case 'store-up-to-date': return { title: T("Guilded Companion {0} is up to date", info.installed), line: checked, help: T("Microsoft Store keeps it up to date. To check right away, open it and choose Update if it shows one."), button: T("Open Microsoft Store"), quiet: true };
    case 'store-unknown': return { title: T("Guilded Companion {0}", info.installed), line: '', help: T("Microsoft Store keeps it up to date. To check right away, open it and choose Update if it shows one."), button: T("Open Microsoft Store"), quiet: true };
    default: return { title: T("Guilded Companion {0}", info.installed), line: info.checkFailed ? T("The release service could not be reached; the companion asks again every few hours.") : T("Not checked yet."), help: auto };
  }
}
function paintVersion() {
  if (!versionInfo) return;
  const text = versionTexts(versionInfo);
  $('versionTitle').textContent = text.title;
  $('versionLine').textContent = text.line || '';
  $('versionLine').hidden = !text.line;
  $('versionHelp').textContent = text.help || '';
  const button = $('btnVersionAction');
  button.hidden = !text.button;
  if (text.button && !button.dataset.busy) button.textContent = text.button;
  button.className = text.quiet ? '' : 'primary';
  $('btnVersionCheck').hidden = versionInfo.status.startsWith('store-');
}
async function refreshVersion() {
  try { versionInfo = await api.versionInfo(); paintVersion(); } catch { /* older main process */ }
}
function scheduleVersion() { clearTimeout(versionTimer); versionTimer = setTimeout(() => void refreshVersion(), 300); }
// The version panel on Home says what is new; it refreshes with every state update.
function renderUpdate() { scheduleVersion(); }
// The Sync status card (redesign PR 1): one state, most urgent first, one button
// (companion/status-card.mjs decides; this only words and wires it).
let shownCard = null;
function renderStatusCard(snapshot) {
  const card = window.guildedStatusCard.statusCard({ problems: snapshot.problems || [], config: savedConfig, state: snapshot.state || {} });
  shownCard = card;
  const words = (parts) => parts ? T(parts[0], ...parts.slice(1).map((value) => value && typeof value === 'object' && value.ago ? ago(value.ago).toLowerCase() : value)) : '';
  $('statusCard').dataset.tone = card.tone;
  $('statusCard').dataset.state = card.id;
  $('statusTitle').textContent = words(card.title);
  $('statusDetail').textContent = words(card.detail);
  $('statusDetail').hidden = !card.detail;
  const button = $('btnStatusAction');
  button.hidden = !card.button;
  if (card.button && !button.dataset.busy) button.textContent = T(card.button.label);
  // Sign-in is optional: on a healthy card it is only a quiet secondary link.
  const link = $('btnStatusLink');
  link.hidden = !card.link;
  if (card.link) link.textContent = T(card.link.label);
  const line = window.guildedStatusCard.guildLine({ config: savedConfig, savedFile: snapshot.savedFile });
  const parts = [line.guild, line.lastReload ? T("last /reload {0}", ago(line.lastReload).toLowerCase()) : null].filter(Boolean);
  $('statusGuildLine').textContent = parts.join(' · ');
  $('statusGuildLine').hidden = !parts.length;
}
async function statusAction(which) {
  const action = (which === 'link' ? shownCard?.link : shownCard?.button)?.action;
  const result = $('statusResult');
  const say = (message, ok = true) => { result.textContent = message ? M(message) : ''; result.className = ok ? 'result ok' : 'result bad'; };
  say('');
  switch (action) {
    case 'sign-in': showPage('link'); return;
    case 'copy-officer-message': {
      const guild = shownCard?.title?.[1] || savedConfig.wowGuildName || savedConfig.wowGuild || '';
      const text = "Hello! Could you run /setup in our guild's Discord server so the Guilded companion can sync our guild " + guild + "? Thank you!" + String.fromCharCode(10) + 'Bonjour ! Pourriez-vous lancer /setup sur le serveur Discord de notre guilde pour que le compagnon Guilded puisse synchroniser notre guilde ' + guild + ' ? Merci !';
      try { await navigator.clipboard.writeText(text); say(T("Copied. Paste it to an officer of your guild.")); } catch { say(T("Could not copy. Ask an officer of your guild to run /setup on its Discord server."), false); }
      return;
    }
    case 'problems': showPage('problems'); return;
    case 'settings': showPage('settings'); return;
    case 'storage': await api.openStorageSettings(); return;
    case 'find-wow': { const answer = await api.repair(); say(answer?.summary ? T("Repair: {0} fixed, {1} need you, {2} failed.", answer.summary.fixed, answer.summary.needsYou, answer.summary.failed) : '', !answer?.summary?.failed); return; }
    case 'install-addon': { const answer = await api.installAddon(); say(answer.message, answer.ok); return; }
    case 'switch-folder': { const answer = await api.switchLiveFolder(); say(answer?.path ? T('Switched. Now watching {0}', answer.path) : '', true); return; }
    case 'retry': await api.recoverSync(); await api.uploadNow(); say(T('Trying again. Follow the result in Activity.')); return;
    case 'sync-now': await api.uploadNow(); say(T('Syncing now. Follow the result in Activity.')); return;
    case 'choose-server': $('deviceAdvanced').open = true; $('deviceServerList').focus(); return;
    default: return;
  }
}
bind('btnStatusAction', () => statusAction());
bind('btnStatusLink', () => statusAction('link'));
// Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): the optional sign-in note and "Advanced: choose server".
function renderDevice(snapshot) {
  const overview = window.guildedOverview(savedConfig, snapshot.state || {});
  $('devicePanel').hidden = !overview.device;
  if (!overview.device) return;
  const device = snapshot.state?.device;
  const list = $('deviceServerList');
  const servers = Array.isArray(device?.servers) ? device.servers : [];
  const wanted = ['', ...servers.map((server) => server.discordId)].join('|');
  if (list.dataset.servers !== wanted) {
    list.dataset.servers = wanted;
    list.replaceChildren(new Option(T('Automatic (from your guild)'), ''), ...servers.map((server) => new Option(server.name || server.discordId, server.discordId)));
  }
  if (device?.status === 'choose' && !$('deviceAdvanced').dataset.opened) { $('deviceAdvanced').open = true; $('deviceAdvanced').dataset.opened = 'true'; }
}
bind('btnDeviceServer', async () => {
  const typed = $('deviceServerId').value.trim();
  const choice = typed || $('deviceServerList').value;
  if (choice && !/^\d{5,25}$/.test(choice)) { $('deviceServerResult').textContent = T('A Discord server ID is a long number.'); $('deviceServerResult').className = 'result bad'; return; }
  const answer = await api.deviceChooseServer(choice);
  $('deviceServerResult').textContent = M(answer.message);
  $('deviceServerResult').className = answer.ok ? 'result ok' : 'result bad';
});
// Several WoW accounts (docs/plans/MULTI_ACCOUNT.md): another account folder with Guilded's data.
// Asked once; main.cjs keeps which file it is and remembers the answer.
function renderAccountAsk(snapshot) {
  const other = snapshot.otherAccount;
  $('accountAsk').hidden = !other;
  if (other) $('accountAskText').textContent = T('Another WoW account on this PC has Guilded data: {0}. Is it yours too?', other.account);
}
async function answerAccount(yes) {
  const answer = yes ? await api.accountYes() : await api.accountNo();
  const result = $('accountAskResult');
  result.textContent = !answer?.account ? '' : yes ? (answer.ok ? T('{0} syncs too from now on.', answer.account) : T('{0} was added, but the sync did not start. Open Problems to see why.', answer.account)) : T('{0} will not sync. You will not be asked again.', answer.account);
  result.className = answer?.ok === false ? 'result bad' : 'result ok';
}
bind('btnAccountYes', () => answerAccount(true));
// One line per WoW account (plan step 2): on the Sync page when there are several, and in Settings
// with a switch beside each further account (the first one goes off with WoW itself).
function accountText(row) { return T(row.text[0], ...row.text.slice(1).map((value) => value && typeof value === 'object' && value.ago ? ago(value.ago).toLowerCase() : value)); }
function renderAccounts(snapshot) {
  const rows = snapshot.accountRows || [];
  const several = rows.length > 1;
  $('statusAccounts').hidden = !several;
  $('statusAccounts').replaceChildren(...(several ? rows.filter((row) => row.on) : []).map((row) => { const item = document.createElement('li'); item.textContent = accountText(row); return item; }));
  $('accountList').hidden = !several;
  $('accountList').replaceChildren(...(several ? rows : []).map((row) => {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = row.on; box.disabled = row.first;
    box.title = row.first ? T('The first account syncs while World of Warcraft is on.') : T('Sync this account');
    box.addEventListener('change', async () => { box.disabled = true; const answer = await api.setAccount(row.file, box.checked); if (!answer?.ok) box.checked = !box.checked; box.disabled = false; });
    const text = document.createElement('span');
    text.textContent = accountText(row);
    label.append(box, text);
    item.append(label);
    return item;
  }));
}
bind('btnAccountNo', () => answerAccount(false));
bind('btnStatusDetails', async () => showPage('activity'));
function renderState(snapshot) {
  updateProfileLinks();
  lastSnapshot = snapshot;
  try { renderStatusCard(snapshot); } catch { /* the rest of the page still renders */ }
  try { renderAccountAsk(snapshot); } catch { /* the rest of the page still renders */ }
  try { renderDevice(snapshot); } catch { /* the rest of the page still renders */ }
  try { renderAccounts(snapshot); } catch { /* the rest of the page still renders */ }
  if ($('profileSyncStatus')) $('profileSyncStatus').textContent = (snapshot.state.profiles || []).map(p => p.name + ': ' + M(p.error || (p.running ? 'Syncing' : p.enabled ? 'Setup needed' : 'Paused'))).join(' · ');
  const guildWarnings = (snapshot.state.profiles || []).filter(p => p.warning).map(p => '[' + p.name + '] ' + p.warning);
  for (const note of document.querySelectorAll('.guild-warning')) { note.hidden = !guildWarnings.length; note.textContent = M(guildWarnings.join(' ')); }
  const {state,health} = snapshot;
  const sync = window.guildedSyncStatus(savedConfig, state, state.syncEvidence);
  let evidencePanel = $('syncEvidence');
  if (!evidencePanel) { evidencePanel = document.createElement('p'); evidencePanel.id = 'syncEvidence'; evidencePanel.className = 'panel'; $('page-activity').insertBefore(evidencePanel, $('log')); }
  evidencePanel.textContent = T('Saved: {0} · Uploaded: {1} · Received by bot: {2}', sync.saved.at ? ago(sync.saved.at) : T('Unknown'), sync.uploaded.at ? ago(sync.uploaded.at) : T('Unknown'), sync.accepted.at ? ago(sync.accepted.at) : T('Unknown')) + ' · ' + T('Receipt does not mean officer approval.');
  const syncActions = {
    'save-in-game': 'Use /reload in WoW to save your addon data.',
    'wait-for-upload': 'Keep tracking enabled while your saved data uploads.',
    'wait-for-acceptance': 'Check Activity for the bot receipt before retrying.',
    'reload-in-game': 'After saving standings to the addon, use /reload in WoW.',
    'officer-review': 'Your upload needs officer review in Discord.',
    'review-application-error': 'Your sync was received but could not be applied. Ask an officer to review it.',
    'wait-for-retry': 'Keep the companion open while it retries.',
    'check-connection': 'Check your connection and the Activity messages.'
  };
  evidencePanel.textContent += ' · ' + T('Edition: {0} · Character: {1} · Saved-data source: {2}', sync.edition === 'unknown' ? T('Unknown') : sync.edition, sync.character || T('Unknown'), sync.folder || sync.watchedFile || state.watching || T('Unknown')) + ' · ' + T(syncActions[sync.action]);
  renderUpdate(snapshot.update);
  const overview = window.guildedOverview(savedConfig,state);
  $('btnUpload').hidden = !overview.linked && !overview.device;
  $('btnUpload').disabled = !overview.canSync || $('btnUpload').dataset.busy === 'true';
  const linked = !!savedConfig.companionCredential;
  const paused = linked && !state.running && health.text === 'Not running';
  const setup = health.level === 'setup' && health.text === 'Setup needed';
  $('setupBadge').hidden = !setup;
  pill('connectionPill', setup ? T("Setup needed") : paused ? T("Paused") : health.level === 'ok' ? T("Connected") : T("Needs attention"),health.level === 'ok' ? 'ok' : health.level === 'error' ? 'error' : 'gold');
  pill('pairBadge', linked ? T("Discord linked") : T("Discord not linked"),linked ? 'ok' : '');
  $('removePanel').hidden = false;
  $('tileWatch').textContent = state.watching || savedConfig.watchFile || T("No saved-data file selected");
  pill('wowFileState',state.watching || savedConfig.watchFile ? T("File selected") : T("Choose a file"),state.watching ? 'ok' : '');
  $('btnPause').textContent = state.running ? T("Pause tracking") : T("Resume tracking");
  renderMode();
}
// Guild or leaderboards only (personal): what is connected, and which saved files the WoW steps mean.
// The guild wording set by init() is kept the first time and restored when the mode changes back.
const MODE_TEXT = ['watchFile:placeholder','detectNote','btnWowSelect','wowStep2','wowStep3','btnStandings'];
let modeDefaults = null;
function renderMode() {
  const personal = savedConfig.personal === true, linked = !!savedConfig.companionCredential;
  const read = key => { const [id, attribute] = key.split(':'); return attribute ? $(id)[attribute] : $(id).textContent; };
  const write = (key, text) => { const [id, attribute] = key.split(':'); if (attribute) $(id)[attribute] = text; else $(id).textContent = text; };
  modeDefaults ||= Object.fromEntries(MODE_TEXT.map(key => [key, read(key)]));
  const leaderboard = {
    'watchFile:placeholder': T("Choose GuildedDungeons.lua or Guilded.lua"),
    detectNote: T("World of Warcraft / WTF / Account / your account / SavedVariables: the companion reads GuildedDungeons.lua and Guilded.lua there, whichever addon you use."),
    btnWowSelect: T("Choose saved data"),
    wowStep2: T("The companion notices the saved-file change and sends your finished dungeon runs to the public leaderboards."),
    wowStep3: T("Refresh public scores, then /reload and use /gdungeons score. Public and guild scores may differ."),
    btnStandings: T("Refresh public scores")
  };
  for (const key of MODE_TEXT) write(key, personal ? leaderboard[key] : modeDefaults[key]);
  $('btnStandings').hidden = false;
  $('connectedAs').hidden = !linked;
  $('connectedAs').textContent = !linked ? '' : personal
    ? T("Connected: public dungeon leaderboards only. Sync your finished runs without sharing guild data.")
    : T("Connected: your guild's Discord{0}. Sync saved data and refresh standings from this companion.", savedConfig.guildDiscordId ? T(" (server {0})", savedConfig.guildDiscordId) : '');
}
function renderLogs() {
  $('log').replaceChildren();
  const query = $('logSearch').value.toLowerCase(); const filter = $('logFilter').value;
  const shown = entries.filter(entry => (filter === 'all' || entry.level === filter) && (M(entry.message).toLowerCase().includes(query) || entry.message.toLowerCase().includes(query)));
  $('activityCount').textContent = String(entries.length);
  if (!shown.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; const heading = document.createElement('h3'); heading.textContent = entries.length ? T("No matching activity") : T("You're all caught up"); const note = document.createElement('p'); note.textContent = entries.length ? T("Try a different search or filter.") : T("Your sync activity will appear here."); empty.append(heading,note); $('log').append(empty); return; }
  for (const entry of shown.slice().reverse()) {
    const row = document.createElement('div'); row.className = 'log-row';
    const time = document.createElement('time'); time.dateTime = entry.time; time.textContent = new Date(entry.time).toLocaleTimeString(languageUI.language, {hour:'2-digit',minute:'2-digit'}); time.title = new Date(entry.time).toLocaleString(languageUI.language);
    const level = document.createElement('span'); level.className = `log-level ${['info','ok','warn','error'].includes(entry.level) ? entry.level : 'info'}`; level.textContent = entry.level === 'ok' ? T("Synced") : T(entry.level);
    const message = document.createElement('span'); message.className = 'log-message'; message.textContent = (entry.profileName ? '[' + entry.profileName + '] ' : '') + M(entry.message); row.append(time,level,message); $('log').append(row);
  }
}
function addLog(entry) { entries.push(entry); entries = entries.slice(-300); renderLogs(); }
$('logSearch').addEventListener('input',renderLogs); $('logFilter').addEventListener('change',renderLogs); $('btnClearLog').addEventListener('click',() => { entries = []; renderLogs(); });
async function chooseWow() { const file = await api.browseFile(); if (file) { $('watchFile').value = file; toast(T("WoW file selected. Save your setup to apply it.")); } }
bind('btnBrowse',chooseWow);
// Folder picker (8.5, track F3): the dialog opens at the WoW install folder; the companion finds the
// account folder(s) below whatever is picked. Several accounts: the member chooses one here.
const GAME_FOLDERS = {_forever_:'WoW Forever',_classic_:'Classic',_classic_beta_:'Beta'};
const gameLabel = game => T(GAME_FOLDERS[String(game).toLowerCase()] || game);
function chooseAccount(account) {
  $('watchFile').value = account.path;
  $('detectNote').textContent = account.exists ? T("Account {0} ({1}) selected. Choose Save & start syncing.", account.account, gameLabel(account.game)) : T("Account {0} ({1}) selected. In WoW, type /reload once to create its saved file, then choose Save & start syncing.", account.account, gameLabel(account.game));
}
function renderAccountChoice(accounts) {
  const list = $('accountChoiceList'); list.replaceChildren();
  $('accountChoice').hidden = accounts.length < 2;
  if (!accounts.length) { $('detectNote').textContent = T("No WoW account was found in that folder. Choose the World of Warcraft folder (the one with _forever_ inside)."); return; }
  const first = accounts.find(account => account.suggested) || accounts[0];
  chooseAccount(first);
  if (accounts.length < 2) return;
  for (const account of accounts) {
    const label = document.createElement('label'); label.className = 'check account-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'wowAccount'; input.checked = account === first;
    input.addEventListener('change', () => { if (input.checked) chooseAccount(account); });
    const text = document.createElement('span');
    text.textContent = T("Account {0} · {1} · {2}", account.account, gameLabel(account.game), account.savedAt ? T("saved {0}", ago(account.savedAt).toLowerCase()) : T("not saved yet"));
    label.append(input, text); list.append(label);
  }
}
async function pickWowFolder() {
  if (!api.pickWowFolder) return chooseWow();
  const result = await api.pickWowFolder();
  if (result.canceled) return;
  renderAccountChoice(result.accounts);
}
bind('btnPickFolder',pickWowFolder);
bind('btnWowSelect',async () => { showPage('settings'); await pickWowFolder(); });
bind('btnSaveAdvanced',async () => { $('form').requestSubmit(); });
// Simpler menu (8.5, track F2): optional raid pages appear once the guild uses them (companion/page-visibility.mjs).
function rememberedPages() { try { return JSON.parse(localStorage.getItem('guilded.companion.usedPages') || '{}'); } catch { return {}; } }
function showUsedPages(hub) {
  const used = window.guildedPagesInUse(hub, rememberedPages());
  try { localStorage.setItem('guilded.companion.usedPages', JSON.stringify(used)); } catch { /* shown again after the next load */ }
  for (const button of document.querySelectorAll('.optional-page')) button.hidden = !used[button.dataset.page] && !button.classList.contains('active');
}
document.addEventListener('companion-hub-data', event => showUsedPages(event.detail));
// Find it: every drive and Battle.net's own record; always says what it found or which drives it searched.
bind('btnDetect',async () => { $('detectNote').textContent = T("Looking for your addon data…"); const answer = window.guildedWowSearchMessage(await api.searchWow(), { personal: savedConfig.personal === true }); if (answer.path) $('watchFile').value = answer.path; $('detectNote').textContent = T(...answer.text); });
bind('btnTest',async () => { say(T("Checking your connection…"),true); const result = await api.testConnection(readForm()); say(result.message,result.ok); });
bind('btnPair',async () => { if (!$('pairingCode').value.trim()) { say(T("Paste the code from /character pair (or from guilded.kcaron.top/me/) first, or use Sign in with Discord."),false); $('pairingCode').focus(); return; } say(T("Connecting your Discord account…"),true); const result = await api.pairAccount(readForm()); say(result.message,result.ok); if (result.ok) { $('pairingCode').value = ''; savedConfig = (await api.getAll()).config; $('guildDiscordId').value = savedConfig.guildDiscordId || ''; renderState(lastSnapshot); toast(T("Discord account connected.")); } else if (/server ID/i.test(result.message)) { $('advanced').open = true; $('guildDiscordId').focus(); } });
// Sign in with Discord (7.2): the browser opens the website; the companion waits for the approval.
// The same sign-in serves Connection & setup and the Link everything page: only the places that show progress differ.
// 8.5 (fresh-PC test): the browser may open behind this window, so the box says so, counts down to
// the request's expiry, offers Reopen the page, follows an automatic restart, and every ending says something.
const signInViews = {
  setup: { say, waiting: 'signInWaiting', code: 'signInCode', line: 'signInCodeLine', time: 'signInTimeLeft' },
  link: { say: (message, ok) => { $('linkResult').textContent = M(message); $('linkResult').className = `result ${ok ? 'ok' : 'bad'}`; }, waiting: 'linkSignInWaiting', code: 'linkSignInCode', line: 'linkSignInCodeLine', time: 'linkSignInTimeLeft' }
};
let signInRun = null;
function stopSignInBox() {
  if (signInRun?.timer) clearInterval(signInRun.timer);
  signInRun = null;
  for (const view of Object.values(signInViews)) $(view.waiting).hidden = true;
}
function showSignInBox(view, started) {
  stopSignInBox();
  const ui = signInViews[view];
  $(ui.code).textContent = started.confirm || ''; $(ui.line).hidden = !!started.automatic; $(ui.waiting).hidden = false;
  const tick = () => { const line = window.guildedSignIn.timeLeftLine(started.expiresAt); $(ui.time).textContent = line ? T(...line) : ''; };
  tick();
  signInRun = { view, timer: setInterval(tick, 1000) };
}
async function runSignIn(view, switchAccount = false) {
  const ui = signInViews[view];
  // Leaderboards only is not a guild link: Link everything signs in again to reach the guild's server.
  if (!switchAccount && view === 'link' && savedConfig.companionCredential && !savedConfig.personal) { ui.say(T("Already linked, nothing to do."),true); return; }
  ui.say(T("Opening Discord sign-in…"),true);
  // "Not you? Switch" (Track L): the same sign-in, with Discord showing which account it is.
  const started = switchAccount ? await api.signInSwitch() : await api.signInStart(readForm());
  if (!started.ok) { stopSignInBox(); ui.say(started.message || T("The sign-in could not start. Check your internet connection, then try again."),false); return; }
  showSignInBox(view, started);
  ui.say(started.automatic ? T("Your browser opened. Choose your server there and press Connect.") : T("Your browser opened. Type {0} on the sign-in page.", started.confirm),true);
  let result;
  try { result = await api.signInWait(); } catch (error) { result = { ok: false, message: error?.message }; }
  stopSignInBox();
  const outcome = window.guildedSignIn.signInOutcome(result);
  const current = signInViews[view];
  current.say(outcome.message, outcome.ok);
  if (result?.ok) { savedConfig = (await api.getAll()).config; $('guildDiscordId').value = savedConfig.guildDiscordId || ''; $('uploadUrl').value = savedConfig.uploadUrl || ''; renderState(lastSnapshot); toast(T("Discord account connected.")); document.dispatchEvent(new CustomEvent('companion-signed-in')); }
}
// The bot forgot the request (expired, or it restarted): the companion opened a new page by itself.
api.onSignInRestarted?.(started => {
  if (!signInRun) return;
  const view = signInRun.view;
  showSignInBox(view, started);
  // restarted 0: "Reopen the page" asked for the new request; it says so itself.
  if (started.restarted) signInViews[view].say(T("That sign-in expired, so a new one opened in your browser (it may be behind this window)."),true);
});
async function reopenSignIn(view) {
  const result = await api.signInReopen();
  signInViews[view].say(result.ok ? T("The sign-in page opened again. Look for your browser behind this window or in the taskbar.") : result.message, !!result.ok);
}
bind('btnSignIn',() => runSignIn('setup'));
bind('btnLinkSignIn',() => runSignIn('link'));
bind('btnSwitchAccount',() => runSignIn('link', true));
bind('btnSignInReopen',() => reopenSignIn('setup'));
bind('btnLinkSignInReopen',() => reopenSignIn('link'));
bind('btnSignInCancel',async () => { await api.signInCancel(); stopSignInBox(); say(T("Sign-in cancelled."),false); });
bind('btnLinkSignInCancel',async () => { await api.signInCancel(); stopSignInBox(); signInViews.link.say(T("Sign-in cancelled."),false); });
$('form').addEventListener('submit',event => { event.preventDefault(); action($('btnSave'),async () => { say(T("Saving your preferences…"),true); const result = await api.saveConfig(readForm()); say(result.message,result.ok); savedConfig = (await api.getAll()).config; renderState(lastSnapshot); if (result.ok) { toast(result.message); showPage('status'); } }); });
$('autostart').addEventListener('change',event => action(event.target,async () => { $('autostart').checked = await api.setAutostart(event.target.checked); }));
bind('btnConnections', () => api.openConnections ? api.openConnections() : window.open('/me/connections','_blank','noopener'));
bind('btnBattleNet', () => api.openBattleNet ? api.openBattleNet() : window.open('/me/battlenet','_blank','noopener'));
bind('btnUpload',async () => { await api.uploadNow(); toast(T("Sync requested. Follow its progress in Activity.")); });
bind('btnStandings',async () => {
  if (!savedConfig.companionCredential) { toast(T("Connect your account first: choose Sign in with Discord (or enter a pairing code) in Connection & setup."),true); return; }
  if (!lastSnapshot?.state?.running) { toast(T("Resume tracking in Connection & setup when you are ready."),true); return; }
  await api.refreshStandings();
  toast(T("Standings refresh requested. Check Activity for the result."));
});
bind('btnSheets',async () => { const result = await api.exportSheets($('sheetTable').value || undefined); if (!result.canceled) toast(result.message,!result.ok); });
$('grmPanel').hidden = typeof api.convertGRM !== 'function';
bind('btnGRM', async () => {
  if (!api.convertGRM) return;
  const result = await api.convertGRM({ guild: $('grmGuild').value, realm: $('grmRealm').value, edition: $('grmEdition').value, includePrivate: $('grmPrivate').checked });
  if (!result.canceled) { $('grmResult').textContent = M(result.message); toast(result.message, !result.ok); }
});
bind('btnFolder',() => api.openAddonFolder()); bind('btnPause',async () => { await api.toggleTracking(); const all = await api.getAll(); savedConfig = all.config; $('syncEnabled').checked = all.config.syncEnabled !== false; });
let lootImportToken = null, lootMappingInputs = [];
$('lootImportPanel').hidden = typeof api.previewLootHistory !== 'function';
function resetLootPreview() { lootImportToken = null; $('lootImportReview').hidden = true; $('btnLootImportSave').disabled = true; }
for (const id of ['lootImportSource', 'lootImportGuild', 'lootImportRealm', 'lootImportEdition']) $(id).addEventListener('input', resetLootPreview);
bind('btnLootImportPreview', async () => {
  if (!api.previewLootHistory) return;
  resetLootPreview();
  if (['lootImportSource', 'lootImportGuild', 'lootImportRealm', 'lootImportEdition'].some(id => !$(id).value.trim())) { $('lootImportResult').textContent = T("Choose the source, destination guild, realm and edition first."); return; }
  const result = await api.previewLootHistory({ source: $('lootImportSource').value, guild: $('lootImportGuild').value, realm: $('lootImportRealm').value, edition: $('lootImportEdition').value });
  if (result.canceled) return;
  if (!result.ok) { $('lootImportResult').textContent = M(result.message); return; }
  lootImportToken = result.token; lootMappingInputs = []; $('lootImportMappings').replaceChildren();
  for (const source of result.characters) {
    const label = document.createElement('label'), input = document.createElement('input');
    label.textContent = source + ' → '; input.maxLength = 160; input.autocomplete = 'off';
    input.value = source.includes('-') ? source : ''; label.append(input); $('lootImportMappings').append(label);
    lootMappingInputs.push({ source, input });
  }
  $('lootImportRows').textContent = result.entries.map(row => `${row.sourceCharacter} | ${row.itemId} | ${row.awardedAt.value} (${row.awardedAt.timezone}) | ${row.response}`).join('\n');
  $('lootImportResult').textContent = T("{0} awards; {1} duplicates omitted; {2} awards without stable IDs.", result.summary.previewRows, result.summary.duplicates, result.summary.missingSourceIds) + '\n' + result.warnings.map(M).join('\n');
  $('lootImportUnidentified').checked = false; $('lootImportReview').hidden = false; $('btnLootImportSave').disabled = false;
});
bind('btnLootImportSave', async () => {
  if (!api.saveLootHistory || !lootImportToken) return;
  const result = await api.saveLootHistory({ token: lootImportToken, characterMap: Object.fromEntries(lootMappingInputs.map(({ source, input }) => [source, input.value.trim()])), allowUnidentified: $('lootImportUnidentified').checked });
  if (result.canceled) return;
  $('lootImportResult').textContent = M(result.message); if (result.ok) resetLootPreview();
});
bind('btnRemoveData',() => api.removeData());
bind('btnDeleteMyData',() => api.deleteMyData()); // native confirm dialog in main.cjs
// Update now (7.2): the desktop app downloads, checks and installs the new version itself.
bind('btnStoreUpdates', () => api.openUpdate());
bind('btnStoreStartup', () => api.openStartupSettings());
api.onUpdateProgress?.(percent => {
  $('versionResult').textContent = T("Downloading and checking the update: {0}%", percent); $('versionResult').className = 'result';
});
bind('btnVersionAction', async () => {
  if (!versionInfo) return;
  const result = $('versionResult');
  if (versionInfo.action === 'open-store') { await api.openStoreListing(); result.textContent = T("Microsoft Store opened at Guilded Companion. Choose Update there (or Get updates in the Library)."); result.className = 'result ok'; return; }
  const button = $('btnVersionAction');
  button.dataset.busy = 'true'; button.textContent = versionInfo.action === 'install-now' ? T("Installing…") : T("Checking update…");
  result.textContent = ''; result.className = 'result';
  let answer;
  try { answer = await api.installUpdate(); }
  catch (error) { answer = { ok: false, message: error?.message }; }
  finally { delete button.dataset.busy; }
  result.textContent = M(answer?.message || T("This action could not be completed.")); result.className = answer?.ok ? 'result ok' : 'result bad';
  await refreshVersion();
});
bind('btnVersionCheck', async () => {
  const result = $('versionResult');
  $('btnVersionCheck').textContent = T("Checking update…");
  try { const answer = await api.checkUpdate(); result.textContent = M(answer.message); result.className = answer.ok ? 'result ok' : 'result bad'; }
  finally { $('btnVersionCheck').textContent = T("Check now"); await refreshVersion(); }
});
document.addEventListener('companion-language', paintVersion);
$('autoUpdate').addEventListener('change',event => action(event.target,async () => { $('autoUpdate').checked = await api.setAutoUpdate(event.target.checked); }));
bind('btnCheckUpdate',async () => {
  $('btnCheckUpdate').textContent = T("Checking update…");
  try { const result = await api.checkUpdate(); toast(result.message,!result.ok); }
  finally { $('btnCheckUpdate').textContent = T("Check for updates"); }
});
bind('btnDiagnostics',async () => { const all = await api.getAll(); const state = all.state || lastSnapshot?.state || {}; const summary = window.guildedSyncDiagnosticPreview(savedConfig, state, { ...(state.syncEvidence || {}), companionVersion: all.version, utcOffsetMinutes: -new Date().getTimezoneOffset() }); $('diagnosticContent').textContent = JSON.stringify(summary,null,2); $('diagnosticPreview').showModal(); });
bind('btnCancelDiagnostics',async () => $('diagnosticPreview').close());
bind('btnSaveDiagnostics',async () => { const url = URL.createObjectURL(new Blob([$('diagnosticContent').textContent],{type:'application/json'})); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Guilded-support-summary.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); $('diagnosticPreview').close(); toast(T("Support summary saved without credentials, account IDs or file paths.")); });
function setTheme(light) { document.body.classList.toggle('light',light); $('btnTheme').setAttribute('aria-label',light ? T("Switch to dark theme") : T("Switch to light theme")); try { localStorage.setItem('guilded.companion.theme',light ? 'light' : 'dark'); } catch { /* theme still applies */ } }
try { setTheme(localStorage.getItem('guilded.companion.theme') === 'light'); } catch { /* use dark */ }
$('btnTheme').addEventListener('click',() => setTheme(!document.body.classList.contains('light')));
function updateProfileLinks() {
  for (const anchor of document.querySelectorAll('[data-profile-link-base], a[href^="https://guilded.kcaron.top/me/"], a[href^="https://guilded.kcaron.top/leaderboards/"]')) {
    const base = anchor.dataset.profileLinkBase || anchor.href;
    anchor.dataset.profileLinkBase = base;
    anchor.href = window.guildedProfileSiteHref(base, savedConfig.gameEdition, languageUI.language);
  }
}
function configurePresentation() {
  updateProfileLinks();
  for (const key of MODE_TEXT) { const [id, attribute] = key.split(':'); const value = T(languageUI.original(id, attribute)); if (attribute) $(id)[attribute] = value; else $(id).textContent = value; }
  modeDefaults = null;
  $('appMode').textContent = T('Desktop companion'); $('sideNote').textContent = T('Keeps working in your tray.'); $('watchFile').removeAttribute('readonly');
}
$('language').addEventListener('change', async event => {
  const chosen = event.target.value;
  try {
    // Only a presentation preference: never submit the connection form here.
    await api.setLanguage?.(chosen);
    const url = new URL(location.href); url.searchParams.set('lang', chosen);
    history.replaceState(history.state, '', url);
    languageUI.set(chosen);
  } catch (error) { toast(error.message, true); event.target.value = languageUI.language; }
});
document.addEventListener('companion-language', () => {
  if (!lastSnapshot) return;
  configurePresentation();
  void renderProfiles(); renderState(lastSnapshot); renderLogs();
  const page = document.querySelector('.nav.active')?.dataset.page || 'status';
  $('breadcrumb').textContent = T(names[page]);
  document.title = T('{0} · Guilded Companion', T(names[page]));
  setTheme(document.body.classList.contains('light'));
});
async function renderProfiles() {
  if (!api.listProfiles) return;
  const data = await api.listProfiles();
  $('connectionProfile').replaceChildren(...data.profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = (p.defaultName ? T('Original connection') : p.name) + (p.gameEdition ? ' · ' + window.guildedProfileEditionLabel(p.gameEdition, languageUI.language) : ''); return option; }));
  $('connectionProfile').value = data.active;
}
async function changeConnection(choice) {
  document.dispatchEvent(new CustomEvent('companion-connection-changing'));
  let result;
  try { result = await api.changeProfile(choice); }
  finally { document.dispatchEvent(new CustomEvent('companion-connection-changed')); }
  if (!result.ok) { toast(languageUI.message(result.message), true); await renderProfiles(); return; }
  const all = await api.getAll(); savedConfig = all.config;
  for (const id of fields) { const el = $(id); if (el) el.value = all.config[id] ?? ''; }
  $('syncEnabled').checked = all.config.syncEnabled !== false; $('wowEnabled').checked = all.config.wowEnabled !== false;
  gameFields(); renderState({state:all.state,health:all.health,update:all.update,savedFile:all.savedFile});
  await renderProfiles(); toast(languageUI.message(result.message));
}
$('connectionProfile').addEventListener('change', () => changeConnection({ id: $('connectionProfile').value }));
document.addEventListener('companion-language', () => { void renderProfiles().catch(error => toast(error.message, true)); });
bind('btnRemoveProfile', async () => {
  const select = $('connectionProfile'); const label = select.selectedOptions[0]?.textContent || '';
  if (!confirm([T('Remove this server from this PC?'), label, T('Nothing is deleted on the server; this companion just stops uploading there.')].join(String.fromCharCode(10)))) return;
  const result = await api.removeProfile(select.value);
  if (!result.ok) { toast(languageUI.message(result.message), true); return; }
  const all = await api.getAll(); savedConfig = all.config;
  for (const id of fields) $(id).value = all.config[id] ?? '';
  $('syncEnabled').checked = all.config.syncEnabled !== false; $('wowEnabled').checked = all.config.wowEnabled !== false;
  gameFields(); renderState({state:all.state,health:all.health,update:all.update,savedFile:all.savedFile});
  await renderProfiles(); toast(languageUI.message(result.message));
});
bind('btnAddProfile', async () => { await changeConnection({ name: $('newProfileName').value }); $('newProfileName').value = ''; });

// The companion opens on Link everything (status, characters, big actions); Skip for now sends the user to Home and is remembered on this PC.
// Skip on Link everything lasts for this run only (sessionStorage), so the wizard is back next start.
function linkSkipped() { try { return sessionStorage.getItem('guilded.companion.linkSkipped') === '1'; } catch { return false; } }
// Setup is done once the member is signed in and syncing has what it needs: a leaderboards-only
// sign-in, a WoW folder, or WoW turned off.
// (9.1.3) Zero-setup counts as set up: the device key syncs without any sign-in, so the first-run page never opens for it.
function setupDone(config) {
  const device = !config.companionCredential && config.device === true && Boolean(config.deviceSecret);
  return (Boolean(config.companionCredential) || device) && (config.personal === true || Boolean(config.watchFile) || config.wowEnabled === false);
}
async function init() {
  if (!api) { toast(T("The companion interface could not load. Please reload or reinstall."),true); return; }
  const all = await api.getAll(); savedConfig = all.config;
  await renderProfiles();
  if (!languageUI.explicit && ['en','fr'].includes(all.language)) languageUI.set(all.language, false);
  for (const id of fields) { const el = $(id); if (el) el.value = all.config[id] ?? ''; }
  storePackage = all.storePackage === true;
  $('storeDistribution').hidden = !all.storePackage;
  // Store build: Windows manages startup; "Install updates automatically" is the off switch for the Store self-update (F5).
  if (all.storePackage) { $('autoUpdateRow').hidden = true; }
  $('autoUpdate').checked = all.config.autoUpdate !== false;
  $('syncEnabled').checked = all.config.syncEnabled !== false; $('wowEnabled').checked = all.config.wowEnabled !== false; $('autostart').checked = all.autostart; $('version').textContent = `Version ${all.version}`;
  configurePresentation();
  gameFields(); entries = all.logs.slice(-300); renderLogs(); renderState({state:all.state,health:all.health,update:all.update,savedFile:all.savedFile});
  showUsedPages(null);
  // Owner's answer 4: Link everything opens on every start until setup is done (Skip lasts this run).
  showPage(new URLSearchParams(location.search).get('tab') || (!setupDone(all.config) && !linkSkipped() ? 'link' : 'status'));
  api.onState(renderState); api.onLog(addLog);
  setInterval(() => { if (lastSnapshot) renderState(lastSnapshot); },1000);
}
init().catch(error => toast(error.message,true));
