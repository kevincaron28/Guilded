const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, Notification, safeStorage, powerMonitor } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { detectSavedVariables } = require("./detect-wow.cjs");
const updates = require("./update-check.cjs");
const STORE_PACKAGE = process.windowsStore === true;
const STORE_UPDATES = "ms-windows-store://downloadsandupdates";
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
  standingsIntervalMinutes: 2
};

// `electron .` includes the app path; an installed executable starts with its
// first option immediately after argv[0]. Keep --hidden on Windows login.
const args = process.argv.slice(process.defaultApp ? 2 : 1);
const startHidden = args.includes("--hidden");
const screenshotPath = (args.find((a) => a.startsWith("--screenshot=")) ?? "").slice("--screenshot=".length);
const screenshotTab = (args.find((a) => a.startsWith("--tab=")) ?? "").slice("--tab=".length);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

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

async function loadConfig() {
  const saved = STORE_PACKAGE ? await storeConfig.read(configFile())
    : await storeConfig.migrate(configFile(), path.join(app.getPath("userData"), "config.json"));
  if (saved !== null) { config = { ...DEFAULTS, ...saved }; return; }
  if (STORE_PACKAGE) return;
  // Carry over the command-line companion's settings when running from the repo.
  if (args.includes("--fresh")) return;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "companion", "companion.config.json"), "utf8"));
    config = { ...DEFAULTS, ...old };
    await saveConfig();
  } catch { /* nothing to import */ }
}

function saveConfig() {
  return storeConfig.write(configFile(), config);
}

async function loadEngineModules() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(__dirname, "..", "companion");
  const url = (file) => pathToFileURL(path.join(dir, file)).href;
  const [engineModule, standingsModule, requestModule, sheetModule, liveFolderModule] = await Promise.all([import(url("engine.mjs")), import(url("standings.mjs")), import(url("request.mjs")), import(url("sheet-export.mjs")), import(url("live-folder.mjs"))]);
  return { ...engineModule, ...standingsModule, ...requestModule, ...await import(url("profile-engine.mjs")), ...await import(url("profiles.mjs")), ...await import(url("revoke.mjs")), ...await import(url("grm-migration.mjs")), ...await import(url("loot-history-import.mjs")), sheetFiles: sheetModule.sheetFiles, checkSavedFile: liveFolderModule.checkSavedFile };
}

function pushLog(entry) {
  logs.push(entry);
  if (logs.length > 300) logs.shift();
  win?.webContents.send("log", entry);
}

// What the tray icon and the window's header say about the whole app.
function health(state) {
  const problems = engineModules.validateConfig(config);
  if (problems.length > 0) return { level: "setup", text: "Setup needed" };
  if (!state.running) return { level: "error", text: "Not running" };
  if (state.uploadError || state.standingsError) return { level: "error", text: state.uploadError || state.standingsError };
  if (state.poe?.error) return { level: "error", text: state.poe.error };
  if (state.poe?.pending) return { level: "setup", text: `PoE2: ${state.poe.pending} visit(s) waiting to sync` };
  if (state.pendingUpload) return { level: "setup", text: state.retryAt ? `Upload pending; retry at ${state.retryAt}` : "Uploading saved data..." };
  return { level: "ok", text: "Running: watching for changes" };
}

// A newer Guilded release, shown on Overview, in the tray and once as a Windows notification.
let update = null;
let latestRelease = null;

function refreshUpdate(state = engine?.state()) {
  if (STORE_PACKAGE) { update = null; return; }
  const next = updates.pickUpdate(app.getVersion(), latestRelease, state?.botVersion);
  // The bot can announce the version before GitHub provides the installer.
  // Refresh the metadata even for the same version; notification dedup is below.
  update = next;
  if (!update || config.updateNotifiedVersion === update.version) return;
  config.updateNotifiedVersion = update.version;
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

async function checkForUpdate() {
  if (STORE_PACKAGE) return;
  latestRelease = await updates.fetchLatestRelease() ?? latestRelease;
  if (engine) onState(engine.state());
}

// Launch-day check (companion/live-folder.mjs): when the watched file last changed, for the
// Overview status line, and the live game's folder to offer when WoW saves somewhere else.
// Checked at start, after each upload or setup change, and every hour.
let savedFile = null;
let savedFileCheck = 0;
let lastUploadAt = null;
const french = () => language() === "fr";

async function refreshSavedFile() {
  const ticket = ++savedFileCheck;
  let result = null;
  if (config.wowEnabled !== false && config.watchFile) {
    try { result = await engineModules.checkSavedFile(config.watchFile, { ignore: config.liveFolderDeclined ?? [] }); } catch { /* checked again within the hour */ }
  }
  if (ticket !== savedFileCheck) return;
  savedFile = result;
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

function onState(state) {
  refreshUpdate(state);
  const status = health(state);
  win?.webContents.send("state", { state, health: status, update, savedFile });
  if (tray) {
    tray.setImage(nativeImage.createFromPath(asset(`tray-${status.level}.png`)).resize({ width: 32, height: 32 }));
    tray.setToolTip(`Guilded Companion\n${M(status.text)}${update ? T("\nUpdate available: {0}", update.version) : ""}${savedFile?.candidate ? T("\nWoW data may have moved: open to check") : ""}`);
  }
  // An upload means the file changed: refresh its date for the status line.
  if (state.lastUpload?.at && state.lastUpload.at !== lastUploadAt) {
    lastUploadAt = state.lastUpload.at;
    void refreshSavedFile();
  }
}

function currentState() {
  const state = engine.state();
  return { state, health: health(state), update, savedFile };
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 600,
    show: false, autoHideMenuBar: true, backgroundColor: "#15120d",
    title: T("Guilded Companion"), icon: asset("icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "index.html"), { query: screenshotTab ? { tab: screenshotTab } : {} });
  win.once("ready-to-show", () => { if (!startHidden || engineModules.validateConfig(config).length > 0) win.show(); });
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
      label: T("Start with Windows"), type: "checkbox", enabled: !STORE_PACKAGE, checked: !STORE_PACKAGE && app.getLoginItemSettings().openAtLogin,
      click: (item) => { setAutostart(item.checked); }
    },
    { label: T("Quit (stops sending data)"), click: () => { quitting = true; app.quit(); } },
    { label: T("Remove all data and quit..."), click: () => { void removeAllDataAndQuit(); } }
  ]));
  rebuild();
  tray.on("right-click", rebuild);
}

function setAutostart(on) {
  if (STORE_PACKAGE) return false; // Package startup is managed by Windows, never a Run registry entry.
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
  return app.getLoginItemSettings().openAtLogin;
}

// "Clean my computer": stop watching, turn off Start with Windows (so the
// registry Run key does not outlive this install), delete the saved config
// (bot address, upload token, companion credential) and Electron's cache
// under userData, then quit. Uninstalling normally (Add/Remove Programs)
// does the same via the nsis "deleteAppDataOnUninstall" option and
// installer.nsh, for anyone who uninstalls without opening the app first.
async function removeAllDataAndQuit() {
  const choice = dialog.showMessageBoxSync(win ?? undefined, {
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
  exitFlushed = true;
  app.quit();
  return true;
}

app.on("second-instance", showWindow);

// A startup failure must be loud: otherwise the process lives on with no
// window and no tray, holding the single-instance lock, so every later launch
// quits silently and the installer reports the app as "already running".
function failStartup(error) {
  dialog.showErrorBox(T("Guilded Companion could not start"), T("{0}\n\nReinstall Guilded Companion. If this keeps happening, send this message to your guild's officers.", error?.stack ?? error));
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    storeConfig = require("./store-config.cjs").createStoreConfig(safeStorage);
    engineModules = await loadEngineModules();
    await loadConfig();
    try { const preference = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "language.json"), "utf8")); if (["en", "fr"].includes(preference.language)) selectedLanguage = preference.language; } catch { /* use system language */ }
    config.poeJournalFile = profileJournalFile();
    engine = engineModules.createProfileEngine(config, {
      profileConfig: (id, current) => ({ ...current, poeJournalFile: path.join(app.getPath("userData"), id === "default" ? "poe-journal.json" : `poe-journal-${id}.json`) }),
      onLog: (entry) => pushLog(entry),
      onState
    });
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
    setAutostart(true);
  }
  await engine.start();
  powerMonitor.on("suspend", () => { void engine.suspend().catch(error => pushLog({ level: "error", time: new Date().toISOString(), message: error.message })); });
  powerMonitor.on("resume", () => { void engine.resume().catch(error => pushLog({ level: "error", time: new Date().toISOString(), message: error.message })); });
  onState(engine.state());
  void refreshSavedFile();
  setInterval(() => void refreshSavedFile(), 60 * 60 * 1000);
  // Look for a newer release shortly after start, then twice a day.
  setTimeout(() => void checkForUpdate(), 20_000);
  setInterval(() => void checkForUpdate(), 12 * 60 * 60 * 1000);

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
      dialog.showErrorBox(T("Guilded Companion could not save settings"), error.message);
    });
  }
});

registerIpc("get-all", () => ({ config: require("./ipc-security.cjs").rendererConfig(config), language: language(), logs, ...currentState(), storePackage: STORE_PACKAGE, autostart: !STORE_PACKAGE && app.getLoginItemSettings().openAtLogin, version: app.getVersion() }));
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
registerIpc("dismiss-live-folder", async () => {
  const candidate = savedFile?.candidate;
  if (candidate) {
    config.liveFolderDeclined = [...(config.liveFolderDeclined ?? []), candidate.path].slice(-20);
    await saveConfig();
  }
  await refreshSavedFile();
  return true;
});

registerIpc("open-update", () => shell.openExternal(STORE_PACKAGE ? STORE_UPDATES : update?.url || updates.RELEASES_PAGE));
registerIpc("open-startup-settings", () => shell.openExternal("ms-settings:startupapps"));

// "Update now" (7.2): download the checked installer, run it silently and quit; the installer
// restarts the companion. Settings, the Discord link and the queue stay in the user data folder.
let installing = false;
registerIpc("install-update", async () => {
  if (STORE_PACKAGE) {
    await shell.openExternal(STORE_UPDATES);
    return { ok: true, action: "store", message: T("Use Microsoft Store to update this installation.") };
  }
  if (installing) return { ok: false, message: T("The update is already downloading.") };
  installing = true;
  let handedOff = false;
  try {
    // Retry metadata on click, including when the startup GitHub request failed.
    await checkForUpdate();
    const selected = update;
    if (!selected) return { ok: true, action: "current", message: T("Your companion is up to date.") };
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

// A pairing code or a Discord sign-in: both end with the same credential and settings.
async function applyPairing(next, result) {
  if (!result.ok) return result;
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
registerIpc("sign-in-start", async (_event, next) => {
  endSignIn(signIn);
  signIn = null;
  // Without a free local port the sign-in still works the 7.2 way, with the code.
  const loopback = require("./sign-in-loopback.cjs").startSignInLoopback({ onProof: () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } } });
  const port = await loopback.ready.catch(() => null);
  if (!port) loopback.close();
  const started = await engineModules.startSignIn({ ...config, ...next }, port ? { loopback: port } : {});
  if (!started.ok) { if (port) loopback.close(); return started; }
  signIn = { controller: new AbortController(), started, next, ...(port ? { loopback } : {}) };
  await shell.openExternal(started.url);
  return { ok: true, confirm: started.confirm, url: started.url, automatic: !!port };
});
registerIpc("sign-in-wait", async () => {
  const current = signIn;
  if (!current) return { ok: false, message: T("Choose Sign in with Discord first.") };
  const result = await engineModules.waitForSignIn({ ...config, ...current.next, uploadUrl: current.started.uploadUrl }, current.started.requestId, { signal: current.controller.signal, proof: () => current.loopback?.proof() });
  current.loopback?.close();
  if (signIn === current) signIn = null;
  return applyPairing(current.next, result);
});
registerIpc("sign-in-cancel", () => { endSignIn(signIn); signIn = null; return { ok: true }; });

registerIpc("browse-file", async () => {
  const start = config.watchFile ? path.dirname(config.watchFile) : undefined;
  const result = await dialog.showOpenDialog(win, {
    title: config.personal
      ? T("Pick GuildedDungeons.lua or Guilded.lua (inside WTF > Account > your account > SavedVariables)")
      : T("Pick Guilded.lua (inside WTF > Account > your account > SavedVariables)"),
    ...(start ? { defaultPath: start } : {}),
    properties: ["openFile"], filters: [{ name: T("Addon saved data"), extensions: ["lua"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

// Leaderboards only: either addon's file; the engine then reads both from that folder.
registerIpc("detect-wow", () => detectSavedVariables(config.personal ? ["GuildedDungeons.lua", "Guilded.lua"] : ["Guilded.lua"]));
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
let lootHistoryConverter;
function lootConverter() {
  return lootHistoryConverter ??= require("./loot-history-import.cjs").createLootHistoryConverter({ dialog, fs: fs.promises,
    readLootImportFile: engineModules.readLootImportFile, previewLootHistory: engineModules.previewLootHistory,
    createLootHistoryArchive: engineModules.createLootHistoryArchive, getWindow: () => win, T });
}
registerIpc("loot-history-preview", (_event, options) => lootConverter().preview(options));
registerIpc("loot-history-save", (_event, options) => lootConverter().save(options));
registerIpc("refresh-standings", async () => { await engine.refreshStandings(); return true; });
registerIpc("set-autostart", (_event, on) => setAutostart(on));
registerIpc("open-addon-folder", () => {
  const target = engineModules.resolveStandingsPath(config);
  if (target) shell.showItemInFolder(target);
  return !!target;
});
registerIpc("remove-data", () => removeAllDataAndQuit());
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
  if (!config.companionCredential) return { ok: false, error: "Connect your Discord account first." };
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
registerIpc("manage-view", () => manageRequest(null));
registerIpc("manage-edit", (_event, change) => manageRequest(change));
registerIpc("open-online", () => {
  engineModules.checkUrl(config.uploadUrl);
  const url = new URL("/companion/", config.uploadUrl);
  if (config.guildDiscordId) url.searchParams.set("guild", config.guildDiscordId);
  return shell.openExternal(url.href);
});

registerIpc("open-connections", () => shell.openExternal(new URL("/me/connections", engineModules.checkUrl(config.uploadUrl || "https://guilded.kcaron.top")).href));
registerIpc("open-battlenet", () => shell.openExternal(new URL("/me/battlenet", engineModules.checkUrl(config.uploadUrl || "https://guilded.kcaron.top")).href));
registerIpc("recover-sync", () => engine.resume());
