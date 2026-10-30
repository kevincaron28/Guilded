const languageUI = window.companionLanguage;
const T = (key, ...values) => languageUI.t(key, ...values);
const M = value => languageUI.message(value);
const $ = id => document.getElementById(id);
const api = window.companion;
window.addEventListener('online', () => { if (!api.browser) void api.recoverSync?.().catch(() => {}); });
const desktopNavigation = matchMedia('(min-width:1001px)');
function closeNavigation() { document.body.classList.remove('nav-open'); $('btnNav').setAttribute('aria-expanded','false'); $('navBackdrop').hidden = true; document.querySelector('.sidebar').inert = !desktopNavigation.matches; document.querySelector('.workspace').inert = false; }
$('btnNav').addEventListener('click', () => { const open = $('btnNav').getAttribute('aria-expanded') !== 'true'; if (!open) { closeNavigation(); return; } document.body.classList.add('nav-open'); $('btnNav').setAttribute('aria-expanded','true'); $('navBackdrop').hidden = false; document.querySelector('.sidebar').inert = false; document.querySelector('.workspace').inert = true; document.querySelector('.nav.active').focus(); });
$('navBackdrop').addEventListener('click',closeNavigation);
document.addEventListener('keydown',event => {
  if (event.key !== 'Tab' || !document.body.classList.contains('nav-open')) return;
  const focusable = [...document.querySelectorAll('.sidebar button, .sidebar a[href]')].filter(element => !element.hidden);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('keydown',event => { if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { closeNavigation(); $('btnNav').focus(); } });
desktopNavigation.addEventListener('change',closeNavigation);
const modeLabel = mode => T(({STANDARD:'Trade / Standard', HARDCORE:'Hardcore', SSF:'Solo self-found', SSF_HARDCORE:'Solo self-found Hardcore'})[mode] || mode || '');
const fields = ['uploadUrl','guildDiscordId','pairingCode','watchFile','realm','wowGuild','standingsIntervalMinutes','poeLogFile','poeCharacter','poeLeague','poeMode'];
const names = {status:'Overview',wishlist:'Wishlist',cores:'Roster & loot settings',pricing:'Raid prices',leaderboards:'Leaderboards',wow:'World of Warcraft',poe:'PoE2 mapping',settings:'Connection & setup',activity:'Activity',help:'Help & privacy'};
let lastSnapshot;
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
function showPage(name) {
  if (!names[name]) name = 'status';
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
const bind = (id, task) => $(id).addEventListener('click', event => action(event.currentTarget, task));
const readForm = () => ({...Object.fromEntries(fields.map(id => [id,$(id).value.trim()])), wowEnabled:$('wowEnabled').checked, poeEnabled:$('poeEnabled').checked, ...(!api.browser ? {syncEnabled:$('syncEnabled').checked} : {})});
const say = (message, ok) => { $('formResult').textContent = M(message); $('formResult').className = `result ${ok ? 'ok' : 'bad'}`; };
function gameFields() { $('wowSettings').hidden = !$('wowEnabled').checked; $('poeSettings').hidden = !$('poeEnabled').checked; }
['wowEnabled','poeEnabled'].forEach(id => $(id).addEventListener('change',gameFields));
function pill(id, text, level) { $(id).textContent = text; $(id).className = `pill ${level || ''}`; }
function renderUpdate(update) {
  $('updateBanner').hidden = !update || !!api.browser;
  if (!update) return;
  $('updateTitle').textContent = T("Guilded Companion {0} is available", update.version);
  $('updateText').textContent = T("You have {0}. {1}: your settings and Discord link are kept.", $('version').textContent.replace(/^Version /, ''), update.installer ? T("Update now installs it and restarts the companion") : T("Download the new installer and run it"));
}
// Launch day (companion/live-folder.mjs, installed app only): the watched folder with its last
// upload and file change (amber after 3 days without a change), and the live game's folder to
// switch to when WoW saves somewhere else. In French when Windows is.
function liveText() { return {
  status: (running, folder, upload, changed) => running
    ? T("Watching {0} · last upload {1} · file changed {2}", folder, upload, changed)
    : T("Selected folder: {0} · last upload {1} · file changed {2}", folder, upload, changed),
  stale: T(" · over 3 days without a change: is WoW saving somewhere else?"),
  missing: T("never (not saved yet)"),
  betaTitle: T("Your companion is still watching the beta folder"),
  staleTitle: days => T("Your saved file has not changed in {0} days", days),
  text: (file, folder, account, changed) => T("{0} in {1} (account {2}) changed {3}. Switch so your uploads keep going.", file, folder, account, changed),
  switchButton: T("Switch to the live game folder"),
  keepButton: T("Keep this folder"),
  switched: path => T("Switched. Now watching {0}", path),
  notStarted: T("Switched, but the companion could not start. See the Activity page."),
  kept: T("Kept. You will not be asked about this file again.")
}; }
function since(iso) { return ago(iso).toLowerCase(); }
function renderSavedFile(snapshot) {
  const file = snapshot.savedFile, candidate = file?.candidate, watched = snapshot.state.watching || savedConfig.watchFile;
  const show = !api.browser && savedConfig.wowEnabled !== false && !!file && !!watched;
  $('watchStatus').hidden = !show; $('liveBanner').hidden = !show || !candidate;
  if (!show) return;
  $('watchStatus').textContent = liveText().status(snapshot.state.running, watched.replace(/[\\/][^\\/]*$/, ''), since(snapshot.state.lastUpload?.at), file.changedAt ? since(file.changedAt) : liveText().missing) + (file.stale ? liveText().stale : '');
  $('watchStatus').classList.toggle('stale', file.stale);
  if (!candidate) return;
  $('liveTitle').textContent = candidate.reason === 'beta' ? liveText().betaTitle : liveText().staleTitle(Math.floor((Date.now() - Date.parse(file.changedAt)) / 86400000));
  $('liveText').textContent = liveText().text(candidate.path.split(/[\\/]/).pop(), candidate.gameFolder, candidate.account, since(candidate.changedAt));
}
function renderState(snapshot) {
  lastSnapshot = snapshot;
  if ($('profileSyncStatus')) $('profileSyncStatus').textContent = (snapshot.state.profiles || []).map(p => p.name + ': ' + M(p.error || (p.running ? 'Syncing' : p.enabled ? 'Setup needed' : 'Paused'))).join(' · ');
  const {state,health} = snapshot;
  const sync = window.guildedSyncStatus(savedConfig, state, state.syncEvidence);
  let evidencePanel = $('syncEvidence');
  if (!evidencePanel) { evidencePanel = document.createElement('p'); evidencePanel.id = 'syncEvidence'; evidencePanel.className = 'panel'; $('page-activity').insertBefore(evidencePanel, $('log')); }
  evidencePanel.textContent = T('Saved: {0} · Uploaded: {1} · Received by bot: {2}', sync.saved.at ? ago(sync.saved.at) : T('Unknown'), sync.uploaded.at ? ago(sync.uploaded.at) : T('Unknown'), sync.accepted.at ? ago(sync.accepted.at) : T('Unknown')) + ' · ' + T('Receipt does not mean officer approval.');
  const syncActions = {
    'save-in-game': 'Use /reload in WoW to save your addon data.',
    'wait-for-upload': api.browser ? 'Choose Sync now to upload your saved data.' : 'Keep tracking enabled while your saved data uploads.',
    'wait-for-acceptance': 'Check Activity for the bot receipt before retrying.',
    'reload-in-game': 'After saving standings to the addon, use /reload in WoW.',
    'officer-review': 'Your upload needs officer review in Discord.',
    'review-application-error': 'Your upload was received but could not be applied. Ask an officer to review it.',
    'wait-for-retry': 'Keep the companion open while it retries.',
    'check-connection': 'Check your connection and the Activity messages.'
  };
  evidencePanel.textContent += ' · ' + T('Edition: {0} · Character: {1} · Saved-data source: {2}', sync.edition === 'unknown' ? T('Unknown') : sync.edition, sync.character || T('Unknown'), sync.folder || sync.watchedFile || state.watching || T('Unknown')) + ' · ' + T(syncActions[sync.action]);
  renderUpdate(snapshot.update);
  renderSavedFile(snapshot);
  const overview = window.guildedOverview(savedConfig,state,!!api.browser);
  $('overviewConnection').textContent = M(overview.connection);
  $('overviewTracking').textContent = M(overview.tracking);
  $('overviewFiles').textContent = overview.selectedFiles ? (overview.selectedFiles === 1 ? T('1 selected source') : T('{0} selected sources', overview.selectedFiles)) : T('Choose your game files');
  $('overviewStandings').textContent = M(overview.standings);
  $('overviewStandingsTime').textContent = state.lastStandings ? ago(state.lastStandings.at) : T("A connection is not a completed sync.");
  $('overviewNext').firstChild.textContent = M(overview.nextAction) + ' →';
  $('btnUpload').hidden = !overview.linked;
  $('btnUpload').disabled = !overview.canSync || $('btnUpload').dataset.busy === 'true';
  const linked = !!savedConfig.companionCredential;
  const paused = !api.browser && linked && !state.running && health.text === 'Not running';
  const setup = health.level === 'setup' && health.text === 'Setup needed';
  $('banner').className = `banner ${paused ? 'setup' : health.level}`;
  $('bannerTitle').textContent = paused ? T("Tracking paused") : setup ? T("Let's get you connected") : health.level === 'ok' ? api.browser ? T("Ready to sync on your terms") : T("Connected and ready for adventure") : health.level === 'error' ? T("Your sync needs attention") : T("Waiting to sync");
  $('bannerText').textContent = paused ? T("Resume tracking in Connection & setup when you are ready.") : setup ? T("Addon-only guild? You do not need to connect. With the Guilded bot or for public leaderboards, connect your account and choose your games.") : M(health.text);
  $('setupBadge').hidden = !setup;
  pill('connectionPill', setup ? T("Setup needed") : paused ? T("Paused") : health.level === 'ok' ? T("Connected") : T("Needs attention"),health.level === 'ok' ? 'ok' : health.level === 'error' ? 'error' : 'gold');
  pill('pairBadge', linked ? T("Discord linked") : T("Discord not linked"),linked ? 'ok' : '');
  $('removePanel').hidden = !!api.browser && !linked;
  $('versions').textContent = `Bot ${state.botVersion || T("not connected")}${savedConfig.wowEnabled !== false && state.addonVersion ? ` · Addon ${state.addonVersion}` : ''}`;
  $('tileUpload').textContent = state.lastUpload ? ago(state.lastUpload.at) : T("Awaiting your first sync");
  $('tileUploadNote').textContent = M(state.lastUpload?.message) || T("Save fresh addon data with /reload.");
  $('tileStandings').textContent = state.lastStandings ? ago(state.lastStandings.at) : T("Awaiting first refresh");
  $('tileStandingsNote').textContent = M(state.lastStandings?.message) || T("Synced from the Discord bot");
  $('tileCount').textContent = String(state.uploads || 0);
  $('tileWatch').textContent = state.watching || savedConfig.watchFile || T("No saved-data file selected");
  pill('wowFileState',state.watching || savedConfig.watchFile ? T("File selected") : T("Choose a file"),state.watching ? 'ok' : '');
  pill('wowBadge',savedConfig.wowEnabled === false ? T("Sync off") : state.uploadError || sync.phase === 'apply-error' ? T("Needs attention") : sync.phase === 'officer-review' ? T('Awaiting officer review') : sync.phase === 'synced' ? T("Synced") : state.watching ? api.browser ? T("Ready to sync") : T("Watching") : T("Not configured"),state.uploadError || sync.phase === 'apply-error' ? 'error' : sync.phase === 'officer-review' ? 'gold' : sync.phase === 'synced' || state.watching ? 'ok' : '');
  const poe = state.poe;
  pill('poeBadge',!savedConfig.poeEnabled ? T("Tracking off") : poe?.error ? T("Needs attention") : poe?.pending ? T("Ready to sync") : api.browser ? T("Manual sharing") : poe?.running ? T("Watching") : T("Set up tracking"),poe?.error ? 'error' : poe?.running ? 'ok' : poe?.pending ? 'gold' : '');
  const areaName = poe?.currentArea?.replace(/^Map/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  $('poeCurrent').textContent = areaName || T("Waiting for your next map");
  $('poeStatus').textContent = M(poe?.error) || M(poe?.warning) || (poe ? T("{0} observations waiting{1}", poe.pending || 0, poe.lastSync ? T(" · synced {0}", ago(poe.lastSync).toLowerCase()) : '') : T("Enable map sharing in setup when you are ready."));
  $('poeLiveArea').textContent = areaName || T("Waiting for your next map");
  const elapsed = poe?.running && poe.currentStartedAt ? Math.floor((Date.now() - Date.parse(poe.currentStartedAt)) / 1000) : null;
  $('poeElapsed').textContent = elapsed === null ? T("No open map visit") : elapsed < 0 || elapsed > 21600 ? T("Elapsed time unknown — check game activity and clock") : T("{0}m {1}s elapsed since generation", Math.floor(elapsed / 60), elapsed % 60);
  $('poeToday').textContent = String(poe?.todayMaps || 0);
  $('poeLastActivity').textContent = ago(poe?.lastActivity);
  $('poeCaptureNote').textContent = M(poe?.error) || M(poe?.warning) || (poe?.catchingUp ? T("Catching up with recent log activity…") : poe?.running ? T("Watching for supported area and disconnect events.") : T("Tracking paused or not configured."));
  $('poeProfile').textContent = savedConfig.poeCharacter || T("Not set");
  $('poeLeagueLabel').textContent = savedConfig.poeLeague ? `${savedConfig.poeLeague} · ${modeLabel(savedConfig.poeMode || 'STANDARD')}` : T("Choose a character, league and mode");
  $('poePending').textContent = String(poe?.pending || 0);
  $('poeSyncTime').textContent = poe?.lastSync ? T("Last synced {0}", ago(poe.lastSync).toLowerCase()) : T("No visits synced yet");
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
    'watchFile:placeholder': api.browser && api.folderAccess ? T("Choose your SavedVariables folder") : T("Choose GuildedDungeons.lua or Guilded.lua"),
    detectNote: T("World of Warcraft / WTF / Account / your account / SavedVariables: the companion reads GuildedDungeons.lua and Guilded.lua there, whichever addon you use."),
    btnWowSelect: api.browser && api.folderAccess ? T("Choose SavedVariables folder") : T("Choose saved data"),
    wowStep2: api.browser ? T("After /reload, click Sync now: your finished dungeon runs go to the public leaderboards.") : T("The companion notices the saved-file change and sends your finished dungeon runs to the public leaderboards."),
    wowStep3: T("Refresh public scores, then /reload and use /gdungeons score. In the browser, save Accepted.lua to Interface / AddOns / GuildedDungeons. Public and guild scores may differ."),
    btnStandings: api.browser ? T("Save public scores to addon") : T("Refresh public scores")
  };
  for (const key of MODE_TEXT) write(key, personal ? leaderboard[key] : modeDefaults[key]);
  $('btnStandings').hidden = false;
  $('connectedAs').hidden = !linked;
  $('connectedAs').textContent = !linked ? '' : personal
    ? T("Connected: public dungeon leaderboards only. Your finished runs are sent; no guild data.")
    : T("Connected: your guild's Discord{0}. Your saved data is synced and standings come back to the addon.", savedConfig.guildDiscordId ? T(" (server {0})", savedConfig.guildDiscordId) : '');
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
async function choosePoe() { const file = await api.browsePoeLog(readForm()); if (file) { $('poeLogFile').value = file; toast(api.browser ? T("Log preview ready. Review your profile and save your setup before syncing.") : T("PoE2 log selected. Save your setup to apply it.")); } }
['btnBrowse','btnWowSelect'].forEach(id => bind(id,chooseWow)); ['btnPoeBrowse','btnPoeSelect'].forEach(id => bind(id,choosePoe));
bind('btnDetect',async () => { $('detectNote').textContent = T("Looking for your addon data…"); const found = await api.detectWow(); if (found.length) { $('watchFile').value = found[0].path; $('detectNote').textContent = found.length > 1 ? T("Found {0} accounts. Check the selected file before saving.", found.length) : found[0].exists ? T("Found your addon data.") : (savedConfig.personal ? T("Account found. Use /reload with Guilded Dungeons (or Guilded) enabled to create its saved file.") : T("Account found. Use /reload with the addon enabled to create Guilded.lua.")); } else $('detectNote').textContent = (savedConfig.personal ? T("Choose Browse and select GuildedDungeons.lua or Guilded.lua in your account’s SavedVariables folder.") : T("Choose Browse and select Guilded.lua in your account’s SavedVariables folder.")); });
bind('btnLiveSwitch',async () => { const result = await api.switchLiveFolder(); if (!result.path) return; savedConfig = (await api.getAll()).config; $('watchFile').value = savedConfig.watchFile || ''; toast(result.ok ? liveText().switched(result.path) : liveText().notStarted,!result.ok); });
bind('btnLiveKeep',async () => { await api.dismissLiveFolder(); toast(liveText().kept); });
bind('btnTest',async () => { say(T("Checking your connection…"),true); const result = await api.testConnection(readForm()); say(result.message,result.ok); });
bind('btnPair',async () => { if (!$('pairingCode').value.trim()) { say(T("Paste the code from /character pair (or from guilded.kcaron.top/me/) first, or use Sign in with Discord."),false); $('pairingCode').focus(); return; } say(T("Connecting your Discord account…"),true); const result = await api.pairAccount(readForm()); say(result.message,result.ok); if (result.ok) { $('pairingCode').value = ''; savedConfig = (await api.getAll()).config; $('guildDiscordId').value = savedConfig.guildDiscordId || ''; renderState(lastSnapshot); toast(T("Discord account connected.")); } else if (/server ID/i.test(result.message)) { $('advanced').open = true; $('guildDiscordId').focus(); } });
// Sign in with Discord (7.2): the browser opens the website; the companion waits for the approval.
bind('btnSignIn',async () => { const popup = api.browser ? window.open('', '_blank') : null; say(T("Opening Discord sign-in…"),true); const started = await api.signInStart(readForm()); if (!started.ok) { popup?.close(); say(started.message,false); return; } if (started.url) { $('signInLink').href = started.url; if (popup) { popup.opener = null; popup.location.href = started.url; } } $('signInCode').textContent = started.confirm; $('signInCodeLine').hidden = !!started.automatic; $('signInWaiting').hidden = false; say(started.automatic ? T("Your browser opened. Choose your server there and press Connect.") : T("Your browser opened. Type {0} on the sign-in page.", started.confirm),true); const result = await api.signInWait(); $('signInWaiting').hidden = true; say(result.message,result.ok); if (result.ok) { savedConfig = (await api.getAll()).config; $('guildDiscordId').value = savedConfig.guildDiscordId || ''; $('uploadUrl').value = savedConfig.uploadUrl || ''; renderState(lastSnapshot); toast(T("Discord account connected.")); } });
bind('btnSignInCancel',async () => { await api.signInCancel(); $('signInWaiting').hidden = true; say(T("Sign-in cancelled."),false); });
$('form').addEventListener('submit',event => { event.preventDefault(); action($('btnSave'),async () => { say(T("Saving your preferences…"),true); const result = await api.saveConfig(readForm()); say(result.message,result.ok); savedConfig = (await api.getAll()).config; renderState(lastSnapshot); if (result.ok) { toast(result.message); showPage('status'); } }); });
$('autostart').addEventListener('change',event => action(event.target,async () => { $('autostart').checked = await api.setAutostart(event.target.checked); }));
bind('btnConnections', () => api.openConnections ? api.openConnections() : window.open('/me/connections','_blank','noopener'));
bind('btnBattleNet', () => api.openBattleNet ? api.openBattleNet() : window.open('/me/battlenet','_blank','noopener'));
bind('btnUpload',async () => { await api.uploadNow(); toast(api.browser ? T("Sync finished. Check Activity for the result.") : T("Sync requested. Follow its progress in Activity.")); });
bind('btnStandings',async () => { await api.refreshStandings(); toast(savedConfig.personal ? T("Public score refresh finished. Check Activity, then /reload and use /gdungeons score.") : api.browser ? api.folderAccess ? T("Standings saved. Use /reload in WoW.") : T("Standings downloaded. Add the file to Interface / AddOns / Guilded.") : T("Standings refresh finished. Check Activity for the result.")); });
bind('btnSheets',async () => { const result = await api.exportSheets($('sheetTable').value || undefined); if (!result.canceled) toast(result.message,!result.ok); });
$('grmPanel').hidden = typeof api.convertGRM !== 'function';
bind('btnGRM', async () => {
  if (!api.convertGRM) return;
  const result = await api.convertGRM({ guild: $('grmGuild').value, realm: $('grmRealm').value, edition: $('grmEdition').value, includePrivate: $('grmPrivate').checked });
  if (!result.canceled) { $('grmResult').textContent = M(result.message); toast(result.message, !result.ok); }
});
bind('btnFolder',() => api.openAddonFolder()); bind('btnPause',async () => { await api.toggleTracking(); const all = await api.getAll(); savedConfig = all.config; $('syncEnabled').checked = all.config.syncEnabled !== false; }); bind('btnOnline',() => api.openOnline());
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
// Update now (7.2): the desktop app downloads, checks and installs the new version itself.
bind('btnStoreUpdates', () => api.openUpdate());
bind('btnStoreStartup', () => api.openStartupSettings());
bind('btnUpdate',async () => {
  if (!api.installUpdate) return api.openUpdate();
  $('btnUpdate').textContent = T("Checking update…");
  let result;
  try { result = await api.installUpdate(); toast(result.message,!result.ok); }
  finally { $('btnUpdate').textContent = result?.ok && result.action === 'installing' ? T("Installing…") : T("Update now"); }
});
api.onUpdateProgress?.(percent => { $('btnUpdate').textContent = T("Downloading {0}%", percent); });
bind('btnHistory',async () => {
  if (!savedConfig.companionCredential) { showPage('settings'); toast(T("Connect your Discord account first.")); return; }
  const visits = await api.getPoeRuns();
  if (!visits.length) { toast(T("No map observations saved yet.")); return; }
  $('poeHistory').replaceChildren(); $('poeHistory').className = 'history-list';
  for (const visit of visits) { const row = document.createElement('div'); row.className = 'history-row'; const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = T("{0} · Level {1}", visit.areaName || visit.areaId, visit.areaLevel); const note = document.createElement('p'); note.textContent = `${visit.character} · ${visit.league} · ${modeLabel(visit.mode)} · ${visit.durationSeconds === null ? T("Duration unknown") : T("{0}m {1}s observed", Math.floor(visit.durationSeconds / 60), visit.durationSeconds % 60)}`; const time = document.createElement('time'); time.dateTime = visit.startedAt; time.textContent = new Date(visit.startedAt).toLocaleString(languageUI.language, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); info.append(title,note); row.append(info,time); $('poeHistory').append(row); }
});
bind('btnDiagnostics',async () => { const state = lastSnapshot?.state || {}; const summary = window.guildedSyncDiagnosticPreview(savedConfig, state, state.syncEvidence); $('diagnosticContent').textContent = JSON.stringify(summary,null,2); $('diagnosticPreview').showModal(); });
bind('btnCancelDiagnostics',async () => $('diagnosticPreview').close());
bind('btnSaveDiagnostics',async () => { const url = URL.createObjectURL(new Blob([$('diagnosticContent').textContent],{type:'application/json'})); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Guilded-support-summary.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); $('diagnosticPreview').close(); toast(T("Support summary saved without credentials, account IDs or file paths.")); });
function setTheme(light) { document.body.classList.toggle('light',light); $('btnTheme').setAttribute('aria-label',light ? T("Switch to dark theme") : T("Switch to light theme")); try { localStorage.setItem('guilded.companion.theme',light ? 'light' : 'dark'); } catch { /* theme still applies */ } }
try { setTheme(localStorage.getItem('guilded.companion.theme') === 'light'); } catch { /* use dark */ }
$('btnTheme').addEventListener('click',() => setTheme(!document.body.classList.contains('light')));
function configurePresentation() {
  for (const key of MODE_TEXT) { const [id, attribute] = key.split(':'); const value = T(languageUI.original(id, attribute)); if (attribute) $(id)[attribute] = value; else $(id).textContent = value; }
  modeDefaults = null;
  if (api.browser) {
    $('appMode').textContent = T("Online companion"); $('footerMode').textContent = T("Manual file sync · Personal pairing"); $('sideNote').textContent = T("No installation needed.");
    $('poeMetricLabel').textContent = T("Latest log area");
    ['autostartLabel','btnDetect','btnFolder','btnPause','addressLabel','standingsIntervalLabel','btnOnline','poeLive'].forEach(id => $(id).hidden = true);
    $('btnSave').textContent = T("Save preferences"); $('btnStandings').textContent = T("Download standings"); $('btnRemoveData').textContent = T("Disconnect this device"); $('removeTitle').textContent = T("Disconnect this browser"); $('removeNote').textContent = T("Revokes this Discord link and clears this browser’s saved connection, folders and queued observations. Sync pending visits first.");
    $('wowModeNote').textContent = T("Browser files are snapshots. After /reload, choose Guilded.lua again and use Sync now.");
    $('sheetNote').textContent = T("Your browser downloads one CSV file per table. If it asks, allow multiple downloads.");
    $('wowStep2').textContent = T("Select Guilded.lua and choose Sync now. Your raw Lua file is parsed on your device.");
    $('wowStep3').textContent = T("Download Standings.lua, place it in Interface / AddOns / Guilded, then /reload.");
    $('poeModeNote').textContent = T("Manual import previews completed transitions from the latest 24 hours in the last 8 MB of your log. Only select a log from the declared character and league. Choose the updated file again after playing.");
    $('poeFileNote').textContent = T("Latest 24 hours only. Review your declared character and league before syncing.");
    if (api.folderAccess) {
      $('btnWowSelect').textContent = T("Choose SavedVariables folder"); $('btnBrowse').textContent = T("Choose folder");
      $('btnStandings').textContent = T("Save standings to addon");
      $('wowModeNote').textContent = T("Choose SavedVariables and your Guilded addon folder once on this PC. After /reload, Sync now uploads fresh data and updates standings when addon folder access is allowed. Reload again to see the standings in WoW. This browser remembers your folders; use Save standings to addon if it needs permission again. Nothing syncs after you close the page.");
      $('wowStep2').textContent = T("After /reload, click Sync now to read the latest Guilded.lua from your chosen folder.");
      $('wowStep3').textContent = T("First time: Save standings to addon and choose Interface / AddOns / Guilded. Future Sync now clicks update standings too. Then /reload in WoW.");
      let forget = $('btnForgetFolders');
      if (!forget) { forget = document.createElement('button'); forget.id = 'btnForgetFolders';
      forget.addEventListener('click', () => action(forget, async () => { await api.forgetFiles(); $('watchFile').value = ''; savedConfig.watchFile = ''; renderState(lastSnapshot); toast(T("Saved folder choices cleared. Browser permission grants can also be removed in site settings.")); }));
      $('btnStandings').after(forget);
      }
      forget.textContent = T("Forget selected folders");
    }
  } else { $('watchFile').removeAttribute('readonly'); $('poeLogFile').removeAttribute('readonly'); }
  $('btnLiveSwitch').textContent = liveText().switchButton;
  $('btnLiveKeep').textContent = liveText().keepButton;
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
  $('connectionProfile').replaceChildren(...data.profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = (p.defaultName ? T('Original connection') : p.name) + (p.gameEdition ? ' · ' + p.gameEdition : ''); return option; }));
  $('connectionProfile').value = data.active;
}
async function changeConnection(choice) {
  document.dispatchEvent(new CustomEvent('companion-connection-changing'));
  let result;
  try { result = await api.changeProfile(choice); }
  finally { document.dispatchEvent(new CustomEvent('companion-connection-changed')); }
  if (!result.ok) { toast(languageUI.message(result.message), true); await renderProfiles(); return; }
  const all = await api.getAll(); savedConfig = all.config;
  for (const id of fields) $(id).value = all.config[id] ?? '';
  $('syncEnabled').checked = all.config.syncEnabled !== false; $('backgroundSyncPanel').hidden = !!api.browser; $('wowEnabled').checked = all.config.wowEnabled !== false;
  $('poeEnabled').checked = all.config.poeEnabled === true;
  $('poeMode').value = all.config.poeMode || 'STANDARD';
  gameFields(); renderState({state:all.state,health:all.health,update:all.update,savedFile:all.savedFile});
  await renderProfiles(); toast(languageUI.message(result.message));
}
$('connectionProfile').addEventListener('change', () => changeConnection({ id: $('connectionProfile').value }));
document.addEventListener('companion-language', () => { void renderProfiles().catch(error => toast(error.message, true)); });
bind('btnAddProfile', async () => { await changeConnection({ name: $('newProfileName').value }); $('newProfileName').value = ''; });

async function init() {
  if (!api) { toast(T("The companion interface could not load. Please reload or reinstall."),true); return; }
  const all = await api.getAll(); savedConfig = all.config;
  await renderProfiles();
  if (!languageUI.explicit && ['en','fr'].includes(all.language)) languageUI.set(all.language, false);
  for (const id of fields) $(id).value = all.config[id] ?? '';
  $('storeDistribution').hidden = !all.storePackage;
  if (all.storePackage) $('autostartLabel').hidden = true;
  $('syncEnabled').checked = all.config.syncEnabled !== false; $('backgroundSyncPanel').hidden = !!api.browser; $('wowEnabled').checked = all.config.wowEnabled !== false; $('poeEnabled').checked = all.config.poeEnabled === true; $('poeMode').value = all.config.poeMode || 'STANDARD'; $('autostart').checked = all.autostart; $('version').textContent = `Version ${all.version}`;
  configurePresentation();
  gameFields(); entries = all.logs.slice(-300); renderLogs(); renderState({state:all.state,health:all.health,update:all.update,savedFile:all.savedFile});
  showPage(new URLSearchParams(location.search).get('tab') || (savedConfig.companionCredential ? 'status' : 'settings'));
  api.onState(renderState); api.onLog(addLog);
  setInterval(() => { if (lastSnapshot) renderState(lastSnapshot); },1000);
}
init().catch(error => toast(error.message,true));
