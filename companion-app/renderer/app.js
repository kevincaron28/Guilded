const $ = id => document.getElementById(id);
const api = window.companion;
const fields = ['uploadUrl','guildDiscordId','pairingCode','watchFile','realm','wowGuild','standingsIntervalMinutes','poeLogFile','poeCharacter','poeLeague','poeMode'];
const names = {status:'Overview',wow:'World of Warcraft',poe:'PoE2 mapping',settings:'Connection & setup',activity:'Activity',help:'Help & privacy'};
let lastSnapshot;
let savedConfig = {};
let entries = [];
let toastTimer;
function ago(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return 'Not yet';
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
function showPage(name) {
  if (!names[name]) name = 'status';
  document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== `page-${name}`);
  document.querySelectorAll('.nav').forEach(button => { const active = button.dataset.page === name; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = names[name];
  document.title = `${names[name]} · Guilded Companion`;
  window.scrollTo({top:0});
}
document.querySelectorAll('[data-page],[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page || button.dataset.go)));
function toast(message, error = false) {
  $('toast').textContent = message; $('toast').hidden = false; $('toast').classList.toggle('error',error); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000);
}
async function action(button, task) {
  button.disabled = true;
  try { return await task(); } catch (error) { toast(error.message || 'This action could not be completed.',true); }
  finally { button.disabled = false; }
}
const bind = (id, task) => $(id).addEventListener('click', event => action(event.currentTarget, task));
const readForm = () => ({...Object.fromEntries(fields.map(id => [id,$(id).value.trim()])), wowEnabled:$('wowEnabled').checked, poeEnabled:$('poeEnabled').checked});
const say = (message, ok) => { $('formResult').textContent = message; $('formResult').className = `result ${ok ? 'ok' : 'bad'}`; };
function gameFields() { $('wowSettings').hidden = !$('wowEnabled').checked; $('poeSettings').hidden = !$('poeEnabled').checked; }
['wowEnabled','poeEnabled'].forEach(id => $(id).addEventListener('change',gameFields));
function pill(id, text, level) { $(id).textContent = text; $(id).className = `pill ${level || ''}`; }
function renderState(snapshot) {
  lastSnapshot = snapshot;
  const {state,health} = snapshot;
  const linked = !!savedConfig.companionCredential;
  const paused = !api.browser && linked && !state.running && health.text === 'Not running';
  const setup = health.level === 'setup' && health.text === 'Setup needed';
  $('banner').className = `banner ${paused ? 'setup' : health.level}`;
  $('bannerTitle').textContent = paused ? 'Tracking paused' : setup ? "Let's get you connected" : health.level === 'ok' ? api.browser ? 'Ready to sync on your terms' : 'Connected and ready for adventure' : health.level === 'error' ? 'Your sync needs attention' : 'Waiting to sync';
  $('bannerText').textContent = paused ? 'Resume tracking in Connection & setup when you are ready.' : setup ? 'Connect your Discord account, choose your games and select their files.' : health.text;
  $('setupBadge').hidden = !setup;
  pill('connectionPill', setup ? 'Setup needed' : paused ? 'Paused' : health.level === 'ok' ? 'Connected' : 'Needs attention',health.level === 'ok' ? 'ok' : health.level === 'error' ? 'error' : 'gold');
  pill('pairBadge', linked ? 'Discord linked' : 'Discord not linked',linked ? 'ok' : '');
  $('versions').textContent = `Bot ${state.botVersion || 'not connected'}${savedConfig.wowEnabled !== false && state.addonVersion ? ` · Addon ${state.addonVersion}` : ''}`;
  $('tileUpload').textContent = state.lastUpload ? ago(state.lastUpload.at) : 'Awaiting your first sync';
  $('tileUploadNote').textContent = state.lastUpload?.message || 'Save fresh addon data with /reload.';
  $('tileStandings').textContent = state.lastStandings ? ago(state.lastStandings.at) : 'Awaiting first refresh';
  $('tileStandingsNote').textContent = state.lastStandings?.message || 'Synced from the Discord bot';
  $('tileCount').textContent = String(state.uploads || 0);
  $('tileWatch').textContent = state.watching || savedConfig.watchFile || 'No saved-data file selected';
  pill('wowFileState',state.watching || savedConfig.watchFile ? 'File selected' : 'Choose a file',state.watching ? 'ok' : '');
  pill('wowBadge',savedConfig.wowEnabled === false ? 'Sync off' : state.uploadError ? 'Needs attention' : state.lastUpload ? 'Synced' : state.watching ? 'Watching' : 'Not configured',state.uploadError ? 'error' : state.lastUpload || state.watching ? 'ok' : '');
  const poe = state.poe;
  pill('poeBadge',!savedConfig.poeEnabled ? 'Tracking off' : poe?.error ? 'Needs attention' : poe?.pending ? 'Ready to sync' : api.browser ? 'Manual sharing' : poe?.running ? 'Watching' : 'Set up tracking',poe?.error ? 'error' : poe?.running ? 'ok' : poe?.pending ? 'gold' : '');
  const areaName = poe?.currentArea?.replace(/^Map/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  $('poeCurrent').textContent = areaName || 'Waiting for your next map';
  $('poeStatus').textContent = poe?.error || poe?.warning || (poe ? `${poe.pending || 0} observations waiting${poe.lastSync ? ` · synced ${ago(poe.lastSync).toLowerCase()}` : ''}` : 'Enable map sharing in setup when you are ready.');
  $('poeLiveArea').textContent = areaName || 'Waiting for your next map';
  const elapsed = poe?.running && poe.currentStartedAt ? Math.floor((Date.now() - Date.parse(poe.currentStartedAt)) / 1000) : null;
  $('poeElapsed').textContent = elapsed === null ? 'No open map visit' : elapsed < 0 || elapsed > 21600 ? 'Elapsed time unknown — check game activity and clock' : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed since generation`;
  $('poeToday').textContent = String(poe?.todayMaps || 0);
  $('poeLastActivity').textContent = ago(poe?.lastActivity);
  $('poeCaptureNote').textContent = poe?.error || poe?.warning || (poe?.catchingUp ? 'Catching up with recent log activity…' : poe?.running ? 'Watching for supported area and disconnect events.' : 'Tracking paused or not configured.');
  $('poeProfile').textContent = savedConfig.poeCharacter || 'Not set';
  $('poeLeagueLabel').textContent = savedConfig.poeLeague ? `${savedConfig.poeLeague} · ${(savedConfig.poeMode || 'STANDARD').replaceAll('_',' ')}` : 'Choose a character, league and mode';
  $('poePending').textContent = String(poe?.pending || 0);
  $('poeSyncTime').textContent = poe?.lastSync ? `Last synced ${ago(poe.lastSync).toLowerCase()}` : 'No visits synced yet';
  $('btnPause').textContent = state.running ? 'Pause tracking' : 'Resume tracking';
}
function renderLogs() {
  $('log').replaceChildren();
  const query = $('logSearch').value.toLowerCase(); const filter = $('logFilter').value;
  const shown = entries.filter(entry => (filter === 'all' || entry.level === filter) && entry.message.toLowerCase().includes(query));
  $('activityCount').textContent = String(entries.length);
  if (!shown.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; const heading = document.createElement('h3'); heading.textContent = entries.length ? 'No matching activity' : "You're all caught up"; const note = document.createElement('p'); note.textContent = entries.length ? 'Try a different search or filter.' : 'Your sync activity will appear here.'; empty.append(heading,note); $('log').append(empty); return; }
  for (const entry of shown.slice().reverse()) {
    const row = document.createElement('div'); row.className = 'log-row';
    const time = document.createElement('time'); time.dateTime = entry.time; time.textContent = new Date(entry.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); time.title = new Date(entry.time).toLocaleString();
    const level = document.createElement('span'); level.className = `log-level ${['info','ok','warn','error'].includes(entry.level) ? entry.level : 'info'}`; level.textContent = entry.level === 'ok' ? 'Synced' : entry.level;
    const message = document.createElement('span'); message.className = 'log-message'; message.textContent = entry.message; row.append(time,level,message); $('log').append(row);
  }
}
function addLog(entry) { entries.push(entry); entries = entries.slice(-300); renderLogs(); }
$('logSearch').addEventListener('input',renderLogs); $('logFilter').addEventListener('change',renderLogs); $('btnClearLog').addEventListener('click',() => { entries = []; renderLogs(); });
async function chooseWow() { const file = await api.browseFile(); if (file) { $('watchFile').value = file; toast('WoW file selected. Save your setup to apply it.'); } }
async function choosePoe() { const file = await api.browsePoeLog(readForm()); if (file) { $('poeLogFile').value = file; toast(api.browser ? 'Log preview ready. Review your profile and save your setup before syncing.' : 'PoE2 log selected. Save your setup to apply it.'); } }
['btnBrowse','btnWowSelect'].forEach(id => bind(id,chooseWow)); ['btnPoeBrowse','btnPoeSelect'].forEach(id => bind(id,choosePoe));
bind('btnDetect',async () => { $('detectNote').textContent = 'Looking for your addon data…'; const found = await api.detectWow(); if (found.length) { $('watchFile').value = found[0].path; $('detectNote').textContent = found.length > 1 ? `Found ${found.length} accounts. Check the selected file before saving.` : found[0].exists ? 'Found your addon data.' : 'Account found. Use /reload with the addon enabled to create Guilded.lua.'; } else $('detectNote').textContent = 'Choose Browse and select Guilded.lua in your account’s SavedVariables folder.'; });
bind('btnTest',async () => { say('Checking your connection…',true); const result = await api.testConnection(readForm()); say(result.message,result.ok); });
bind('btnPair',async () => { say('Connecting your Discord account…',true); const result = await api.pairAccount(readForm()); say(result.message,result.ok); if (result.ok) { $('pairingCode').value = ''; savedConfig = (await api.getAll()).config; renderState(lastSnapshot); toast('Discord account connected.'); } });
$('form').addEventListener('submit',event => { event.preventDefault(); action($('btnSave'),async () => { say('Saving your preferences…',true); const result = await api.saveConfig(readForm()); say(result.message,result.ok); savedConfig = (await api.getAll()).config; renderState(lastSnapshot); if (result.ok) { toast(result.message); showPage('status'); } }); });
$('autostart').addEventListener('change',event => action(event.target,async () => { $('autostart').checked = await api.setAutostart(event.target.checked); }));
bind('btnUpload',async () => { await api.uploadNow(); toast(api.browser ? 'Sync finished. Check Activity for the result.' : 'Sync requested. Follow its progress in Activity.'); });
bind('btnStandings',async () => { await api.refreshStandings(); toast(api.browser ? 'Standings downloaded. Add the file to Interface / AddOns / Guilded.' : 'Standings refresh finished. Check Activity for the result.'); });
bind('btnFolder',() => api.openAddonFolder()); bind('btnPause',async () => { await api.toggleTracking(); }); bind('btnOnline',() => api.openOnline());
bind('btnRemoveData',() => api.removeData());
bind('btnHistory',async () => {
  if (!savedConfig.companionCredential) { showPage('settings'); toast('Connect your Discord account first.'); return; }
  const visits = await api.getPoeRuns();
  if (!visits.length) { toast('No map observations saved yet.'); return; }
  $('poeHistory').replaceChildren(); $('poeHistory').className = 'history-list';
  for (const visit of visits) { const row = document.createElement('div'); row.className = 'history-row'; const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${visit.areaName || visit.areaId} · Level ${visit.areaLevel}`; const note = document.createElement('p'); note.textContent = `${visit.character} · ${visit.league} · ${visit.mode.replaceAll('_',' ')} · ${visit.durationSeconds === null ? 'Duration unknown' : `${Math.floor(visit.durationSeconds / 60)}m ${visit.durationSeconds % 60}s observed`}`; const time = document.createElement('time'); time.dateTime = visit.startedAt; time.textContent = new Date(visit.startedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); info.append(title,note); row.append(info,time); $('poeHistory').append(row); }
});
bind('btnDiagnostics',async () => { const state = lastSnapshot?.state || {}; const summary = {product:'Guilded Companion',version:$('version').textContent,mode:api.browser ? 'browser' : 'desktop',generatedAt:new Date().toISOString(),wowEnabled:savedConfig.wowEnabled !== false,poeEnabled:!!savedConfig.poeEnabled,botVersion:state.botVersion,addonVersion:state.addonVersion,running:state.running,uploads:state.uploads,poePending:state.poe?.pending || 0,hasSyncError:!!(state.uploadError || state.standingsError || state.poe?.error)}; const url = URL.createObjectURL(new Blob([JSON.stringify(summary,null,2)],{type:'application/json'})); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Guilded-support-summary.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Support summary saved without credentials, account IDs or file paths.'); });
function setTheme(light) { document.body.classList.toggle('light',light); $('btnTheme').setAttribute('aria-label',light ? 'Switch to dark theme' : 'Switch to light theme'); try { localStorage.setItem('guilded.companion.theme',light ? 'light' : 'dark'); } catch { /* theme still applies */ } }
try { setTheme(localStorage.getItem('guilded.companion.theme') === 'light'); } catch { /* use dark */ }
$('btnTheme').addEventListener('click',() => setTheme(!document.body.classList.contains('light')));
async function init() {
  if (!api) { toast('The companion interface could not load. Please reload or reinstall.',true); return; }
  const all = await api.getAll(); savedConfig = all.config;
  for (const id of fields) $(id).value = all.config[id] ?? '';
  $('wowEnabled').checked = all.config.wowEnabled !== false; $('poeEnabled').checked = all.config.poeEnabled === true; $('poeMode').value = all.config.poeMode || 'STANDARD'; $('autostart').checked = all.autostart; $('version').textContent = `Version ${all.version}`;
  if (api.browser) {
    $('appMode').textContent = 'Online companion'; $('footerMode').textContent = 'Manual file sync · Personal pairing'; $('sideNote').textContent = 'No installation needed.';
    $('poeMetricLabel').textContent = 'Latest log area';
    ['autostartLabel','btnDetect','btnFolder','btnPause','addressLabel','standingsIntervalLabel','btnOnline','poeLive'].forEach(id => $(id).hidden = true);
    $('btnSave').textContent = 'Save preferences'; $('btnStandings').textContent = 'Download standings'; $('btnRemoveData').textContent = 'Disconnect this session'; $('removeTitle').textContent = 'End your online session'; $('removeNote').textContent = 'Revokes this Discord link and clears this tab’s settings and queued observations. Sync pending visits first.';
    $('wowModeNote').textContent = 'Browser files are snapshots. After /reload, choose Guilded.lua again and use Sync now.';
    $('wowStep2').textContent = 'Select Guilded.lua and choose Sync now. Your raw Lua file is parsed on your device.';
    $('wowStep3').textContent = 'Download Standings.lua, place it in Interface / AddOns / Guilded, then /reload.';
    $('poeModeNote').textContent = 'Manual import previews completed transitions from the latest 24 hours in the last 8 MB of your log. Only select a log from the declared character and league. Choose the updated file again after playing.';
    $('poeFileNote').textContent = 'Latest 24 hours only. Review your declared character and league before syncing.';
  } else { $('watchFile').removeAttribute('readonly'); $('poeLogFile').removeAttribute('readonly'); }
  gameFields(); entries = all.logs.slice(-300); renderLogs(); renderState({state:all.state,health:all.health});
  showPage(new URLSearchParams(location.search).get('tab') || 'status');
  api.onState(renderState); api.onLog(addLog);
  setInterval(() => { if (lastSnapshot) renderState(lastSnapshot); },1000);
}
init().catch(error => toast(error.message,true));
