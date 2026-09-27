const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { detectSavedVariables } = require("./detect-wow.cjs");

// Guilded Companion: a tray app around companion/engine.mjs. The window is
// for setup and a look at what is happening; day to day it lives in the tray.

const DEFAULTS = {
  watchFile: "",
  realm: "WoW Forever",
  wowGuild: "",
  uploadUrl: "https://guildedqc.duckdns.org/api/v1/addon-imports",
  guildDiscordId: "",
  uploadToken: "",
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
  const [engineModule, standingsModule] = await Promise.all([import(url("engine.mjs")), import(url("standings.mjs"))]);
  return { ...engineModule, ...standingsModule };
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
  if (state.lastError && (!state.lastStandings || state.lastError.at > state.lastStandings.at) && (!state.lastUpload || state.lastError.at > state.lastUpload.at)) {
    return { level: "error", text: "Problem: " + state.lastError.message };
  }
  return { level: "ok", text: "Running: watching for changes" };
}

function onState(state) {
  const status = health(state);
  win?.webContents.send("state", { state, health: status });
  if (tray) {
    tray.setImage(nativeImage.createFromPath(asset(`tray-${status.level}.png`)));
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
    width: 900, height: 660, minWidth: 720, minHeight: 520,
    show: false, autoHideMenuBar: true, backgroundColor: "#15120d",
    title: "Guilded Companion", icon: asset("icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: false }
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
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset("tray-setup.png")));
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
    { label: "Quit (stops sending data)", click: () => { quitting = true; app.quit(); } }
  ]));
  rebuild();
  tray.on("right-click", rebuild);
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
  return app.getLoginItemSettings().openAtLogin;
}

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  engineModules = await loadEngineModules();
  loadConfig();
  engine = engineModules.createEngine(config, {
    onLog: (entry) => pushLog(entry),
    onState
  });
  createWindow();
  createTray();
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
});

app.on("window-all-closed", () => { /* stay in the tray */ });
app.on("before-quit", () => { quitting = true; });

ipcMain.handle("get-all", () => ({ config, logs, ...currentState(), autostart: app.getLoginItemSettings().openAtLogin, version: app.getVersion() }));

ipcMain.handle("save-config", async (_event, next) => {
  config = { ...config, ...next, standingsIntervalMinutes: Math.max(1, Number(next.standingsIntervalMinutes) || 2) };
  const problems = engineModules.validateConfig(config);
  saveConfig();
  if (problems.length > 0) { await engine.stop(); onState(engine.state()); return { ok: false, message: problems[0] }; }
  const started = await engine.configure(config);
  return started ? { ok: true, message: "Saved. The companion is running." } : { ok: false, message: "Saved, but it could not start. See the Activity page." };
});

ipcMain.handle("test-connection", (_event, next) => engineModules.testConnection({ ...config, ...next }));

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
ipcMain.handle("upload-now", () => { engine.uploadNow(); return true; });
ipcMain.handle("refresh-standings", async () => { await engine.refreshStandings(); return true; });
ipcMain.handle("set-autostart", (_event, on) => setAutostart(on));
ipcMain.handle("open-addon-folder", () => {
  const target = engineModules.resolveStandingsPath(config);
  if (target) shell.showItemInFolder(target);
  return !!target;
});
