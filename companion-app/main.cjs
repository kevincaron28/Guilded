const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { detectSavedVariables } = require("./detect-wow.cjs");

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
  uploadUrl: "https://guildedqc.duckdns.org/api/v1/addon-imports",
  guildDiscordId: "",
  uploadToken: "",
  pairingCode: "",
  companionCredential: "",
  standingsIntervalMinutes: 2
};

const args = process.argv.slice(2);
const startHidden = args.includes("--hidden");
const screenshotPath = (args.find((a) => a.startsWith("--screenshot=")) ?? "").slice("--screenshot=".length);
const screenshotTab = (args.find((a) => a.startsWith("--tab=")) ?? "").slice("--tab=".length);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win;
let tray;
let engine;
let engineModules;
let quitting = false;
let config = { ...DEFAULTS };
const logs = [];

const configFile = () => path.join(app.getPath("userData"), "config.json");
const asset = (name) => path.join(__dirname, "assets", name);

function loadConfig() {
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile(), "utf8")) };
    return;
  } catch { /* first run */ }
  // Carry over the command-line companion's settings when running from the repo.
  if (args.includes("--fresh")) return;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "companion", "companion.config.json"), "utf8"));
    config = { ...DEFAULTS, ...old };
    saveConfig();
  } catch { /* nothing to import */ }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

async function loadEngineModules() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(__dirname, "..", "companion");
  const url = (file) => pathToFileURL(path.join(dir, file)).href;
  const [engineModule, standingsModule, requestModule] = await Promise.all([import(url("engine.mjs")), import(url("standings.mjs")), import(url("request.mjs"))]);
  return { ...engineModule, ...standingsModule, ...requestModule };
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

function onState(state) {
  const status = health(state);
  win?.webContents.send("state", { state, health: status });
  if (tray) {
    tray.setImage(nativeImage.createFromPath(asset(`tray-${status.level}.png`)).resize({ width: 32, height: 32 }));
    tray.setToolTip(`Guilded Companion\n${status.text}`);
  }
}

function currentState() {
  const state = engine.state();
  return { state, health: health(state) };
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
    title: "Guilded Companion", icon: asset("icon.png"),
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
  tray.setToolTip("Guilded Companion");
  tray.on("click", showWindow);
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Guilded Companion", click: showWindow },
    { type: "separator" },
    { label: "Send my data to Discord now", click: () => engine.uploadNow() },
    { label: "Refresh in-game standings now", click: () => void engine.refreshStandings() },
    { type: "separator" },
    {
      label: "Start with Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { setAutostart(item.checked); }
    },
    { label: "Quit (stops sending data)", click: () => { quitting = true; app.quit(); } },
    { label: "Remove all data and quit...", click: () => { void removeAllDataAndQuit(); } }
  ]));
  rebuild();
  tray.on("right-click", rebuild);
}

function setAutostart(on) {
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
    buttons: ["Cancel", "Remove and quit"],
    defaultId: 0,
    cancelId: 0,
    title: "Remove all data?",
    message: "Stop the companion and remove its saved data from this PC?",
    detail: "This turns off Start with Windows and deletes your settings, Discord link and unsent PoE2 observations. Your game files are untouched. Set it up again any time by reopening Guilded Companion."
  });
  if (choice !== 1) return false;
  setAutostart(false);
  await engine.stop();
  quitting = true;
  // config.json (the token and companion credential) first and on its own:
  // it has no open handle, unlike Chromium's cache files below, which can
  // still be locked while this process is exiting and would otherwise abort
  // the whole recursive delete before reaching it.
  try {
    fs.rmSync(configFile(), { force: true });
  } catch (error) {
    pushLog({ time: new Date().toISOString(), level: "error", message: `Could not remove the saved settings file: ${engineModules.describeError(error)}` });
  }
  try {
    fs.rmSync(app.getPath("userData"), { recursive: true, force: true });
  } catch { /* best effort: leftover cache files, not sensitive */ }
  app.quit();
  return true;
}

app.on("second-instance", showWindow);

// A startup failure must be loud: otherwise the process lives on with no
// window and no tray, holding the single-instance lock, so every later launch
// quits silently and the installer reports the app as "already running".
function failStartup(error) {
  dialog.showErrorBox("Guilded Companion could not start", `${error?.stack ?? error}\n\nReinstall Guilded Companion. If this keeps happening, send this message to your guild's officers.`);
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    engineModules = await loadEngineModules();
    loadConfig();
    config.poeJournalFile = path.join(app.getPath("userData"), "poe-journal.json");
    engine = engineModules.createEngine(config, {
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
    saveConfig();
    setAutostart(true);
  }
  await engine.start();
  onState(engine.state());

  if (screenshotPath) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
      quitting = true;
      app.quit();
    }, 3500));
    win.show();
  }
}).catch(failStartup);

app.on("window-all-closed", () => { /* stay in the tray */ });
app.on("before-quit", () => { quitting = true; });

ipcMain.handle("get-all", () => ({ config, logs, ...currentState(), autostart: app.getLoginItemSettings().openAtLogin, version: app.getVersion() }));

ipcMain.handle("save-config", async (_event, next) => {
  config = { ...config, ...next, poeJournalFile: path.join(app.getPath("userData"), "poe-journal.json"), standingsIntervalMinutes: Math.max(1, Number(next.standingsIntervalMinutes) || 2) };
  const problems = engineModules.validateConfig(config);
  saveConfig();
  if (problems.length > 0) { await engine.stop(); onState(engine.state()); return { ok: false, message: problems[0] }; }
  const started = await engine.configure(config);
  return started ? { ok: true, message: "Saved. The companion is running." } : { ok: false, message: "Saved, but it could not start. See the Activity page." };
});

ipcMain.handle("test-connection", (_event, next) => engineModules.testConnection({ ...config, ...next }));

ipcMain.handle("pair-account", async (_event, next) => {
  const result = await engineModules.pairAccount({ ...config, ...next });
  if (!result.ok) return result;
  config = { ...config, ...next, pairingCode: "", companionCredential: result.companionCredential };
  saveConfig();
  const started = await engine.configure(config);
  return {
    ok: true,
    message: started ? result.message : `${result.message} Finish the remaining settings and choose Save and start.`
  };
});

ipcMain.handle("browse-file", async () => {
  const start = config.watchFile ? path.dirname(config.watchFile) : undefined;
  const result = await dialog.showOpenDialog(win, {
    title: "Pick Guilded.lua (inside WTF > Account > your account > SavedVariables)",
    ...(start ? { defaultPath: start } : {}),
    properties: ["openFile"], filters: [{ name: "Addon saved data", extensions: ["lua"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("detect-wow", () => detectSavedVariables());
ipcMain.handle("browse-poe-log", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Choose Path of Exile 2 > logs > Client.txt",
    properties: ["openFile"], filters: [{ name: "Game log", extensions: ["txt"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("upload-now", () => { engine.uploadNow(); return true; });
ipcMain.handle("refresh-standings", async () => { await engine.refreshStandings(); return true; });
ipcMain.handle("set-autostart", (_event, on) => setAutostart(on));
ipcMain.handle("open-addon-folder", () => {
  const target = engineModules.resolveStandingsPath(config);
  if (target) shell.showItemInFolder(target);
  return !!target;
});
ipcMain.handle("remove-data", () => removeAllDataAndQuit());
ipcMain.handle("toggle-tracking", async () => {
  if (engine.state().running) await engine.stop();
  else await engine.start();
  onState(engine.state());
  return currentState();
});
ipcMain.handle("get-poe-runs", async () => {
  const url = new URL("/api/v1/poe/visits", config.uploadUrl);
  url.searchParams.set("guild", config.guildDiscordId);
  const { response, body } = await engineModules.requestJson(url, { headers: engineModules.credentialHeaders(config) });
  if (!response.ok) throw new Error(body.error || "Could not load your map history.");
  return body.visits;
});
ipcMain.handle("open-online", () => {
  engineModules.checkUrl(config.uploadUrl);
  const url = new URL("/companion/", config.uploadUrl);
  if (config.guildDiscordId) url.searchParams.set("guild", config.guildDiscordId);
  return shell.openExternal(url.href);
});
