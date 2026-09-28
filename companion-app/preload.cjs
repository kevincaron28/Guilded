const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  getAll: () => ipcRenderer.invoke("get-all"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  testConnection: (config) => ipcRenderer.invoke("test-connection", config),
  pairAccount: (config) => ipcRenderer.invoke("pair-account", config),
  browseFile: () => ipcRenderer.invoke("browse-file"),
  detectWow: () => ipcRenderer.invoke("detect-wow"),
  uploadNow: () => ipcRenderer.invoke("upload-now"),
  refreshStandings: () => ipcRenderer.invoke("refresh-standings"),
  setAutostart: (on) => ipcRenderer.invoke("set-autostart", on),
  openAddonFolder: () => ipcRenderer.invoke("open-addon-folder"),
  onState: (callback) => ipcRenderer.on("state", (_event, state) => callback(state)),
  onLog: (callback) => ipcRenderer.on("log", (_event, entry) => callback(entry))
});
