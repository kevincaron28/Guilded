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
let syncNote = null; // the "Syncing now." line is a progress note: it clears when the sync it announced ends
const endSyncNote = (now = Date.now()) => { if (!syncNote) return; const step = window.guildedSyncNote.syncNoteStep(syncNote, snapshot.state?.syncPhase, now); syncNote = step.note; if (step.clear) say(''); };
const startSyncNote = (message) => { say(message); syncNote = { startedAt: Date.now(), sawUploading: snapshot.state?.syncPhase === 'uploading' }; setTimeout(() => endSyncNote(), window.guildedSyncNote.SYNC_NOTE_GRACE_MS + 500); };
const say = (message, ok = true) => { syncNote = null; const notice = $('notice'); notice.textContent = message ? M(message) : ''; notice.hidden = !message; notice.dataset.ok = ok ? 'true' : 'false'; };

function render() {
  const status = window.guildedMainStatus({
    config: snapshot.config, state: snapshot.state || {}, problems: snapshot.problems || [], savedFile: snapshot.savedFile,
    addonAction: snapshot.addonAction, wowRunning: snapshot.addonAction?.blocked === 'wow-running', update: snapshot.update, updateNotice: snapshot.updateNotice, otherAccount: snapshot.otherAccount, me
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
  renderAccounts();
  const problems = snapshot.problems || [];
  $('noProblems').hidden = problems.length > 0;
  $('problemList').replaceChildren(...problems.map(problemItem));
  $('activity').replaceChildren(...logs.slice(-30).reverse().map((entry) => { const item = document.createElement('li'); item.textContent = `${new Date(entry.time).toLocaleTimeString(languageUI.language)} ${M(entry.message)}`; return item; }));
}
const element = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
// All problems: what is wrong, the server's reason when it gave one, and what to do.
function problemItem(problem) {
  const help = window.guildedProblemHelp(problem);
  const item = element('li');
  item.append(element('strong', words(help.title)));
  if (help.reason) item.append(element('span', T('Reason: {0}', M(help.reason)), 'note'));
  if (help.fix) item.append(element('span', words(help.fix), 'note'));
  return item;
}
// Advanced > WoW accounts: one switch per account (the first one is changed with Choose folder).
function renderAccounts() {
  const rows = snapshot.accountRows || [];
  $('accountsSection').hidden = !rows.length;
  const items = rows.map((row) => {
    const [key, ...values] = row.text;
    // "{0}: {1}" is an account and its error: the error is the part to translate.
    const shown = values.map((value, index) => (value && typeof value === 'object' && value.ago ? ago(value.ago) : key === '{0}: {1}' && index === 1 ? M(value) : value));
    return { file: row.file, on: row.on, first: row.first, text: T(key, ...shown) };
  });
  const wanted = items.length ? JSON.stringify(items) : '';
  // Redrawn only when something changed, so a state update never takes the focus from a switch.
  if (($('accountList').dataset.rows || '') === wanted) return;
  $('accountList').dataset.rows = wanted;
  $('accountList').replaceChildren(...items.map((row) => {
    const item = element('li'), label = element('label', undefined, 'check'), box = element('input');
    box.type = 'checkbox'; box.checked = row.on; box.disabled = row.first;
    box.onchange = async () => {
      box.disabled = true;
      try { await api.setAccount(row.file, box.checked); } catch (error) { $('accountsResult').textContent = M(error?.message) || T('This action could not be completed.'); }
      $('accountList').dataset.rows = 'stale';
      await reload();
    };
    label.append(box, ' ', row.text);
    item.append(label);
    return item;
  }));
}
// Choose folder: the saved answer, and (with several accounts) one button per account to pick another.
function showFolderAnswer(answer) {
  $('folderResult').textContent = answer?.message ? M(answer.message) : '';
  $('folderChoices').replaceChildren(...(answer?.accounts || []).map((entry) => {
    const item = element('li'), button = element('button', entry.chosen ? T('Watching') : T('Use this account'), 'small');
    button.type = 'button'; button.disabled = entry.chosen === true;
    button.onclick = () => run('use-wow-account', entry.path);
    item.append(button, ' ', `${entry.account} · ${entry.game} · ${entry.exists ? T('Saved {0}', ago(entry.savedAt)) : T('Nothing saved yet')}`);
    return item;
  }));
}
// Repair lists what each step did, under the button that was pressed.
const REPAIR_STATUS = { ok: 'OK', fixed: 'Fixed', 'needs-you': 'Needs you', failed: 'Failed' };
const TRANSLATED_VALUES = new Set(['The Guilded addon could not be installed: {0}', 'Settings not saved since {0}: {1}', 'Settings not saved since this start: {1}']);
function repairItem(result) {
  const [key, ...values] = result.text;
  const item = element('li'); item.dataset.status = result.status;
  item.append(element('strong', T(REPAIR_STATUS[result.status] || result.status)), ' · ', T(key, ...(TRANSLATED_VALUES.has(key) ? values.map((value) => (typeof value === 'string' ? M(value) : value)) : values)));
  return item;
}
async function runRepair(summary, list) {
  const buttons = [$('btnFind'), $('btnRepair')];
  for (const button of buttons) button.disabled = true;
  for (const id of ['findResult', 'repairResult']) $(id).textContent = '';
  for (const id of ['findList', 'repairList']) $(id).replaceChildren();
  summary.textContent = T('Checking…');
  try {
    const answer = await api.repair();
    summary.textContent = T('Repair: {0} fixed, {1} need you, {2} failed.', answer.summary.fixed, answer.summary.needsYou, answer.summary.failed);
    list.replaceChildren(...answer.results.map(repairItem));
  } catch (error) { summary.textContent = M(error?.message) || T('This action could not be completed.'); }
  for (const button of buttons) button.disabled = false;
  await reload();
}

// ---- actions: each one is an existing IPC call ----
async function run(action, value) {
  say('');
  try {
    switch (action) {
      case 'sign-in': return await runSignIn(false);
      case 'sign-in-switch': return await runSignIn(true);
      case 'pick-wow-folder': case 'use-wow-account': {
        const answer = action === 'pick-wow-folder' ? await api.pickWowFolder() : await api.useWowAccount(value);
        if (answer?.canceled) return;
        showFolderAnswer(answer);
        say(answer?.message, answer?.ok !== false);
        // Several accounts: the list to choose from is in Advanced.
        if (answer?.accounts?.length) showAdvanced(true, 'folderResult');
        await reload();
        return;
      }
      case 'install-addon': { const answer = await api.installAddon(); say(answer.message, answer.ok); return; }
      case 'retry': startSyncNote(T('Trying again.')); await api.recoverSync(); await api.uploadNow(); return;
      case 'sync-now': startSyncNote(T('Syncing now.')); await api.uploadNow(); return;
      case 'toggle-tracking': await api.toggleTracking(); return;
      case 'problems': showAdvanced(true, 'problemsSection'); return;
      case 'choose-server': showAdvanced(true, 'serverRow'); return;
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
  // The progress and the answer show on the main window.
  if (!$('advanced').hidden) showAdvanced(false);
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
  void loadClaimOffers();
}

// One-click claim: characters an earlier zero-setup install of this PC reported, offered once per install (Link them / Not now).
let claimOffers = [];
async function loadClaimOffers() {
  claimOffers = [];
  if (snapshot.config.companionCredential && !snapshot.config.personal) {
    try { const answer = await api.claimOffers(); claimOffers = answer?.ok ? answer.offers || [] : []; } catch { claimOffers = []; }
  }
  renderClaim();
}
function renderClaim() {
  const offer = claimOffers[0];
  $('claim').hidden = !offer;
  if (!offer) return;
  const name = me?.account?.displayName || me?.account?.username || '';
  $('claimText').textContent = T('Link these {0} characters to {1}?', offer.characters.length, name || T('your Discord account'));
  $('claimList').replaceChildren(...offer.characters.map((c) => { const item = document.createElement('li'); item.textContent = c.className ? `${c.name} · ${c.className}${c.level ? ' ' + c.level : ''}` : c.name; return item; }));
  $('claimTaken').textContent = offer.taken?.length ? T('Already linked to someone else: {0}. Ask an officer, or use "This isn\'t my character" in Discord.', offer.taken.join(', ')) : '';
}
async function answerClaim(action) {
  const offer = claimOffers[0];
  if (!offer) return;
  $('btnClaimLink').disabled = $('btnClaimLater').disabled = true;
  try {
    const answer = await api.claimOfferAnswer(offer.deviceId, action);
    if (answer?.ok) say(action === 'link' ? (answer.linked > 0 ? T('Linked to you.') : T('Nothing left to link: those characters are already linked, or were unlinked on purpose.')) : T('OK. We will not ask again for 7 days.'));
    else say(answer?.message || T('This action could not be completed.'), false);
    claimOffers = claimOffers.slice(answer?.ok ? 1 : 0);
  } catch (error) { say(error?.message || T('This action could not be completed.'), false); }
  $('btnClaimLink').disabled = $('btnClaimLater').disabled = false;
  renderClaim();
}
$('btnClaimLink').onclick = () => void answerClaim('link');
$('btnClaimLater').onclick = () => void answerClaim('later');
setInterval(() => void loadClaimOffers(), 10 * 60_000);
async function reload() {
  const all = await api.getAll();
  snapshot = { ...snapshot, accountRows: all.accountRows || [], otherAccount: all.otherAccount ?? null, config: all.config, state: all.state, problems: all.problems, savedFile: all.savedFile, addonAction: all.addonAction, update: all.update, updateNotice: all.updateNotice };
  storePackage = all.storePackage === true; version = all.version || '';
  logs = all.logs || logs;
  $('autostart').checked = all.autostart === true;
  $('autoUpdate').checked = all.config.autoUpdate !== false;
  render();
}

// ---- Advanced view ----
function showAdvanced(on, target) {
  $('home').hidden = on; $('advanced').hidden = !on;
  document.title = on ? T('Advanced') + ' · ' + T('Guilded Companion') : T('Guilded Companion');
  if (on) $('btnBack').focus(); else $('btnAdvanced').focus();
  // "See why" and friends land on their section, not at the top.
  if (on && target) $(target).scrollIntoView({ block: 'start' });
}
$('btnAdvanced').onclick = () => showAdvanced(true);
$('btnBack').onclick = () => showAdvanced(false);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('advanced').hidden) showAdvanced(false); });
$('btnSync').onclick = () => run('sync-now');
$('btnFolder').onclick = () => run('pick-wow-folder');
$('btnFind').onclick = () => runRepair($('findResult'), $('findList'));
$('btnRepair').onclick = () => runRepair($('repairResult'), $('repairList'));
$('btnReinstall').onclick = async () => { $('repairList').replaceChildren(); $('repairResult').textContent = T('Checking…'); const answer = await api.reinstallAddon(); $('repairResult').textContent = M(answer?.message) || ''; };
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
for (const id of ['language', 'advLanguage']) $(id).addEventListener('change', async (event) => { languageUI.set(event.target.value); await api.setLanguage?.(event.target.value); $('language').value = $('advLanguage').value = languageUI.language; render(); });
document.addEventListener('companion-language', () => { $('language').value = $('advLanguage').value = languageUI.language; });
// The companion process cannot see the network card: tell it, so "This PC is offline" is accurate.
const reportOnline = () => { void api.setOnline?.(navigator.onLine).catch(() => {}); };
window.addEventListener('online', () => { reportOnline(); void api.recoverSync?.().catch(() => {}); });
window.addEventListener('offline', reportOnline);
if (!navigator.onLine) reportOnline();

api.onState((next) => { snapshot = { ...snapshot, state: next.state, problems: next.problems, savedFile: next.savedFile, addonAction: next.addonAction, update: next.update, updateNotice: next.updateNotice, otherAccount: next.otherAccount, accountRows: next.accountRows || [] }; render(); endSyncNote(); });
api.onUpdateProgress?.((percent) => say(T('Downloading and checking the update: {0}%', percent)));
api.onLog((entry) => { logs = [...logs, entry].slice(-100); renderAdvanced(); });
$('language').value = $('advLanguage').value = languageUI.language;
reload().then(loadMe).catch((error) => say(error?.message || T('This action could not be completed.'), false));
// "Just now / 3 min ago" stays true while the window is open.
setInterval(render, 60_000);
