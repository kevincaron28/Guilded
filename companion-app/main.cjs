const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, Notification, safeStorage, powerMonitor, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { detectSavedVariables, detectOtherEditionSavedVariables, pickSavedVariables, pickPrimaryAccount, pickerStart, accountsUnder, searchWow } = require("./detect-wow.cjs");
const updates = require("./update-check.cjs");
// Loaded on first use (Store build only): companion-app/store-update.cjs.
const storeUpdatesModule = () => require("./store-update.cjs");
const linkIdentity = require("./link-identity.cjs");
const addonInstallerModule = () => require("./addon-installer.cjs");
const diskSpaceModule = require("./disk-space.cjs");
const configLoadModule = () => require("./config-load.cjs");
const STORE_PACKAGE = process.windowsStore === true;
const STORE_UPDATES = "ms-windows-store://downloadsandupdates";
// The Store build never replaces itself: the Store does that. Also true for any package under WindowsApps.
const STORE_INSTALL = STORE_PACKAGE || /[\\/]WindowsApps[\\/]/i.test(String(process.execPath ?? "")); // same rule as updates.isStoreInstall
let storeConfig;
if (STORE_PACKAGE) {
  const storeDataDirectory = path.join(app.getPath("appData"), "Guilded Companion Store");
  fs.mkdirSync(storeDataDirectory, { recursive: true });
  app.setPath("userData", storeDataDirectory);
}
const i18n = require("./i18n.cjs");
let selectedLanguage;
const language = () => selectedLanguage || i18n.normalizeLanguage(app.getLocale());
const T = (key, ...values) => i18n.translate(language(), key, ...values);
const M = value => i18n.message(language(), value);
const E = (key, ...values) => i18n.translate("en", key, ...values);

// Guilded Companion: a tray app around companion/engine.mjs. The window is
// for setup and a look at what is happening; day to day it lives in the tray.

const DEFAULTS = {
  watchFile: "",
  wowEnabled: true,
  poeEnabled: false,
  poeLogFile: "",
  poeCharacter: "",
  poeLeague: "",
  poeMode: "STANDARD",
  realm: "WoW Forever",
  wowGuild: "",
  uploadUrl: "",
  guildDiscordId: "",
  uploadToken: "",
  pairingCode: "",
  companionCredential: "",
  standingsIntervalMinutes: 2,
  autoUpdate: true
};

// `electron .` includes the app path; an installed executable starts with its
// first option immediately after argv[0]. Keep --hidden on Windows login.
const args = process.argv.slice(process.defaultApp ? 2 : 1);
const startHidden = args.includes("--hidden");
const screenshotPath = (args.find((a) => a.startsWith("--screenshot=")) ?? "").slice("--screenshot=".length);
const screenshotTab = (args.find((a) => a.startsWith("--tab=")) ?? "").slice("--tab=".length);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// The installer asks a running companion to save and quit before it replaces any file
// (installer.nsh customCheckAppRunning). With no companion running there is nothing to do:
// never start one from that request.
const QUIT_FOR_UPDATE = "--quit-for-update";
// installer.nsh customInstall leaves this file next to the exe for the start it launches.
const INSTALLER_MARKER = typeof process.execPath === "string" ? path.join(path.dirname(process.execPath), "launched-by-installer") : "";
let launchedByInstaller = false;
try { if (INSTALLER_MARKER && fs.existsSync(INSTALLER_MARKER)) { launchedByInstaller = true; fs.rmSync(INSTALLER_MARKER, { force: true }); } } catch { /* diagnostics only */ }
// How many other Guilded Companion processes of this user run, not counting this one.
function otherCompanions() {
  if (process.platform !== "win32") return Promise.resolve(0);
  const name = path.basename(process.execPath);
  // Process id and parent id of every process with this exe name: Electron's own helpers (GPU,
  // network) share the name and are this process's children, so they do not count.
  const query = "Get-CimInstance Win32_Process -Filter \"Name='" + name.replace(/'/g, "") + "'\" | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId)\" }";
  return new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
    if (error) return resolve(0);
    resolve(require("./config-load.cjs").otherProcessCount(String(stdout), process.pid));
  }));
}
async function waitForOtherCompanions() {
  for (let waited = 0; waited <= 20; waited += 1) {
    const others = await otherCompanions();
    if (!others) { pushLog({ time: new Date().toISOString(), level: "info", message: E("No older companion is running; reading the settings.") }); return; }
    if (waited === 0) pushLog({ time: new Date().toISOString(), level: "info", message: E("Waiting for the older companion to close ({0} process(es))...", others) });
    await new Promise((done) => setTimeout(done, 1000));
  }
  pushLog({ time: new Date().toISOString(), level: "warn", message: E("The older companion is still running after 20 s; reading the settings anyway.") });
}
if (args.includes(QUIT_FOR_UPDATE)) { app.exit(0); process.exit(0); }

let win;
function registerIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const security = require("./ipc-security.cjs");
    security.assertSender(event, win, __dirname);
    security.validateIpc(channel, args);
    return handler(event, ...args);
  });
}
let tray;
let engine;
let engineModules;
let quitting = false;
let config = { ...DEFAULTS };
const logs = [];

const configFile = () => path.join(app.getPath("userData"), "config.secure");
const profileJournalFile = () => path.join(app.getPath("userData"), !config.activeProfile || config.activeProfile === "default" ? "poe-journal.json" : `poe-journal-${config.activeProfile}.json`);
const asset = (name) => path.join(__dirname, "assets", name);

// Settings at start (9.0): logged, backed up before any migration, restored from a backup when the
// file is missing, and never overwritten after a failed read (companion-app/config-load.cjs).
async function loadConfig() {
  // 9.1.3: a direct-download companion with no settings yet takes over the Store companion's, once.
  if (!STORE_PACKAGE) {
    try {
      require("./store-migrate.cjs").migrateStoreSettings({ userData: app.getPath("userData"), localAppData: process.env.LOCALAPPDATA, appData: process.env.APPDATA,
        log: (from, files) => pushLog({ time: new Date().toISOString(), level: "info", message: E("Settings, Discord sign-in and WoW folder were copied from the Microsoft Store version ({0}, {1} files). The Store copy was left as it is.", from, files.length) }) });
    } catch { /* nothing to import */ }
  }
  // 9.1.3: a direct-download companion with no settings yet takes over the Store companion's, once.
  if (!STORE_PACKAGE) {
    try {
      const moved = require("./store-migrate.cjs").migrateStoreSettings({ userData: app.getPath("userData"), localAppData: process.env.LOCALAPPDATA, appData: process.env.APPDATA,
        log: (from, files) => pushLog({ time: new Date().toISOString(), level: "info", message: E("Settings, Discord sign-in and WoW folder were copied from the Microsoft Store version ({0}, {1} files). The Store copy was left as it is.", from, files.length) }) });
      void moved;
    } catch { /* nothing to import */ }
  }
  const loaded = await configLoadModule().loadSavedConfig({
    store: storeConfig, file: configFile(), legacyFile: path.join(app.getPath("userData"), "config.json"),
    isStore: STORE_PACKAGE, defaults: DEFAULTS, version: app.getVersion(),
    log: (level, key, ...values) => { const message = E(key, ...values); pushLog({ time: new Date().toISOString(), level, message }); if (level !== "info") console.warn(message); }
  });
  config = loaded.config;
  if (loaded.source !== "none" || STORE_PACKAGE) return;
  // Carry over the command-line companion's settings when running from the repo.
  if (args.includes("--fresh")) return;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "companion", "companion.config.json"), "utf8"));
    config = { ...DEFAULTS, ...old };
    await saveConfig();
  } catch { /* nothing to import */ }
}

// Startup repair: a saved file picked in a character folder (…\Account\X\<realm>\<character>\SavedVariables)
// never holds GuildedDB, and a blank leftover connection only logs "Not started". Fix both, once, in every
// saved connection (companion/saved-folder.mjs, companion/profiles.mjs). Re-saving keeps the sign-in.
async function repairSavedConfig() {
  let changed = false;
  const paths = engineModules.migrateWatchFiles(config);
  if (paths.changed) {
    const before = config.watchFile;
    config = paths.config;
    changed = true;
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Saved-data folder corrected to the account folder: {0}.", config.watchFile || before) });
  }
  const pruned = engineModules.pruneBlankProfiles(config);
  if (pruned.changed) { config = pruned.config; changed = true; }
  if (changed) await saveConfig();
}

// Every save is logged step by step in startup.log (store-config.cjs); a failure also goes to Activity
// and to the Problems panel ("settings-not-saved").
function saveConfig() {
  const save = storeConfig.write(configFile(), config);
  save.then(() => noteSaveState(), (error) => {
    pushLog({ time: new Date().toISOString(), level: "error", message: E("Settings could not be saved: {0}", error instanceof Error ? error.message : String(error)) });
    noteSaveState();
  });
  return save;
}
let shownSaveState = "";
function settingsSaveState() {
  const status = storeConfig?.status?.() ?? {};
  return status.lastError || status.stuck ? { failed: Boolean(status.lastError), stuck: Boolean(status.stuck), step: status.stuck?.step ?? null } : null;
}
function noteSaveState() {
  const key = JSON.stringify(settingsSaveState());
  if (key === shownSaveState) return;
  shownSaveState = key;
  if (engine) onState(engine.state());
}
// Settings diagnostics: appended to startup.log in the data folder for the whole run (kept under 256 KB).
function settingsLog(line) {
  try {
    const target = path.join(app.getPath("userData"), "startup.log");
    let size = 0; try { size = fs.statSync(target).size; } catch { /* new file */ }
    if (size < 256 * 1024) fs.appendFileSync(target, `${new Date().toISOString()} settings ${line}
`);
  } catch { /* diagnostics only */ }
}

async function loadEngineModules() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(__dirname, "..", "companion");
  const url = (file) => pathToFileURL(path.join(dir, file)).href;
  const [engineModule, standingsModule, requestModule, sheetModule, liveFolderModule, addonInstallModule, wowFolderModule, activeGamesModule] = await Promise.all([import(url("engine.mjs")), import(url("standings.mjs")), import(url("request.mjs")), import(url("sheet-export.mjs")), import(url("live-folder.mjs")), import(url("addon-install.mjs")), import(url("wow-folder.mjs")), import(url("active-games.mjs"))]);
  return { ...engineModule, ...standingsModule, ...requestModule, ...await import(url("profile-engine.mjs")), ...await import(url("profiles.mjs")), ...await import(url("revoke.mjs")), ...await import(url("grm-migration.mjs")), sheetFiles: sheetModule.sheetFiles, checkSavedFile: liveFolderModule.checkSavedFile, checkInstalledAddon: addonInstallModule.checkInstalledAddon, isOtherEditionFolder: wowFolderModule.isOtherEditionFolder, poeTracking: activeGamesModule.POE_TRACKING_ENABLED, ...await import(url("saved-folder.mjs")), ...await import(url("problems.mjs")), ...await import(url("wow-accounts.mjs")), deviceSync: await import(url("device-sync.mjs")) };
}

// Start-up diagnostics (9.0 release blocker): every line logged before the window is ready also
// goes to startup.log in the data folder (appended, one header line per start, never holds a credential), so a
// start that shows the wrong settings can be explained from that one file.
let startupLogging = true;
function startupLog(entry) {
  if (!startupLogging) return;
  try { fs.appendFileSync(path.join(app.getPath("userData"), "startup.log"), `${entry.time} ${entry.level} ${entry.message}
`); } catch { /* diagnostics only */ }
}
function pushLog(entry) {
  startupLog(entry);
  logs.push(entry);
  if (logs.length > 300) logs.shift();
  win?.webContents.send("log", entry);
}

// What the tray icon and the window's header say about the whole app.
// Guilded's own outages read as amber "waiting", never red (8.5 Track L, link-identity.cjs).
function health(state) {
  return linkIdentity.companionHealth({ setupProblems: engineModules.validateConfig(config).length, state });
}

// A newer Guilded release, shown on Overview, in the tray and once as a Windows notification.
let update = null;
let latestRelease = null;

function refreshUpdate() {
  // Store build: only a Store update the API could not install itself shows the banner (F5).
  if (STORE_PACKAGE) { update = storePageUpdate; return; }
  const next = updates.pickUpdate(app.getVersion(), latestRelease);
  // Refresh provider metadata even for the same version; notification dedup is below.
  update = next;
  if (!update || config.updateNotifiedVersion === update.version) return;
  config.updateNotifiedVersion = update.version;
  // Silent updates install by themselves: no Windows notification for a version the member never has to act on.
  if (update.installer && autoUpdateOn()) return;
  void saveConfig().catch(error => pushLog({ time: new Date().toISOString(), level: "error", message: error.message }));
  if (!Notification.isSupported()) return;
  const notice = new Notification({
    title: T("Guilded Companion {0} is available", update.version),
    body: update.installer ? T("You have {0}. Click, then choose Update now.", app.getVersion()) : T("You have {0}. Click to open the download page.", app.getVersion()),
    icon: asset("icon.png")
  });
  notice.on("click", () => { if (update?.installer && win) { win.show(); win.focus(); } else void shell.openExternal(update?.url || updates.RELEASES_PAGE); });
  notice.show();
}

// Free disk space (9.0): an update or addon install needs about 600 MB on every drive involved
// (companion-app/disk-space.cjs). When it is short the Problems panel says so and nothing starts.
let diskSpace = null; // the low result, or null when there is enough
function checkDisk(extra = []) {
  const folder = (target) => typeof target === "string" && target ? path.dirname(target) : null;
  const appPath = (name) => { try { return app.getPath(name); } catch { return null; } };
  const result = diskSpaceModule.checkDiskSpace({ paths: [folder(process.execPath), appPath("temp"), appPath("userData"), folder(config.watchFile), ...extra] });
  const next = result.ok ? null : result;
  const changed = (next?.freeMb ?? null) !== (diskSpace?.freeMb ?? null);
  diskSpace = next;
  if (changed && engine) onState(engine.state());
  return result;
}
const lowDiskMessage = (result, translate = T) => translate(diskSpaceModule.LOW_DISK_MESSAGE, result.freeMb, result.neededMb);
let lowDiskLogged = false;
function logLowDisk(result, action) {
  if (lowDiskLogged) return;
  lowDiskLogged = true;
  pushLog({ time: new Date().toISOString(), level: "warn", message: E("{0} was not started.", action) + " " + lowDiskMessage(result, E) });
}

// When the release service was last asked, and whether it answered (the version panel shows it).
let lastUpdateCheck = { at: null, ok: null };
async function fetchLatest() {
  const found = await updates.fetchLatestRelease();
  lastUpdateCheck = { at: new Date().toISOString(), ok: Boolean(found) };
  latestRelease = found ?? latestRelease;
  return found;
}
async function checkForUpdate() {
  checkDisk();
  if (STORE_PACKAGE) return;
  await fetchLatest();
  if (engine) onState(engine.state());
  void stageUpdate();
}

// The version panel on Home (owner request, 7 November): installed, latest out, and the one thing
// to do (update-check.cjs versionStatus). The Store build also asks GitHub which version is out,
// at most once an hour, so the member sees whether the Store has something to install.
registerIpc("version-info", async () => {
  if (STORE_INSTALL && (!lastUpdateCheck.at || Date.now() - Date.parse(lastUpdateCheck.at) > 60 * 60 * 1000)) await fetchLatest().catch(() => null);
  const pending = config.pendingUpdate ?? null;
  const pendingReady = !STORE_INSTALL && app.isPackaged && updates.inspectPending({ pending, current: app.getVersion(), directory: updateDirectory() }).action === "install";
  return updates.versionStatus({
    current: app.getVersion(), latest: latestRelease, pending, pendingReady, store: STORE_INSTALL, storeUpdate: storePageUpdate,
    checkedAt: lastUpdateCheck.at, checkFailed: lastUpdateCheck.ok === false, autoUpdate: config.autoUpdate !== false, installing
  });
});
// Store installs: the Guilded Companion listing itself, where the Store shows Update.
registerIpc("open-store-listing", () => shell.openExternal(updates.STORE_LISTING));

// Silent updates for the direct-download build (8.5). The decision lives in update-check.cjs.
const updateDirectory = () => path.join(app.getPath("userData"), "updates");
const autoUpdateDecision = () => updates.decideAutoUpdate({ store: STORE_INSTALL, packaged: app.isPackaged, platform: process.platform, enabled: config.autoUpdate !== false, current: app.getVersion(), latest: latestRelease, pending: config.pendingUpdate });
const autoUpdateOn = () => !["store", "unpackaged", "disabled"].includes(autoUpdateDecision().reason);
let staging = false;
let installerHandedOff = false; // the update installer, or data removal, already owns this exit
async function stageUpdate() {
  if (staging || installing) return;
  const decision = autoUpdateDecision();
  if (decision.action !== "download") return;
  const disk = checkDisk();
  if (!disk.ok) { logLowDisk(disk, E("The automatic update")); return; }
  staging = true;
  try {
    fs.mkdirSync(updateDirectory(), { recursive: true });
    const { installer, version } = decision.update;
    const target = path.join(updateDirectory(), installer.name);
    // Size and SHA-256 are checked against the release before the file is kept (update-check.cjs).
    await updates.downloadInstaller(installer, target);
    config.pendingUpdate = { version, file: target, sha256: installer.sha256, attempts: 0 };
    await saveConfig();
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Guilded Companion {0} was downloaded and checked. It installs when you quit the companion or start it next.", version) });
  } catch (error) {
    // Offline, rate limited or interrupted: stay quiet and try again at the next check.
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Automatic update download skipped: {0}", error instanceof Error ? error.message : String(error)) });
  } finally { staging = false; }
}
function forgetPendingUpdate(file) {
  config.pendingUpdate = undefined;
  if (file) try { fs.rmSync(file, { force: true }); fs.rmSync(file + ".part", { force: true }); } catch { /* best effort */ }
}
// electron-builder keeps a copy of the installer (about 120 MB) in %LOCALAPPDATA%; the installer
// removes it (installer.nsh customInstall), and so does every start, for a copy an older
// installer left or an install that stopped before its last step.
function removeStaleUpdaterCopy() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return;
  const folder = path.join(local, "guilded-companion-updater");
  try {
    if (!fs.existsSync(folder)) return;
    fs.rmSync(folder, { recursive: true, force: true });
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Removed an old copy of the companion installer to free disk space.") });
  } catch { /* best effort: in use or locked, tried again next start */ }
}
// Runs once at start, before the window: forget a stale download, say "Updated to vX" once after an
// update, or install a downloaded update now. Returns true when the installer took over.
async function startupUpdateStep() {
  if (STORE_INSTALL || !app.isPackaged) return false;
  const current = app.getVersion();
  const previous = config.lastRunVersion;
  config.lastRunVersion = current;
  removeStaleUpdaterCopy();
  if (previous && updates.isNewer(current, previous)) {
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Guilded Companion updated to {0}.", current) });
    if (Notification.isSupported()) new Notification({ title: T("Guilded Companion updated to {0}", current), body: T("Your settings and Discord link were kept."), icon: asset("icon.png") }).show();
  }
  const verdict = updates.inspectPending({ pending: config.pendingUpdate, current, directory: updateDirectory() });
  if (verdict.action === "clear") forgetPendingUpdate(config.pendingUpdate?.file);
  if (verdict.action !== "install" || config.autoUpdate === false) { await saveConfig(); return false; }
  // Never start an installer that would fail partway: the update waits until space is freed.
  const disk = checkDisk();
  if (!disk.ok) { logLowDisk(disk, E("The automatic update")); await saveConfig(); return false; }
  config.pendingUpdate = { ...config.pendingUpdate, attempts: (config.pendingUpdate.attempts ?? 0) + 1 };
  await saveConfig();
  try {
    await updates.launchInstaller(verdict.file, spawn);
  } catch (error) {
    pushLog({ time: new Date().toISOString(), level: "error", message: E("Update failed: {0}", error instanceof Error ? error.message : String(error)) });
    return false;
  }
  installerHandedOff = true; quitting = true;
  setTimeout(() => app.quit(), 500);
  return true;
}
// On quit: a downloaded, still-matching update installs silently in the background.
app.on("will-quit", () => {
  if (installerHandedOff || STORE_INSTALL || !app.isPackaged || config.autoUpdate === false) return;
  const verdict = updates.inspectPending({ pending: config.pendingUpdate, current: app.getVersion(), directory: updateDirectory() });
  if (verdict.action === "install" && checkDisk().ok && updates.launchInstallerOnExit(verdict.file)) installerHandedOff = true;
});

// Microsoft Store build updates itself (8.5, track F5; companion-app/store-update.cjs). Silent on
// Windows 11 and Windows 10 2004+, one small Store prompt on Windows 10 1607-1909, otherwise (or on any
// failure) the Store updates button and banner. Installing closes the app; a one-time task restarts it
// and the marker below keeps that restart in the tray.
let storePageUpdate = null;
let storeUpdateBusy = false;
let storePromptPending = false;
let restartedQuietly = false;
const restartMarkerFile = () => path.join(app.getPath("userData"), "store-update-restart.json");
function readRestartMarker() {
  if (!STORE_PACKAGE) return false;
  try {
    const quiet = storeUpdatesModule().restartedAfterUpdate(JSON.parse(fs.readFileSync(restartMarkerFile(), "utf8")));
    fs.rmSync(restartMarkerFile(), { force: true });
    if (quiet) pushLog({ time: new Date().toISOString(), level: "info", message: E("Guilded Companion was updated by Microsoft Store and restarted.") });
    return quiet;
  } catch { return false; }
}
function wowIsRunning() {
  return new Promise((resolve) => execFile("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq Wow*"], { windowsHide: true, timeout: 15_000 },
    (error, stdout) => resolve(!error && storeUpdatesModule().wowRunningFrom(stdout))));
}
async function maybeStoreUpdate() {
  const decision = storeUpdatesModule().decideStoreCheck({ store: STORE_PACKAGE, platform: process.platform, enabled: config.autoUpdate !== false,
    wowRunning: process.platform === "win32" && STORE_PACKAGE ? await wowIsRunning() : false,
    lastCheckAt: config.storeUpdateCheckedAt, lastFailedAt: config.storeUpdateFailedAt, busy: storeUpdateBusy });
  if (decision.action !== "check") return decision;
  storeUpdateBusy = true;
  const now = new Date().toISOString();
  try {
    const check = await storeUpdatesModule().runScript(spawn, storeUpdatesModule().checkScript(), { timeoutMs: 2 * 60 * 1000 });
    config.storeUpdateCheckedAt = now;
    if (!check.ok) config.storeUpdateFailedAt = now;
    const next = storeUpdatesModule().decideStoreInstall(check, { windowVisible: !!win && win.isVisible(), wowRunning: await wowIsRunning() });
    storePromptPending = next.reason === "prompt-needs-window";
    if (next.action === "button" && check.ok && check.updates > 0) storePageUpdate = { version: check.version || "", url: STORE_UPDATES };
    if (next.action === "button" && !check.ok) pushLog({ time: now, level: "info", message: E("Microsoft Store update check unavailable: {0}", String(check.error || "unknown")) });
    if (next.action !== "install") return next;
    pushLog({ time: now, level: "info", message: E("Installing Guilded Companion {0} from Microsoft Store. The companion restarts by itself.", check.version || "") });
    fs.writeFileSync(restartMarkerFile(), JSON.stringify({ at: new Date().toISOString(), version: check.version || null }));
    await saveConfig();
    const hwnd = next.method === "prompt" && win ? String(win.getNativeWindowHandle().readBigUInt64LE(0)) : "0";
    const result = await storeUpdatesModule().runScript(spawn, storeUpdatesModule().installScript({ method: next.method, hwnd, exe: path.parse(process.execPath).name }));
    // Still here: the update was declined, failed or had nothing to install. Keep the button.
    fs.rmSync(restartMarkerFile(), { force: true });
    if (!result.ok) { config.storeUpdateFailedAt = new Date().toISOString(); storePageUpdate = { version: check.version || "", url: STORE_UPDATES }; }
    pushLog({ time: new Date().toISOString(), level: result.ok ? "info" : "warn", message: result.ok ? E("Microsoft Store update finished.") : E("Microsoft Store update did not finish ({0}). Use Store updates.", String(result.state || result.error || "unknown")) });
    return next;
  } catch (error) {
    config.storeUpdateFailedAt = now;
    pushLog({ time: now, level: "warn", message: E("Microsoft Store update check unavailable: {0}", error instanceof Error ? error.message : String(error)) });
    return { action: "button", reason: "error" };
  } finally {
    storeUpdateBusy = false;
    await saveConfig().catch(() => {});
    if (engine) onState(engine.state());
  }
}

// Launch-day check (companion/live-folder.mjs): when the watched file last changed, for the
// Overview status line, and the live game's folder to offer when WoW saves somewhere else.
// Checked at start, after each upload or setup change, and every hour.
let savedFile = null;
let savedFileCheck = 0;
// Several WoW accounts (docs/plans/MULTI_ACCOUNT.md): another account folder of the same install
// with Guilded's data, waiting for the member's "Is it yours too?" (companion/wow-accounts.mjs).
let otherAccount = null;
function otherAccounts() {
  if (config.wowEnabled === false || !config.watchFile || typeof engineModules?.newAccounts !== "function") return [];
  try { return engineModules.newAccounts(config, accountsUnder(path.dirname(path.dirname(path.dirname(config.watchFile))), savedNames(), engineModules.isOtherEditionFolder)); }
  catch { return []; }
}
let lastUploadAt = null;
const french = () => language() === "fr";

async function refreshSavedFile() {
  const ticket = ++savedFileCheck;
  let result = null;
  if (config.wowEnabled !== false && config.watchFile) {
    try {
      result = await engineModules.checkSavedFile(config.watchFile, { ignore: config.liveFolderDeclined ?? [] });
      // A build for another edition in this game folder never loads (companion/addon-install.mjs).
      result.addon = await engineModules.checkInstalledAddon(config.watchFile);
    } catch { /* checked again within the hour */ }
  } else if (config.wowEnabled !== false) {
    // Nothing chosen yet: a fresh PC whose AddOns folder is empty never saves a Guilded.lua to
    // choose. Check the WoW install the app finds so the Problems panel can say so.
    try {
      const found = detectSavedVariables(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions())[0];
      if (found) result = { addon: await engineModules.checkInstalledAddon(found.path) };
      else {
        // WoW installed but never started with this account (Guilded Setup on a fresh PC): the
        // addon can still go in, from the install folder alone.
        const install = searchWow(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions()).installs[0];
        if (install) result = { addon: await engineModules.checkInstalledAddon(path.join(install, "_forever_", "WTF", "Account", "-", "SavedVariables", "Guilded.lua")) };
      }
    } catch { /* checked again later */ }
  }
  void maybeAutoUpdateAddon(result?.addon);
  const another = otherAccounts();
  if (ticket !== savedFileCheck) return;
  savedFile = result;
  otherAccount = another[0] ?? null;
  const candidate = savedFile?.candidate;
  // The app mostly lives in the tray: say it once per folder outside the window too.
  if (candidate && config.liveFolderNotified !== candidate.path) {
    config.liveFolderNotified = candidate.path;
    await saveConfig();
    if (Notification.isSupported()) {
      const notice = new Notification({
        title: french() ? "Vos données WoW sont peut-être ailleurs" : T("Your WoW saved data may have moved"),
        body: french() ? `${candidate.gameFolder} a un fichier plus récent. Cliquez pour changer de dossier.` : T("{0} has a newer file. Click to switch folders.", candidate.gameFolder),
        icon: asset("icon.png")
      });
      notice.on("click", showWindow);
      notice.show();
    }
  }
  if (engine) onState(engine.state());
}

// Problems panel (8.5, companion/problems.mjs): what is wrong right now, each with its fix.
// Whether WoW is open is checked every 20 seconds (tasklist, Windows only); the moment it exits, an addon
// update that was waiting for it runs (maybeAutoUpdateAddon).
let wowRunning = false;
let addonAutoUpdating = false, addonUpdateFailed = false, addonUpdateFailedAt = 0;
function checkWowRunning() {
  if (process.platform !== "win32") return;
  execFile("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq Wow*"], { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
    const running = !error && engineModules.wowRunningFrom(stdout);
    if (running === wowRunning) return;
    const exited = wowRunning && !running;
    wowRunning = running;
    if (engine) onState(engine.state());
    if (exited) setTimeout(() => void refreshSavedFile(), 3000);
  });
}
let online = true;
function problems(state) {
  if (typeof engineModules?.companionProblems !== "function") return [];
  return engineModules.companionProblems({
    config, state, savedFile, update, version: app.getVersion(), store: STORE_INSTALL, autoUpdate: config.autoUpdate !== false,
    updateAttempts: config.pendingUpdate?.attempts ?? 0, wowRunning, online, diskSpace, settingsSave: settingsSaveState(), addonUpdateFailed
  });
}
// Install addon / Update addon (8.5, track F3): offered when the watched game folder has no
// Guilded, the wrong build, or one older than this companion (companion-app/addon-installer.cjs).
function addonAction() {
  try {
    return { ...addonInstallerModule().decideAddonInstall({ addon: savedFile?.addon, companionVersion: app.getVersion(), wowRunning, wowEnabled: config.wowEnabled !== false }), installed: savedFile?.addon?.version ?? null };
  } catch { return { action: "none", reason: "error" }; }
}
let shownProblems = "";
function onState(raw) {
  const state = { ...raw, zeroSetupFailures };
  refreshUpdate(state);
  const status = health(state);
  const found = problems(state);
  win?.webContents.send("state", { state, health: status, update, savedFile, problems: found, addonAction: addonAction(), otherAccount: otherAccount ? { account: otherAccount.account } : null, accountRows: accountRowsFor(state) });
  if (tray) {
    // Only problems the member can fix turn the tray red; Guilded's outages stay amber.
    const own = linkIdentity.memberProblems(found);
    const icon = own.length && fs.existsSync(asset("tray-problem.png")) ? "tray-problem.png" : `tray-${own.length ? "error" : status.level}.png`;
    tray.setImage(nativeImage.createFromPath(asset(icon)).resize({ width: 32, height: 32 }));
    tray.setToolTip(`Guilded Companion\n${found.length ? T("{0} problem(s): open to see how to fix", found.length) + "\n" : ""}${M(status.text)}${update ? T("\nUpdate available: {0}", update.version) : ""}${savedFile?.candidate ? T("\nWoW data may have moved: open to check") : ""}`);
  }
  // The red "!" on the taskbar button too, changed only when the list changes.
  const key = linkIdentity.memberProblems(found).map((problem) => problem.id).join(",");
  if (win && key !== shownProblems) {
    shownProblems = key;
    try { win.setOverlayIcon(key ? nativeImage.createFromPath(asset("problem-badge.png")) : null, key ? T("{0} problem(s): open to see how to fix", found.length) : ""); } catch { /* not every Windows shell has overlays */ }
  }
  // An upload means the file changed: refresh its date for the status line.
  if (state.lastUpload?.at && state.lastUpload.at !== lastUploadAt) {
    lastUploadAt = state.lastUpload.at;
    void refreshSavedFile();
  }
}

// Automatic setup tries that failed since the last good one: the status card stops saying "Getting this PC ready…".
let zeroSetupFailures = 0;
function currentState() {
  const state = { ...engine.state(), zeroSetupFailures };
  return { state, health: health(state), update, savedFile, problems: problems(state), addonAction: addonAction() };
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// --tab=<page> (screenshots, support) still opens the old window on that page.
const OLD_WINDOW_FIRST = Boolean(screenshotTab);
function createWindow() {
  win = new BrowserWindow({
    // The single window (redo C2): small and fixed; the old window (Advanced > Old window) grows it.
    width: OLD_WINDOW_FIRST ? 1180 : 480, height: OLD_WINDOW_FIRST ? 820 : 600, minWidth: OLD_WINDOW_FIRST ? 760 : 420, minHeight: OLD_WINDOW_FIRST ? 600 : 520, resizable: OLD_WINDOW_FIRST,
    show: false, autoHideMenuBar: true, backgroundColor: "#15120d",
    title: T("Guilded Companion"), icon: asset("icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenu(null);
  if (OLD_WINDOW_FIRST) win.loadFile(path.join(__dirname, "renderer", "index.html"), { query: screenshotTab ? { tab: screenshotTab } : {} });
  else win.loadFile(path.join(__dirname, "renderer", "main.html"));
  win.once("ready-to-show", () => { if ((!startHidden && !restartedQuietly) || engineModules.validateConfig(config).length > 0) win.show(); });
  // A Store update prompt (Windows 10 1607-1909) waits for a window the member can see.
  win.on("show", () => { if (storePromptPending) { storePromptPending = false; config.storeUpdateCheckedAt = undefined; void maybeStoreUpdate(); } });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  // Links open in the browser, never inside the app.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: "deny" }; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset("tray-setup.png")).resize({ width: 32, height: 32 }));
  tray.setToolTip(T("Guilded Companion"));
  tray.on("click", showWindow);
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: T("Open Guilded Companion"), click: showWindow },
    { type: "separator" },
    { label: T("Send my data to Discord now"), click: () => engine.uploadNow() },
    { label: T("Refresh in-game standings now"), click: () => void engine.refreshStandings() },
    { type: "separator" },
    {
      label: T("Start with Windows"), type: "checkbox", checked: autostartOn(),
      click: (item) => { void setAutostart(item.checked); }
    },
    { label: T("Quit (stops sending data)"), click: () => { quitting = true; app.quit(); } },
    { label: T("Remove all data and quit..."), click: () => { void removeAllDataAndQuit(); } }
  ]));
  rebuild();
  tray.on("right-click", rebuild);
}

// Store build (9.0.8): the package startup task (store-startup.cjs), never a Run registry entry.
// Its last known state; null until Windows answered.
let storeStartupOn = null;
function autostartOn() {
  return STORE_PACKAGE ? storeStartupOn === true : app.getLoginItemSettings().openAtLogin;
}

async function setAutostart(on) {
  if (STORE_PACKAGE) {
    const startup = require("./store-startup.cjs");
    const result = await startup.setStoreStartup(!!on);
    storeStartupOn = result.on;
    if (result.needsSettings) {
      // Windows keeps this choice (turned off in Windows settings, or by a policy): open the page where the member decides.
      pushLog({ time: new Date().toISOString(), level: "warn", message: E("Windows did not let Guilded Companion change Start with Windows ({0}). Turn Guilded Companion on or off in Windows Settings > Apps > Startup.", result.state ?? "no answer") });
      void startup.openStartupSettings(shell).catch(() => {});
    }
    return storeStartupOn;
  }
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
  return app.getLoginItemSettings().openAtLogin;
}

// The Store build starts with Windows by default too (9.0.8; Store installs before it never could, so
// they are asked once with their own flag). A member who turned it off in Windows stays off.
async function storeStartupFirstRun() {
  const startup = require("./store-startup.cjs");
  if (!config.storeStartupAsked) {
    config.storeStartupAsked = true;
    await saveConfig();
    const result = await startup.setStoreStartup(true);
    storeStartupOn = result.on;
    pushLog({ time: new Date().toISOString(), level: result.on ? "info" : "warn", message: result.on ? E("Start with Windows is on: Guilded Companion starts when you sign in to Windows, so your runs always reach Discord.")
      : E("Start with Windows is off ({0}). Turn Guilded Companion on in Windows Settings > Apps > Startup so your runs reach Discord without opening the app.", result.state ?? "no answer") });
  } else {
    storeStartupOn = startup.isOn(await startup.startupState());
  }
}

// "Clean my computer": stop watching, turn off Start with Windows (so the
// registry Run key does not outlive this install), delete the saved config
// (bot address, upload token, companion credential) and Electron's cache
// under userData, then quit. Uninstalling normally (Add/Remove Programs)
// does the same via the nsis "deleteAppDataOnUninstall" option and
// installer.nsh, for anyone who uninstalls without opening the app first.
async function removeAllDataAndQuit(skipPrompt = false) {
  const choice = skipPrompt ? 1 : dialog.showMessageBoxSync(win ?? undefined, {
    type: "warning",
    buttons: [T("Cancel"), T("Remove and quit")],
    defaultId: 0,
    cancelId: 0,
    title: T("Remove all data?"),
    message: T("Stop the companion and remove its saved data from this PC?"),
    detail: T("This revokes your saved online connections, turns off Start with Windows and deletes your local settings and unsent PoE2 observations. Your game files are untouched.")
  });
  if (choice !== 1) return false;
  // Stop requests before revocation, including any outstanding sign-in.
  signIn?.controller.abort(); signIn = null;
  await engine.stop();
  const revocation = await engineModules.revokeSavedConnections(config);
  if (revocation.failed) {
    dialog.showMessageBoxSync(win ?? undefined, {
      type: "warning", buttons: [T("OK")],
      message: T("Some online connections could not be revoked."),
      detail: T("Local data will still be removed. Revoke those connections from your Guilded account or /character pair when the server is reachable.")
    });
  }
  setAutostart(false);
  installerHandedOff = true; // removing data: never start an installer on the way out
  if (storeConfig) await storeConfig.flush().catch(() => {}); // A failed save has settled; deletion must still work.
  quitting = true;
  // config.json (the token and companion credential) first and on its own:
  // it has no open handle, unlike Chromium's cache files below, which can
  // still be locked while this process is exiting and would otherwise abort
  // the whole recursive delete before reaching it.
  try {
    fs.rmSync(configFile(), { force: true });
  } catch (error) {
    pushLog({ time: new Date().toISOString(), level: "error", message: E("Could not remove the saved settings file: {0}", engineModules.describeError(error)) });
  }
  try {
    fs.rmSync(app.getPath("userData"), { recursive: true, force: true });
  } catch { /* best effort: leftover cache files, not sensitive */ }
  // The Store sign-in is not offered again after a deliberate wipe.
  try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(path.join(app.getPath("userData"), require("./store-migrate.cjs").IMPORT_MARKER), new Date().toISOString()); } catch { /* best effort */ }
  exitFlushed = true;
  app.quit();
  return true;
}

// "Delete my data" (9.0.1): asks the bot to erase this member's records (the same erasure as the website's
// /me/data page), after a confirm step, then clears this PC like "Remove data & quit". It cannot be undone.
async function deleteMyDataEverywhere() {
  if (!config.companionCredential) {
    dialog.showMessageBoxSync(win ?? undefined, { type: "info", buttons: [T("OK")], message: T("Connect your Discord account first."), detail: T("There is nothing stored online for you yet. Use Remove data & quit to clear this PC.") });
    return false;
  }
  const choice = dialog.showMessageBoxSync(win ?? undefined, {
    type: "warning", buttons: [T("Cancel"), T("Delete my data")], defaultId: 0, cancelId: 0,
    title: T("Delete my data"), message: T("Delete all your Guilded data?"),
    detail: T("This erases your website account, your guild characters and your personal records on the bot (battleground reports, achievements, recap schedule, devices), then clears this PC. Points, loot and raid history stay in each guild as \"Deleted member\". It cannot be undone.")
  });
  if (choice !== 1) return false;
  try {
    const url = new URL("/api/v1/companion/delete-my-data", config.uploadUrl);
    const { response, body } = await engineModules.requestJson(url, { method: "POST", headers: { ...engineModules.credentialHeaders(config), "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) }, undefined, 30000);
    if (!response.ok) {
      dialog.showMessageBoxSync(win ?? undefined, { type: "error", buttons: [T("OK")], message: T("Your data was not deleted."), detail: response.status === 404 ? T("This bot does not support deleting from the companion yet. Use your Guilded page on the website (Your data), or ask the owner.") : body.error || T("The bot answered {0}.", response.status) });
      return false;
    }
  } catch (error) {
    dialog.showMessageBoxSync(win ?? undefined, { type: "error", buttons: [T("OK")], message: T("Your data was not deleted."), detail: engineModules.describeError(error) });
    return false;
  }
  return removeAllDataAndQuit(true);
}

// The installer asks a running companion to close (installer.nsh customCheckAppRunning) by writing
// quit-for-update in the data folder; nothing is started, so no second window flashes. The
// companion checks for it every second, saves its settings and quits. --quit-for-update on a second
// launch still works the same way.
const QUIT_REQUEST_FILE = "quit-for-update";
const quitRequestPath = () => path.join(app.getPath("userData"), QUIT_REQUEST_FILE);
function quitForUpdate(source) {
  if (quitting) return;
  // before-quit flushes the settings; nothing is written after that.
  const entry = { time: new Date().toISOString(), level: "info", message: E("Closing for an update ({0}).", source) };
  pushLog(entry);
  // In startup.log too, so an install can be followed from that one file.
  try { fs.appendFileSync(path.join(app.getPath("userData"), "startup.log"), `${entry.time} ${entry.level} ${entry.message}\n`); } catch { /* diagnostics only */ }
  installerHandedOff = true; // an installer is already running: never start the quit-time one
  quitting = true;
  app.quit();
}
function checkQuitRequest() {
  try {
    if (!fs.existsSync(quitRequestPath())) return;
    fs.rmSync(quitRequestPath(), { force: true });
  } catch { return; }
  quitForUpdate("installer request");
}
app.on("second-instance", (event, argv) => {
  if (Array.isArray(argv) && argv.includes(QUIT_FOR_UPDATE)) { quitForUpdate("second launch"); return; }
  showWindow();
});

// A startup failure must be loud: otherwise the process lives on with no
// window and no tray, holding the single-instance lock, so every later launch
// quits silently and the installer reports the app as "already running".
function failStartup(error) {
  dialog.showErrorBox(T("Guilded Companion could not start"), T("{0}\n\nReinstall Guilded Companion. If this keeps happening, send this message to your guild's officers.", error?.stack ?? error));
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    try {
      fs.mkdirSync(app.getPath("userData"), { recursive: true });
      const log = path.join(app.getPath("userData"), "startup.log");
      // Kept across starts so the start before this one can still be read; one older file is kept.
      if (fs.existsSync(log) && fs.statSync(log).size > 256 * 1024) fs.renameSync(log, log + ".1");
      fs.appendFileSync(log, `----- ${new Date().toISOString()} start, pid ${process.pid} -----\n`);
    } catch { /* diagnostics only */ }
    // A request left by an installer that finished while no companion ran is not for this start.
    try { fs.rmSync(quitRequestPath(), { force: true }); } catch { /* none */ }
    setInterval(checkQuitRequest, 1000).unref?.();
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Starting Guilded Companion {0} from {1} (packaged: {2}, Store: {3}, data folder: {4}, arguments: {5}).", app.getVersion(), process.execPath, app.isPackaged ? "yes" : "no", STORE_INSTALL ? "yes" : "no", app.getPath("userData"), args.join(" ") || "none") });
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Launch: working folder {0}, APPDATA {1}, user {2}, started by the installer: {3}.", process.cwd(), process.env.APPDATA || "?", process.env.USERNAME || "?", launchedByInstaller ? "yes" : "no") });
    // Started by the installer (9.0 release blocker): the old companion may still be closing. Wait
    // until it is gone before reading the settings, so this start reads and saves them normally.
    if (launchedByInstaller) await waitForOtherCompanions();
    storeConfig = require("./store-config.cjs").createStoreConfig(safeStorage, { log: settingsLog });
    setInterval(noteSaveState, 10_000).unref?.();
    engineModules = await loadEngineModules();
    await loadConfig();
    // Diagnostics (9.0 release blocker): say if a start-up step left the settings blank.
    const setUp = !configLoadModule().isUnset(config);
    const checkStep = (step) => { if (setUp && configLoadModule().isUnset(config)) pushLog({ time: new Date().toISOString(), level: "error", message: E("Settings became blank after {0}; the saved file was not changed.", step) }); };
    await repairSavedConfig(); checkStep("repairSavedConfig");
    const handedToInstaller = await startupUpdateStep();
    pushLog({ time: new Date().toISOString(), level: "info", message: handedToInstaller ? E("Start-up update step: a downloaded update is installing; this start ends here.") : E("Start-up update step: nothing to install.") });
    if (handedToInstaller) return;
    checkStep("startupUpdateStep");
    try { const preference = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "language.json"), "utf8")); if (["en", "fr"].includes(preference.language)) selectedLanguage = preference.language; } catch { /* use system language */ }
    config.poeJournalFile = profileJournalFile();
    engine = engineModules.createProfileEngine(config, {
      profileConfig: (id, current) => ({ ...current, poeJournalFile: path.join(app.getPath("userData"), id === "default" ? "poe-journal.json" : `poe-journal-${id}.json`) }),
      onLog: (entry) => pushLog(entry),
      onState
    });
    restartedQuietly = readRestartMarker();
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Ready: {0} connection(s), signed in: {1}, restarted by Microsoft Store: {2}.", configLoadModule().configSummary(config).connections, configLoadModule().configSummary(config).signedIn ? "yes" : "no", restartedQuietly ? "yes" : "no") });
    startupLogging = false;
    createWindow();
    createTray();
  } catch (error) {
    failStartup(error);
    return;
  }
  // First run: start with Windows by default, since the whole point is that it just works.
  if (app.isPackaged && !config.autostartAsked) {
    config.autostartAsked = true;
    await saveConfig();
    if (!STORE_PACKAGE) await setAutostart(true);
  }
  if (STORE_PACKAGE) void storeStartupFirstRun().catch((error) => pushLog({ level: "error", time: new Date().toISOString(), message: error.message }));
  await engine.start();
  powerMonitor.on("suspend", () => { void engine.suspend().catch(error => pushLog({ level: "error", time: new Date().toISOString(), message: error.message })); });
  powerMonitor.on("resume", () => { void engine.resume().catch(error => pushLog({ level: "error", time: new Date().toISOString(), message: error.message })); });
  onState(engine.state());
  void refreshSavedFile();
  // Zero-setup companion: no sign-in needed to start syncing (tried again every 5 minutes until it works).
  const zeroSetup = () => void zeroSetupStep().then((done) => { if (done !== undefined && zeroSetupFailures) { zeroSetupFailures = 0; onState(engine.state()); } }).catch((error) => { zeroSetupFailures += 1; if (zeroSetupFailures === 1) onState(engine.state()); pushLog({ level: "warn", time: new Date().toISOString(), message: E("Automatic setup will try again: {0}", error instanceof Error ? error.message : String(error)) }); });
  // 9.1.4: a Discord sign-in left in a Store copy on this PC is taken over once, so the device claim runs.
  // It runs beside the automatic setup, not before it, and only once per PC (a marker file), so it never delays start-up.
  zeroSetup();
  void importStoreSignIn().catch((error) => pushLog({ level: "warn", time: new Date().toISOString(), message: E("The Microsoft Store sign-in could not be imported: {0}", error instanceof Error ? error.message : String(error)) }));
  setInterval(zeroSetup, 5 * 60 * 1000).unref?.();
  // Every 5 minutes: a few file dates, so a /reload that did not save Guilded.lua shows up soon.
  setInterval(() => void refreshSavedFile(), 5 * 60 * 1000);
  checkWowRunning();
  setInterval(checkWowRunning, 20 * 1000);
  // Look for a newer release shortly after start, then every few hours.
  setTimeout(() => void checkForUpdate(), 20_000);
  setInterval(() => void checkForUpdate(), updates.CHECK_INTERVAL_MS);
  // Store build (F5): look for a Store update a few minutes after start, then every 30 minutes;
  // store-update.cjs keeps it to once every 6 hours and never while WoW runs.
  if (STORE_PACKAGE) {
    setTimeout(() => void maybeStoreUpdate(), 3 * 60 * 1000);
    setInterval(() => void maybeStoreUpdate(), 30 * 60 * 1000);
  }

  if (screenshotPath) {
    const capture = () => setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(screenshotPath, image.toPNG());
        quitting = true;
        app.quit();
      } catch (error) {
        // This timer is outside the startup promise. A failed diagnostic must
        // release the single-instance lock and report failure to its caller.
        console.error("Guilded Companion screenshot failed:", error);
        quitting = true;
        app.exit(1);
      }
    }, 3500);
    // Startup awaits can let the renderer finish before this point.
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", capture);
    else capture();
    win.show();
  }
}).catch(failStartup);

app.on("window-all-closed", () => { /* stay in the tray */ });
let exitFlushed = false;
app.on("before-quit", event => {
  quitting = true;
  if (storeConfig && !exitFlushed) {
    event.preventDefault();
    storeConfig.flush().then(() => { exitFlushed = true; app.quit(); }).catch(error => {
      quitting = false;
      pushLog({ time: new Date().toISOString(), level: "error", message: E("Settings could not be saved: {0}", error.message) });
      dialog.showErrorBox(T("Guilded Companion could not save settings"), error.message);
    });
  }
});

// Old window > back to the single window.
registerIpc("open-single-window", () => {
  if (!win) return false;
  win.setResizable(false);
  win.setMinimumSize(420, 520);
  win.setSize(480, 600);
  win.center();
  void win.loadFile(path.join(__dirname, "renderer", "main.html"));
  return true;
});
// Advanced > Old window (kept for one release as a safety net): the previous, larger window.
registerIpc("open-old-window", () => {
  if (!win) return false;
  win.setResizable(true);
  win.setMinimumSize(760, 600);
  win.setSize(1180, 820);
  win.center();
  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return true;
});
registerIpc("get-all", () => ({ otherAccount: otherAccount ? { account: otherAccount.account } : null, focus: { poeTracking: engineModules.poeTracking === true }, config: require("./ipc-security.cjs").rendererConfig(config), language: language(), logs, ...currentState(), storePackage: STORE_PACKAGE, autostart: autostartOn(), version: app.getVersion() }));
registerIpc("list-profiles", () => ({ active: config.activeProfile || "default", profiles: engineModules.profileChoices(config) }));
registerIpc("change-profile", async (_event, choice) => {
  try {
    if (signIn) return { ok: false, message: "Finish or cancel Discord sign-in before switching connections." };
    await engine.stop();
    config = choice.name ? engineModules.addProfile(config, choice.name) : engineModules.switchProfile(config, choice.id);
    config.poeJournalFile = path.join(app.getPath("userData"), config.activeProfile === "default" ? "poe-journal.json" : `poe-journal-${config.activeProfile}.json`);
    await saveConfig();
    savedFile = null;
    await engine.configure(config);
    onState(engine.state());
    return { ok: true, message: "Connection selected." };
  } catch (error) { return { ok: false, message: error.message }; }
});

registerIpc("remove-profile", async (_event, id) => {
  try {
    if (signIn) return { ok: false, message: "Finish or cancel Discord sign-in before removing a connection." };
    await engine.stop();
    config = engineModules.removeProfile(config, id);
    config.poeJournalFile = path.join(app.getPath("userData"), config.activeProfile === "default" ? "poe-journal.json" : `poe-journal-${config.activeProfile}.json`);
    await saveConfig();
    savedFile = null;
    await engine.configure(config);
    onState(engine.state());
    return { ok: true, message: "Connection removed from this PC. Nothing was deleted on the server." };
  } catch (error) { try { await engine.configure(config); } catch { /* keep the old selection running if possible */ } return { ok: false, message: error.message }; }
});

registerIpc("set-language", (_event, value) => {
  if (!["en", "fr"].includes(value)) throw new Error("Unsupported language");
  const file = path.join(app.getPath("userData"), "language.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ language: value }));
  selectedLanguage = value;
  if (engine) onState(engine.state());
  return value;
});

registerIpc("save-config", async (_event, next) => {
  if (typeof next.watchFile === "string") next = { ...next, watchFile: engineModules.normalizeSavedPath(next.watchFile, savedNames()[0]) };
  config = { ...config, ...next, poeJournalFile: profileJournalFile(), standingsIntervalMinutes: Math.max(1, Number(next.standingsIntervalMinutes) || 2) };
  const problems = engineModules.validateConfig(config);
  await saveConfig();
  void refreshSavedFile();
  const started = await engine.configure(config);
  if (problems.length > 0) return { ok: false, message: problems[0] };
  if (config.syncEnabled === false) return { ok: true, message: T("Saved. This connection is paused.") };
  return started ? { ok: true, message: T("Saved. The companion is running.") } : { ok: false, message: T("Saved, but it could not start. See the Activity page.") };
});

// The Overview prompt: watch the live game's file instead (the page words the result), or keep
// this folder and never be asked about that file again.
registerIpc("switch-live-folder", async () => {
  const candidate = savedFile?.candidate;
  if (!candidate) return { ok: false, path: null };
  config = { ...config, watchFile: candidate.path };
  await saveConfig();
  pushLog({ time: new Date().toISOString(), level: "info", message: E("Saved-data file switched to {0} ({1}).", candidate.path, candidate.reason === "beta" ? E("the beta folder is no longer used") : E("the previous file had not changed for 3 days")) });
  const started = await engine.configure(config);
  await refreshSavedFile();
  return { ok: started, path: candidate.path };
});
// "Is WOW2 yours too?" Yes: it syncs from now on; no: never asked again. The file is the one this
// process found, never a path from the window.
async function answerOtherAccount(yes) {
  const asked = otherAccount;
  if (!asked) return { ok: false, account: null };
  config = engineModules.answerAccount(config, asked.path, yes);
  await saveConfig();
  pushLog({ time: new Date().toISOString(), level: "info", message: yes ? E("WoW account {0} syncs too, from {1}.", asked.account, asked.path) : E("WoW account {0} is not synced (not this member's).", asked.account) });
  otherAccount = null;
  const started = yes ? await engine.configure(config) : true;
  if (yes && started) engine.uploadNow();
  await refreshSavedFile();
  return { ok: started, account: asked.account };
}
// Settings › Your WoW folder (plan step 2): a line per account, with a switch beside each further one.
function accountRowsFor(state) {
  try { return typeof engineModules?.accountRows === "function" ? engineModules.accountRows(config, state?.accounts ?? []) : []; } catch { return []; }
}
registerIpc("set-account", async (_event, { file, on }) => {
  const next = engineModules.switchAccount(config, file, on);
  if (next === config) return { ok: false };
  config = next;
  await saveConfig();
  pushLog({ time: new Date().toISOString(), level: "info", message: on ? E("WoW account {0} syncs again.", engineModules.accountName(file)) : E("WoW account {0} was switched off.", engineModules.accountName(file)) });
  const started = await engine.configure(config);
  if (on && started) engine.uploadNow();
  await refreshSavedFile();
  return { ok: started };
});
registerIpc("account-yes", () => answerOtherAccount(true));
registerIpc("account-no", () => answerOtherAccount(false));
registerIpc("dismiss-live-folder", async () => {
  const candidate = savedFile?.candidate;
  if (candidate) {
    config.liveFolderDeclined = [...(config.liveFolderDeclined ?? []), candidate.path].slice(-20);
    await saveConfig();
  }
  await refreshSavedFile();
  return true;
});

registerIpc("open-storage-settings", () => shell.openExternal("ms-settings:storagesense"));
registerIpc("check-disk-space", () => {
  const result = checkDisk();
  if (result.ok) lowDiskLogged = false;
  return { ok: result.ok, message: result.ok ? T("There is enough free disk space now. Try again.") : lowDiskMessage(result) };
});
registerIpc("open-update", () => shell.openExternal(STORE_PACKAGE ? updates.STORE_LISTING : update?.url || updates.RELEASES_PAGE));
registerIpc("open-startup-settings", () => shell.openExternal("ms-settings:startupapps"));

// "Update now" (7.2): download the checked installer, run it silently and quit; the installer
// restarts the companion. Settings, the Discord link and the queue stay in the user data folder.
let installing = false;
// "Check for updates": look now and report. A new version then downloads in the background
// (or the member chooses Update now); nothing is installed by the check itself.
registerIpc("check-update", async () => {
  if (STORE_INSTALL) return { ok: true, action: "store", message: T("Use Microsoft Store to update this installation.") };
  await checkForUpdate();
  if (!latestRelease) return { ok: false, message: T("Could not verify available updates. Try again when the release service is reachable.") };
  if (!update) return { ok: true, action: "current", message: T("Your companion is up to date.") };
  return { ok: true, action: "available", message: T("Version {0} is available. Choose Update now to install it.", update.version) };
});
registerIpc("set-auto-update", async (_event, on) => {
  config.autoUpdate = on;
  if (!on) forgetPendingUpdate(config.pendingUpdate?.file);
  await saveConfig();
  if (on) void checkForUpdate();
  // Store build: turning it back on looks for a Store update now (still never while WoW runs).
  if (on && STORE_PACKAGE) { config.storeUpdateCheckedAt = undefined; void maybeStoreUpdate(); }
  return on;
});
registerIpc("install-update", async () => {
  if (STORE_PACKAGE) {
    await shell.openExternal(updates.STORE_LISTING);
    return { ok: true, action: "store", message: T("Microsoft Store opened at Guilded Companion. Choose Update there (or Get updates in the Library).") };
  }
  if (installing) return { ok: false, message: T("The update is already downloading.") };
  installing = true;
  let handedOff = false;
  try {
    // Already downloaded and checked in the background: install it now, no second download.
    const staged = app.isPackaged ? updates.inspectPending({ pending: config.pendingUpdate, current: app.getVersion(), directory: updateDirectory() }) : { action: "none" };
    if (staged.action === "install") {
      const disk = checkDisk();
      if (!disk.ok) return { ok: false, message: lowDiskMessage(disk) };
      config.pendingUpdate = { ...config.pendingUpdate, attempts: (config.pendingUpdate.attempts ?? 0) + 1 };
      await saveConfig();
      await updates.launchInstaller(staged.file, spawn);
      pushLog({ time: new Date().toISOString(), level: "info", message: E("Installer started for Guilded Companion {0}; restarting the companion.", staged.version) });
      handedOff = true;
      installerHandedOff = true;
      quitting = true;
      setTimeout(() => app.quit(), 500);
      return { ok: true, action: "installing", message: T("Installing Guilded Companion {0}. It restarts by itself in a moment.", staged.version) };
    }
    // Retry metadata on click, including when the startup GitHub request failed.
    await checkForUpdate();
    if (!latestRelease) return { ok: false, message: T("Could not verify available updates. Try again when the release service is reachable.") };
    const selected = update;
    if (!selected) return { ok: true, action: "current", message: T("Your companion is up to date.") };
    const disk = checkDisk();
    if (selected.installer && !disk.ok) return { ok: false, message: lowDiskMessage(disk) };
    if (!selected.installer) {
      await shell.openExternal(selected.url || updates.RELEASES_PAGE);
      pushLog({ time: new Date().toISOString(), level: "info", message: E("Update download page opened; run the installer from that page to finish updating.") });
      return { ok: true, action: "download-page", message: T("The download page opened. Download and run the installer to finish updating.") };
    }
    const target = path.join(app.getPath("temp"), selected.installer.name);
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Downloading Guilded Companion {0} and verifying its checksum.", selected.version) });
    let shown = -1;
    await updates.downloadInstaller(selected.installer, target, { onProgress: (share) => {
      const percent = Math.floor(share * 100);
      if (percent !== shown && percent % 5 === 0) { shown = percent; win?.webContents.send("update-progress", percent); }
    } });
    await saveConfig();
    // NSIS (electron-builder): /S silent, --updated keeps it an upgrade, --force-run starts the new version.
    await updates.launchInstaller(target, spawn);
    pushLog({ time: new Date().toISOString(), level: "info", message: E("Installer started for Guilded Companion {0}; restarting the companion.", selected.version) });
    handedOff = true;
    installerHandedOff = true;
    quitting = true;
    setTimeout(() => app.quit(), 500);
    return { ok: true, action: "installing", message: T("Installing Guilded Companion {0}. It restarts by itself in a moment.", selected.version) };
  } catch (error) {
    pushLog({ time: new Date().toISOString(), level: "error", message: E("Update failed: {0}", error instanceof Error ? error.message : String(error)) });
    return { ok: false, message: T("The update could not be installed: {0} Try again, or use the download page.", error instanceof Error ? error.message : String(error)) };
  } finally {
    if (!handedOff) installing = false;
  }
});

registerIpc("test-connection", (_event, next) => engineModules.testConnection({ ...config, ...next }));

// Zero-setup companion (owner decision, 9 November 2026; docs/ZERO_SETUP_COMPANION.md). With no
// Discord sign-in anywhere, the companion finds the WoW folder, gets a device key from the bot (kept
// in these encrypted settings) and syncs: the bot picks the server from the character's in-game
// guild and keeps the characters as "reported". Sign-in stays optional; an install that is already
// signed in is never changed here.
// (9.1.4) The Store companion's Discord sign-in, for an install that so far has only a device key.
// Windows' DPAPI opens the Store folder's own key; nothing is copied, deleted or sent anywhere.
async function importStoreSignIn() {
  if (STORE_PACKAGE || !engine || signIn || configLoadModule().configSummary(config).signedIn) return false;
  const found = await require("./store-migrate.cjs").importStoreCredential({
    config, userData: app.getPath("userData"), localAppData: process.env.LOCALAPPDATA, appData: process.env.APPDATA,
    readSettings: (dir) => require("./store-decrypt.cjs").readStoreSettings(dir, { unprotect: dpapiUnprotect })
  });
  if (!found || signIn || configLoadModule().configSummary(config).signedIn) return false;
  config = { ...config, ...found.patch };
  await saveConfig();
  await engine.configure(config);
  pushLog({ time: new Date().toISOString(), level: "info", message: E("Discord sign-in was taken over from the Microsoft Store version ({0}); the device key was kept.", found.from) });
  return true;
}
function dpapiUnprotect(blob) {
  const script = "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($input.ReadLine()), $null, 'CurrentUser'))";
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20_000 }, (error, stdout) => error ? reject(error) : resolve(Buffer.from(String(stdout).trim(), "base64")));
    child.stdin.end(blob.toString("base64") + String.fromCharCode(10));
  });
}
let zeroSetupRunning = false;
async function zeroSetupStep() {
  if (zeroSetupRunning || !engine || signIn) return false;
  const summary = configLoadModule().configSummary(config);
  if (summary.signedIn || config.personal || config.wowEnabled === false || config.zeroSetupOff === true) return false;
  zeroSetupRunning = true;
  try {
    const next = { ...config };
    if (!next.uploadUrl) next.uploadUrl = engineModules.HOSTED_UPLOAD_URL;
    if (!next.watchFile) {
      const detected = await detectSavedVariables(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions());
      const found = detected.filter((entry) => entry.exists);
      const chosen = pickPrimaryAccount(found) || (found.length === 0 ? pickSavedVariables(detected.filter((entry) => !/beta/i.test(entry.game))) : null);
      // Not found (or several accounts): the window offers one folder picker; nothing else to choose.
      if (chosen) next.watchFile = chosen.path;
    }
    // The bot no longer knows this key (its data was reset): get a new one.
    if (/device key is not known/.test(String(engine.state()?.uploadError ?? ""))) delete next.deviceSecret;
    if (!engineModules.deviceSync.hasDeviceKey(next)) {
      const registered = await engineModules.deviceSync.registerDevice(next);
      if (!registered.ok) {
        // An older bot without zero-setup: Sign in with Discord still works as before.
        if (!registered.unsupported) throw new Error(registered.message);
        return false;
      }
      next.deviceSecret = registered.deviceSecret;
      pushLog({ time: new Date().toISOString(), level: "info", message: E("This companion got its own device key: it syncs without Discord sign-in.") });
    }
    next.device = true;
    const changed = ["uploadUrl", "watchFile", "deviceSecret", "device"].some((key) => next[key] !== config[key]);
    // A sign-in that finished meanwhile wins.
    if (!changed || configLoadModule().configSummary(config).signedIn || signIn) return false;
    config = { ...config, uploadUrl: next.uploadUrl, watchFile: next.watchFile, deviceSecret: next.deviceSecret, device: true };
    await saveConfig();
    await engine.configure(config);
    void refreshSavedFile();
    return true;
  } finally {
    zeroSetupRunning = false;
  }
}

// "Advanced: choose server": when several Discord servers set up the same in-game guild ("" = automatic).
registerIpc("device-choose-server", async (_event, discordId) => {
  if (!engineModules.isDeviceMode(config)) return { ok: false, message: T("Signed-in companions choose their server when they sign in.") };
  config = { ...config, deviceServer: discordId || undefined };
  await saveConfig();
  await engine.configure(config);
  engine.uploadNow();
  return { ok: true, message: T("Saved. Syncing now.") };
});

// A pairing code or a Discord sign-in: both end with the same credential and settings.
async function applyPairing(next, result) {
  if (!result.ok) return result;
  // Zero-setup companion: the sign-in claims this PC's device key, so what it reported becomes the
  // member's (confirmed by the next, signed-in upload). The device key is not needed afterwards.
  if (engineModules.deviceSync.hasDeviceKey(config) && !result.personal) {
    const claimed = await engineModules.deviceSync.claimDevice({ ...config, uploadUrl: result.uploadUrl || config.uploadUrl }, result.companionCredential);
    pushLog({ time: new Date().toISOString(), level: claimed.ok ? "info" : "warn", message: claimed.ok ? E("This PC's earlier uploads now belong to your Discord account.") : E("This PC's earlier uploads could not be moved to your Discord account ({0}); your next sync sends them again.", claimed.status ?? "offline") });
  }
  if (engineModules.deviceSync.hasDeviceKey(config) || config.device) config = { ...config, deviceSecret: undefined, device: false, deviceServer: undefined };
  // A code from guilded.kcaron.top/me/ pairs a personal account (public dungeon runs, no guild).
  config = { ...config, ...next, gameEdition: result.gameEdition, wowGuildId: result.wowGuildId, wowGuildName: result.wowGuildName, ...(result.uploadUrl ? { uploadUrl: result.uploadUrl } : {}), pairingCode: "", companionCredential: result.companionCredential, personal: result.personal === true, guildDiscordId: result.personal ? "" : result.guildDiscordId || next.guildDiscordId || config.guildDiscordId };
  await saveConfig();
  const started = await engine.configure(config);
  return {
    ok: true,
    message: started ? result.message : T("{0} Finish the remaining settings and choose Save and start.", result.message)
  };
}

registerIpc("pair-account", async (_event, next) => applyPairing(next, await engineModules.pairAccount({ ...config, ...next })));

// "Sign in with Discord" (7.2): the browser opens the website, the app waits for the approval.
// Since 8.1 the website sends the browser back to a 127.0.0.1 port with a proof: no code to type.
let signIn = null;
const endSignIn = (current) => { current?.controller.abort(); current?.loopback?.close(); };
// A request the bot forgot (expired, or the bot restarted) is replaced by itself this many times.
const SIGN_IN_RESTARTS = 2;
async function openSignInPage(current) {
  await shell.openExternal(current.started.url);
  // Windows often opens the browser behind this window (and behind WoW): step aside so the page is
  // seen. The proof that comes back through 127.0.0.1 brings the companion forward again.
  if (current.started.automatic && win && !win.isDestroyed() && win.isFocused()) setTimeout(() => { if (signIn === current && win && !win.isDestroyed()) win.minimize(); }, 600);
}
async function beginSignIn(next) {
  // Without a free local port the sign-in still works the 7.2 way, with the code.
  const loopback = require("./sign-in-loopback.cjs").startSignInLoopback({ onProof: () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } } });
  const port = await loopback.ready.catch(() => null);
  if (!port) loopback.close();
  const started = await engineModules.startSignIn({ ...config, ...next }, port ? { loopback: port } : {});
  if (!started.ok) { if (port) loopback.close(); return { started }; }
  return { current: { controller: new AbortController(), started, next, ...(port ? { loopback } : {}) }, started };
}
const signInView = (started, restarted = 0) => ({ ok: true, confirm: started.confirm, url: started.url, expiresAt: started.expiresAt, automatic: started.automatic === true, restarted });
async function startSignInFlow(next, switchAccount = false) {
  endSignIn(signIn);
  signIn = null;
  const begun = await beginSignIn(next);
  if (!begun.current) return begun.started;
  signIn = begun.current;
  // "Not you? Switch" (Track L): the page asks Discord to show the account; the old link is
  // revoked once the new one works.
  if (switchAccount && signIn.started.automatic) {
    const url = new URL(signIn.started.url);
    url.searchParams.set("switch", "1");
    signIn.started = { ...signIn.started, url: url.href };
    signIn.previous = config.companionCredential ? { ...config } : null;
  }
  await openSignInPage(signIn);
  return signInView(signIn.started);
}
registerIpc("sign-in-start", (_event, next) => startSignInFlow(next));
registerIpc("sign-in-switch", () => startSignInFlow({}, true));
registerIpc("sign-in-wait", async () => {
  let current = signIn;
  if (!current) return { ok: false, message: T("Choose Sign in with Discord first.") };
  for (let restarts = 0; ; restarts++) {
    const result = await engineModules.waitForSignIn({ ...config, ...current.next, uploadUrl: current.started.uploadUrl }, current.started.requestId, { signal: current.controller.signal, expiresAt: current.started.expiresAt, proof: () => current.loopback?.proof() });
    current.loopback?.close();
    // "Reopen the page" swapped in a new request: follow it.
    if (current.replacedBy && signIn === current.replacedBy) {
      current = current.replacedBy;
      win?.webContents.send("sign-in-restarted", signInView(current.started, 0));
      continue;
    }
    // Expired or forgotten by the bot (a restart): start a new request and open its page, so the
    // member is never left on a page that can only say "expired".
    if (result.expired && signIn === current && restarts < SIGN_IN_RESTARTS) {
      const begun = await beginSignIn(current.next);
      if (begun.current && signIn === current) {
        signIn = current = begun.current;
        pushLog({ time: new Date().toISOString(), level: "info", message: E("The Discord sign-in expired; a new one was opened in the browser.") });
        await openSignInPage(current);
        win?.webContents.send("sign-in-restarted", signInView(current.started, restarts + 1));
        continue;
      }
      if (begun.current) endSignIn(begun.current);
    }
    if (signIn === current) signIn = null;
    const applied = await applyPairing(current.next, result);
    // A new account or server: forget the old name until /me answers, and revoke the replaced link.
    if (applied.ok) {
      config = { ...config, discordAccount: undefined };
      await saveConfig();
      engine?.setLinkedAccount?.(undefined);
      const previous = current.previous;
      if (previous?.companionCredential && previous.companionCredential !== config.companionCredential) {
        void Promise.resolve(engineModules.revokeSavedConnections?.({ ...previous, profiles: {} })).catch(() => {});
      }
    }
    return applied;
  }
});

// Track L: who is signed in ("Connected as"), their Guilded servers, and the Join button for the
// in-game guild's Discord (from GuildedDB.guildKey in the watched Guilded.lua).
const DISCORD_INVITE = /^https:\/\/(discord\.gg|(www\.)?discord\.com\/invite)\/[\w-]{2,40}$/;
registerIpc("companion-me", () => companionMeFetch());
async function companionMeFetch() {
  if (!config.companionCredential) return { ok: false, signedOut: true };
  let guild = null;
  if (config.watchFile && config.wowEnabled !== false) {
    try { guild = linkIdentity.guildFromSavedText(await fs.promises.readFile(config.watchFile, "utf8")); } catch { /* not saved yet */ }
  }
  try {
    const url = new URL("/api/v1/companion/me", engineModules.checkUrl(config.uploadUrl || "https://guilded.kcaron.top"));
    if (guild) { url.searchParams.set("guild", guild.name); url.searchParams.set("realm", guild.realm); }
    const { response, body } = await engineModules.requestJson(url, { headers: engineModules.credentialHeaders(config) });
    if (response.status === 404) return { ok: false, unsupported: true, guild };
    if (!response.ok) return { ok: false, error: body.error || T("The bot answered {0}.", response.status), guild };
    const text = (value, max) => typeof value === "string" ? value.slice(0, max) : null;
    const avatar = text(body.account?.avatarUrl, 300);
    const account = { username: text(body.account?.username, 80) || "", displayName: text(body.account?.displayName, 80), avatarUrl: avatar && /^https:\/\/cdn\.discordapp\.com\//.test(avatar) ? avatar : null };
    if (JSON.stringify(config.discordAccount ?? null) !== JSON.stringify(account)) {
      config = { ...config, discordAccount: account };
      await saveConfig();
      engine?.setLinkedAccount?.(account);
    }
    const join = body.join && typeof body.join.serverName === "string"
      ? { serverName: body.join.serverName.slice(0, 100), inviteUrl: typeof body.join.inviteUrl === "string" && DISCORD_INVITE.test(body.join.inviteUrl) ? body.join.inviteUrl : null, joined: body.join.joined === true }
      : null;
    return { ok: true, account, personal: body.personal === true, servers: Array.isArray(body.servers) ? body.servers.filter((name) => typeof name === "string").slice(0, 20) : [], join, guild };
  } catch (error) {
    return { ok: false, unreachable: true, error: engineModules.describeError(error), guild };
  }
}
// The Join button: only a Discord invite link.
registerIpc("open-invite", (_event, url) => {
  if (typeof url !== "string" || !DISCORD_INVITE.test(url)) return false;
  void shell.openExternal(url);
  return true;
});
// "Reopen the page" (9.0): always a new request. The first one may have expired, or its page may
// already have been used (Connect pressed, the answer lost on the way back to this PC), and the
// site then says "This sign-in expired" while the countdown here still runs. The waiting loop
// above follows the new request.
registerIpc("sign-in-reopen", async () => {
  const current = signIn;
  if (!current) return { ok: false, message: T("Choose Sign in with Discord first.") };
  const begun = await beginSignIn(current.next);
  if (!begun.current) {
    // The bot did not answer: open the same page again, as before.
    await openSignInPage(current);
    return { ok: true, url: current.started.url };
  }
  if (signIn !== current) { endSignIn(begun.current); return { ok: false, message: T("Choose Sign in with Discord first.") }; }
  current.replacedBy = begun.current;
  signIn = begun.current;
  current.controller.abort();
  pushLog({ time: new Date().toISOString(), level: "info", message: E("A new Discord sign-in page was opened.") });
  await openSignInPage(signIn);
  return { ok: true, url: signIn.started.url, started: signInView(signIn.started) };
});
registerIpc("sign-in-cancel", () => { endSignIn(signIn); signIn = null; return { ok: true }; });

registerIpc("browse-file", async () => {
  // The watched file's folder, else the WoW install the search finds, else Program Files (x86): never Downloads.
  const start = config.watchFile ? path.dirname(config.watchFile) : (() => { const found = searchWow(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions()); return pickerStart(undefined, found.entries, found.installs); })();
  const result = await dialog.showOpenDialog(win, {
    title: config.personal
      ? T("Pick GuildedDungeons.lua or Guilded.lua (inside WTF > Account > your account > SavedVariables)")
      : T("Pick Guilded.lua (inside WTF > Account > your account > SavedVariables)"),
    ...(start ? { defaultPath: start } : {}),
    properties: ["openFile"], filters: [{ name: T("Your addon data file"), extensions: ["lua"] }]
  });
  // A file inside a character folder never holds GuildedDB: use the account's SavedVariables instead.
  return result.canceled ? null : engineModules.normalizeSavedPath(result.filePaths[0]);
});

// Leaderboards only: either addon's file; the engine then reads both from that folder.
const savedNames = () => (config.personal ? ["GuildedDungeons.lua", "Guilded.lua"] : ["Guilded.lua"]);
// The WoW search covers every fixed disk (8.5 fresh-PC test: WoW was on D:\Jeux). Windows says
// which drives are local disks once at start; until it answers (or off Windows) every existing
// letter is used. Network and removable drives are left out so a missing share never stalls a search.
let fixedDrives = null;
function readFixedDrives() {
  if (process.platform !== "win32") return;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID -join ','"], { windowsHide: true, timeout: 20_000 }, (error, stdout) => {
    const letters = error ? [] : String(stdout).split(",").map((part) => part.trim()).filter((part) => /^[A-Z]:$/i.test(part));
    if (letters.length) fixedDrives = letters.map((letter) => `${letter.toUpperCase()}\\`);
  });
}
readFixedDrives();
const wowSearchOptions = () => (fixedDrives ? { drives: fixedDrives } : undefined);
registerIpc("detect-wow", () => detectSavedVariables(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions()));
// Find it (8.5 fresh-PC test): every drive and Battle.net's own record, and what was searched, so the
// window always says what it found or did not.
registerIpc("search-wow", () => {
  const found = searchWow(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions());
  const otherEdition = detectOtherEditionSavedVariables(savedNames(), engineModules.isOtherEditionFolder).filter((entry) => entry.exists).length;
  return { entries: found.entries, installs: found.installs, drives: found.drives, otherEdition };
});
// "Link everything", step 3: after sign-in, pick the saved-data file by itself when exactly one
// account on this PC has it. Local read only; with several accounts the member chooses.
registerIpc("link-find-saved-data", async () => {
  if (!config.companionCredential && !engineModules.isDeviceMode(config)) return { ok: false, found: 0, message: T("Sign in with Discord first.") };
  // A watched file that exists and is the live one is done. One that is missing, from the beta
  // client or stale (the player moved to WoW Forever) is looked for again below.
  if (config.watchFile) {
    let current = null;
    try { current = await engineModules.checkSavedFile(config.watchFile); } catch { /* look again below */ }
    if (current && current.changedAt !== null && !current.candidate) return { ok: true, found: 1, already: true };
  }
  const detected = await detectSavedVariables(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions());
  const found = detected.filter((entry) => entry.exists);
  const otherCount = detectOtherEditionSavedVariables(savedNames(), engineModules.isOtherEditionFolder).filter((entry) => entry.exists).length;
  // Addon just installed and not saved yet (no /reload so far): the file does not exist, but its account
  // folder does. With exactly one live account folder, watch that path now; the upload starts at the first save.
  const pending = found.length === 0 ? pickSavedVariables(detected.filter((entry) => !/beta/i.test(entry.game))) : null;
  const chosen = pickPrimaryAccount(found) || pending;
  if (!chosen) return { ok: false, found: found.length, ...(otherCount && !found.length ? { otherEdition: otherCount } : {}), message: otherCount && !found.length ? T("Guilded supports WoW Forever only. The saved files found are from another WoW version; nothing was changed.") : found.length ? T("Found several WoW accounts ({0}). Choose Browse and pick Guilded.lua of the account you play.", found.map((entry) => entry.account).filter(Boolean).join(", ") || found.length) : T("Choose Browse and select Guilded.lua in your account’s SavedVariables folder.") };
  if (config.watchFile && config.watchFile.toLowerCase() === chosen.path.toLowerCase()) return { ok: true, found: 1, already: true };
  const switched = Boolean(config.watchFile);
  config = { ...config, watchFile: chosen.path, wowEnabled: true };
  await saveConfig();
  if (switched) pushLog({ time: new Date().toISOString(), level: "info", message: E("Saved-data file switched to {0} ({1}).", chosen.path, E("found by Find my addon data")) });
  const started = await engine.configure(config);
  if (started && chosen.exists) engine.uploadNow();
  await refreshSavedFile();
  return { ok: started, found: 1, switched, ...(chosen.exists ? {} : { pending: true }) };
});
registerIpc("browse-poe-log", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: T("Choose Path of Exile 2 > logs > Client.txt"),
    properties: ["openFile"], filters: [{ name: T("Game log"), extensions: ["txt"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
// Export to spreadsheet: one CSV file per table (all, or `table`) from Guilded.lua, into a
// folder the player picks.
registerIpc("export-sheets", async (_event, table) => {
  if (!config.watchFile) return { ok: false, message: T("Choose your Guilded.lua file first (World of Warcraft page).") };
  let files;
  try { files = engineModules.sheetFiles(await fs.promises.readFile(config.watchFile, "utf8")).filter((file) => !table || file.table === table); }
  catch (error) { return { ok: false, message: T("Could not read {0}: {1}", path.basename(config.watchFile), error.message) }; }
  const result = await dialog.showOpenDialog(win, {
    title: T("Choose a folder for the spreadsheet files"),
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true, message: T("Export cancelled.") };
  const folder = result.filePaths[0];
  try {
    for (const file of files) await fs.promises.writeFile(path.join(folder, file.name), file.text, "utf8");
  } catch (error) { return { ok: false, message: T("Could not save the files: {0}", error.message) }; }
  pushLog({ time: new Date().toISOString(), level: "ok", message: E("Exported {0} spreadsheet files to {1}.", files.length, folder) });
  void shell.openPath(folder);
  return { ok: true, message: T("Saved {0} to {1}.", files.map((file) => `${file.table} (${file.rows})`).join(", "), folder), files: files.map(({ name, table, rows }) => ({ name, table, rows })) };
});
registerIpc("upload-now", () => { engine.uploadNow(); return true; });
registerIpc("convert-grm", (_event, options) => require("./grm-import.cjs").createGRMConverter({ dialog, fs: fs.promises, convertGRM: engineModules.convertGRM, getWindow: () => win, T })(options));
registerIpc("refresh-standings", async () => { await engine.refreshStandings(); return true; });
registerIpc("set-autostart", (_event, on) => setAutostart(on));
registerIpc("open-addon-folder", () => {
  const target = engineModules.resolveStandingsPath(config);
  if (target) shell.showItemInFolder(target);
  return !!target;
});
registerIpc("remove-data", () => removeAllDataAndQuit());
registerIpc("delete-my-data", () => deleteMyDataEverywhere());
registerIpc("toggle-tracking", async () => {
  config.syncEnabled = config.syncEnabled === false;
  await saveConfig();
  await engine.configure(config);
  onState(engine.state());
  return currentState();
});
registerIpc("get-poe-runs", async () => {
  const url = new URL("/api/v1/poe/visits", config.uploadUrl);
  url.searchParams.set("guild", config.guildDiscordId);
  const { response, body } = await engineModules.requestJson(url, { headers: engineModules.credentialHeaders(config) });
  if (!response.ok) throw new Error(body.error || T("Could not load your map history."));
  return body.visits;
});
// The Wishlist and Cores & prices pages: read what this member may see, send one change.
// Answers { ok, data | error } so the page shows the bot's own message, not Electron's wrapper.
async function manageRequest(change) {
  if (!config.companionCredential) return { ok: false, error: T("Connect your Discord account first.") };
  try {
    const url = new URL("/api/v1/manage", config.uploadUrl);
    if (!change) url.searchParams.set("guild", config.guildDiscordId);
    const headers = engineModules.credentialHeaders(config);
    const { response, body } = await engineModules.requestJson(url, change
      ? { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ guildDiscordId: config.guildDiscordId, change }) }
      : { headers });
    if (!response.ok) return { ok: false, error: response.status === 404 && body.error === "Not found" ? T("This bot does not support editing from the companion yet. Ask the owner to update it.") : body.error || T("The bot answered {0}.", response.status) };
    return { ok: true, data: body };
  } catch (error) { return { ok: false, error: engineModules.describeError(error) }; }
}
// The hub pages (My characters, Reserves, Server): one read, one officer-only write. The last
// good answer is kept on this PC so the pages still show something offline, marked as saved.
const hubCacheFile = () => path.join(app.getPath("userData"), "hub-cache.json");
async function hubRequest(change, lang) {
  if (!config.companionCredential) return { ok: false, error: T("Connect your Discord account first.") };
  // Leaderboards only has no guild to read: say that plainly instead of a guild error.
  if (config.personal === true) return { ok: false, personal: true, unreachable: false, error: T("Signed in for public dungeon rankings only") };
  try {
    const url = new URL("/api/v1/hub", config.uploadUrl);
    if (!change) { url.searchParams.set("guild", config.guildDiscordId); url.searchParams.set("lang", lang === "fr" ? "fr" : "en"); }
    const headers = engineModules.credentialHeaders(config);
    const { response, body } = await engineModules.requestJson(url, change
      ? { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ guildDiscordId: config.guildDiscordId, change }) }
      : { headers });
    if (!response.ok) return { ok: false, error: response.status === 404 && body.error === "Not found" ? T("This bot does not support the hub yet. Ask the owner to update it.") : body.error || T("The bot answered {0}.", response.status) };
    if (!change) { try { await fs.promises.writeFile(hubCacheFile(), JSON.stringify({ guild: config.guildDiscordId, at: new Date().toISOString(), data: body })); } catch { /* the cache is optional */ } }
    return { ok: true, data: body };
  } catch (error) {
    if (!change) {
      try {
        const saved = JSON.parse(await fs.promises.readFile(hubCacheFile(), "utf8"));
        if (saved.guild === config.guildDiscordId && saved.data) return { ok: true, data: saved.data, offline: true, savedAt: saved.at };
      } catch { /* nothing saved yet */ }
    }
    return { ok: false, error: engineModules.describeError(error) };
  }
}
registerIpc("hub-view", (_event, lang) => hubRequest(null, lang));
registerIpc("hub-edit", (_event, change) => hubRequest(change));
registerIpc("manage-view", () => manageRequest(null));
registerIpc("manage-edit", (_event, change) => manageRequest(change));

registerIpc("open-connections", () => shell.openExternal(new URL("/me/connections", engineModules.checkUrl(config.uploadUrl || "https://guilded.kcaron.top")).href));
// "Open Discord server": the server this companion is linked to, in the Discord app or browser.
registerIpc("open-discord-server", () => {
  if (!/^\d{5,25}$/.test(String(config.guildDiscordId || ""))) return false;
  shell.openExternal(`https://discord.com/channels/${config.guildDiscordId}`);
  return true;
});
registerIpc("open-battlenet", () => shell.openExternal(new URL("/me/battlenet", engineModules.checkUrl(config.uploadUrl || "https://guilded.kcaron.top")).href));
registerIpc("recover-sync", () => engine.resume());

// Problems panel: Copy report for the developer. Built here from the allowlisted summary
// (companion/problems.mjs, companion/sync-status.mjs) and put on the clipboard; the page only
// shows it. No path, name, server message or credential is in it.
registerIpc("copy-problem-report", () => {
  const state = engine.state();
  const report = engineModules.problemReport({ problems: problems(state), config, state, evidence: state.syncEvidence ?? {}, companionVersion: app.getVersion() });
  clipboard.writeText(report.text);
  pushLog({ time: new Date().toISOString(), level: "info", message: E("Report {0} copied for the developer.", report.reference) });
  return { reference: report.reference, text: report.text };
});
// The Forever zip of this release when the folder needs Forever; otherwise the CurseForge page.
// The website's copy first; the GitHub one when the website does not have this version or does not answer.
registerIpc("open-addon-download", async () => {
  const edition = savedFile?.addon?.expected, version = app.getVersion();
  const primary = engineModules.addonDownloadUrl?.(edition, version) ?? "https://www.curseforge.com/wow/addons/guilded";
  const mirror = engineModules.addonDownloadMirror?.(edition, version) ?? primary;
  let target = primary;
  if (mirror !== primary) {
    const found = await fetch(primary, { method: "HEAD", headers: { "user-agent": "Guilded-Companion" }, signal: AbortSignal.timeout(5_000) }).then((response) => response.ok, () => false);
    if (!found) target = mirror;
  }
  return shell.openExternal(target);
});
// Downloads this release's Forever zip, checks it against the release's SHA256SUMS, refuses while
// WoW runs, backs up an existing Guilded folder and puts the new one in AddOns.
let addonInstalling = false;
// Throws with the reason; the IPC, Repair and the automatic update word it their own way.
async function installAddonNow({ refresh = true, force = false } = {}) {
  if (addonInstalling) throw new Error(T("The addon is already being installed."));
  addonInstalling = true;
  try {
    if (refresh) await refreshSavedFile();
    const disk = checkDisk();
    if (!disk.ok) throw new Error(lowDiskMessage(disk));
    const running = process.platform === "win32" ? await wowIsRunning() : false;
    const result = await addonInstallerModule().installAddon({ addon: savedFile?.addon, companionVersion: app.getVersion(), wowRunning: running, force });
    pushLog({ time: new Date().toISOString(), level: "info", message: result.backup ? E("Guilded addon {0} installed in {1}. The previous Guilded folder was moved to {2}.", result.version, result.folder, result.backup) : E("Guilded addon {0} installed in {1}.", result.version, result.folder) });
    // Every other installed Guilded addon (GuildedDungeons) goes with it; a failing one is said, never silent.
    for (const extra of (result.updated ?? []).filter((entry) => entry.name !== "Guilded")) pushLog({ time: new Date().toISOString(), level: "info", message: E("Also installed {0} {1} in {2}.", extra.name, result.version, extra.folder) });
    for (const failure of result.failed ?? []) pushLog({ time: new Date().toISOString(), level: "warn", message: E("Could not update {0}: {1}", failure.name, failure.message) });
    return result;
  } catch (error) {
    pushLog({ time: new Date().toISOString(), level: "warn", message: E("The Guilded addon could not be installed: {0}", error instanceof Error ? error.message : String(error)) });
    throw error;
  } finally {
    addonInstalling = false;
    if (engine) onState(engine.state());
  }
}
registerIpc("reinstall-addon", () => installAddonAnswer(true));
registerIpc("install-addon", () => installAddonAnswer(false));
async function installAddonAnswer(force) {
  try {
    const result = await installAddonNow({ force });
    await refreshSavedFile();
    return { ok: true, message: T("Guilded {0} is installed. Start WoW, open AddOns at the character screen, tick Guilded, then log in.", result.version) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
// Guilded Setup keeps both up to date (owner batch 3 #3; 9.1.3): the companion updates itself (direct
// build, or F5 on the Store) and the addons follow by themselves: a missing or older Guilded, or an older
// GuildedDungeons beside it, is replaced right away when WoW is closed, otherwise the moment WoW exits
// (checkWowRunning looks again). The old folders are kept in Interface\Guilded backups and a short
// notice says what happened. A failed try is repeated every 10 minutes and, until it works, shows as a
// problem with the manual button as the fallback. "Install updates automatically" off stops all of it.
async function maybeAutoUpdateAddon(addon) {
  if (addonAutoUpdating || config.autoUpdate === false || config.wowEnabled === false || !addon) return;
  const decision = addonInstallerModule().decideAddonInstall({ addon, companionVersion: app.getVersion(), wowRunning: false });
  const wanted = decision.action === "install" || (decision.action === "update" && (decision.reason === "older" || decision.reason === "unknown-version"));
  if (!wanted) { if (addonUpdateFailed) { addonUpdateFailed = false; if (engine) onState(engine.state()); } return; }
  // WoW holds the addon files: wait for it (the next check after it exits comes back here).
  if (process.platform === "win32" && await wowIsRunning()) return;
  if (addonUpdateFailed && Date.now() - addonUpdateFailedAt < 10 * 60 * 1000) return;
  addonAutoUpdating = true;
  try {
    const result = await installAddonNow({ refresh: false });
    addonUpdateFailed = false;
    const names = (result.updated ?? []).map((entry) => entry.name).join(", ");
    pushLog({ time: new Date().toISOString(), level: "ok", message: E("Guilded addons updated to {0} ({1}). Type /reload in WoW, or start it, to use them.", result.version, names || "Guilded") });
    if (Notification.isSupported()) new Notification({ title: T("Guilded addon updated to {0}", result.version), body: T("Start WoW, or type /reload, to use it. Your old version is kept in Interface\\Guilded backups."), icon: asset("icon.png") }).show();
    setTimeout(() => void refreshSavedFile(), 1000);
  } catch (error) {
    // WoW started in between: not a failure, the next exit tries again.
    if (!/Exit World of Warcraft first/.test(error instanceof Error ? error.message : String(error))) { addonUpdateFailed = true; addonUpdateFailedAt = Date.now(); }
  } finally {
    addonAutoUpdating = false;
    if (engine) onState(engine.state());
  }
}
// Repair (owner batch 3 #3): re-check the WoW folder, the addon, the sign-in, the link and the
// sync, fix what can be fixed here, and say what was done (companion-app/repair.cjs).
registerIpc("repair", async () => {
  const repair = require("./repair.cjs");
  const results = await repair.runRepair({
    wowEnabled: config.wowEnabled !== false,
    watchFile: () => config.watchFile || null,
    watchedFileExists: async () => { try { await fs.promises.access(path.dirname(config.watchFile)); return true; } catch { return fs.existsSync(path.dirname(path.dirname(config.watchFile))); } },
    searchWow: () => searchWow(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions()),
    pick: (entries) => pickPrimaryAccount(entries.filter((entry) => entry.exists)) || pickSavedVariables(entries.filter((entry) => !/beta/i.test(entry.game))),
    setWatchFile: async (file) => { config = { ...config, watchFile: file, wowEnabled: true }; await saveConfig(); await engine?.configure(config); },
    addonDecision: async () => { await refreshSavedFile(); return { ...addonInstallerModule().decideAddonInstall({ addon: savedFile?.addon, companionVersion: app.getVersion(), wowRunning: process.platform === "win32" ? await wowIsRunning() : false, wowEnabled: config.wowEnabled !== false }), installed: savedFile?.addon?.version ?? null, companion: app.getVersion() }; },
    settingsSave: () => storeConfig.status(),
    installAddon: () => installAddonNow(),
    diskSpace: () => checkDisk(),
    signedIn: () => Boolean(config.companionCredential),
    me: () => companionMeFetch(),
    syncConfigured: () => engineModules.validateConfig(config).length === 0,
    syncRunning: () => Boolean(engine?.state().running),
    restartSync: async () => { await engine?.configure(config); }
  });
  const summary = repair.repairSummary(results);
  pushLog({ time: new Date().toISOString(), level: summary.failed || summary.needsYou ? "warn" : "ok", message: E("Repair: {0} fixed, {1} need you, {2} failed.", summary.fixed, summary.needsYou, summary.failed) });
  await refreshSavedFile();
  if (engine) onState(engine.state());
  return { results, summary };
});
registerIpc("set-online", (_event, value) => { online = value; if (engine) onState(engine.state()); return true; });
// Folder picker (8.5, track F3): opens at the WoW install folder and finds the account folders
// below whatever the member picks. One account: the page fills it in. Several: the member chooses.
registerIpc("pick-wow-folder", async () => {
  const found = searchWow(savedNames(), engineModules.isOtherEditionFolder, wowSearchOptions());
  const start = pickerStart(config.watchFile, found.entries, found.installs);
  const result = await dialog.showOpenDialog(win, {
    title: T("Choose your World of Warcraft folder"),
    ...(start ? { defaultPath: start } : {}),
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, accounts: [] };
  const accounts = accountsUnder(result.filePaths[0], savedNames(), engineModules.isOtherEditionFolder);
  const picked = pickSavedVariables(accounts.filter((entry) => entry.exists));
  return {
    canceled: false,
    accounts: accounts.map((entry) => ({ path: entry.path, account: entry.account, game: entry.game, exists: entry.exists, savedAt: entry.modifiedMs ? new Date(entry.modifiedMs).toISOString() : null, suggested: !!picked && picked.path === entry.path }))
  };
});
