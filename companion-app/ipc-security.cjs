const { pathToFileURL } = require("node:url");
const path = require("node:path");

const configFields = new Set(["uploadUrl", "guildDiscordId", "pairingCode", "watchFile", "realm", "wowGuild", "standingsIntervalMinutes", "poeLogFile", "poeCharacter", "poeLeague", "poeMode", "wowEnabled", "poeEnabled", "syncEnabled"]);
const noArgs = new Set(["account-no", "account-yes", "companion-me", "copy-problem-report", "get-all", "install-addon", "reinstall-addon", "install-update", "open-connections", "open-storage-settings", "open-store-listing", "open-update", "pick-wow-folder", "recover-sync", "remove-data", "repair", "sign-in-cancel", "sign-in-switch", "sign-in-wait", "switch-live-folder", "toggle-tracking", "upload-now"]);
function fail() { throw new Error("Invalid companion request."); }
function object(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  for (const key of Object.keys(value)) if (!fields.has(key)) fail();
  return value;
}
function text(value, max = 4096) { if (typeof value !== "string" || value.length > max || value.includes("\0")) fail(); }
function validateIpc(channel, args) {
  if (noArgs.has(channel)) { if (args.length) fail(); return; }
  if (args.length !== 1) fail();
  const value = args[0];
  if (channel === "sign-in-start") {
    object(value, configFields);
    for (const [key, entry] of Object.entries(value)) {
      if (["wowEnabled", "poeEnabled", "syncEnabled"].includes(key)) { if (typeof entry !== "boolean") fail(); }
      else if (key === "standingsIntervalMinutes") {
        if (!["string", "number"].includes(typeof entry) || !Number.isFinite(Number(entry)) || Number(entry) < 1 || Number(entry) > 1440) fail();
      } else text(entry, key === "pairingCode" ? 64 : 4096);
    }
  } else if (channel === "set-language") {
    if (!["en", "fr"].includes(value)) throw new Error("Unsupported language");
  } else if (channel === "set-autostart" || channel === "set-auto-update" || channel === "set-online") { if (typeof value !== "boolean") fail(); }
  // Zero-setup companion: "Advanced: choose server", a Discord server ID or "" for automatic.
  else if (channel === "set-account") { object(value, new Set(["file", "on"])); text(value.file, 1024); if (typeof value.on !== "boolean") fail(); }
  else if (channel === "device-choose-server") { if (typeof value !== "string" || !/^(\d{5,25})?$/.test(value)) fail(); }
  else if (channel === "export-sheets") { if (value !== undefined && value !== null) text(value, 40); }
  else if (channel === "convert-grm") {
    object(value, new Set(["guild", "realm", "edition", "includePrivate"]));
    text(value.guild, 120); text(value.realm, 120);
    if (value.edition !== "forever" || typeof value.includePrivate !== "boolean") fail();
  } else fail();
}
function assertSender(event, win, directory) {
  const contents = win?.webContents;
  if (!contents || event?.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error("Untrusted companion window.");
  const url = new URL(event.senderFrame.url);
  url.search = ""; url.hash = "";
  const trusted = ["main.html"].map((file) => pathToFileURL(path.join(directory, "renderer", file)).href);
  if (!trusted.includes(url.href)) throw new Error("Untrusted companion window.");
}
function rendererConfig(config) {
  const result = { ...config };
  delete result.profiles;
  delete result.uploadToken;
  delete result.pendingUpdate; // a local installer path the page never needs
  result.pairingCode = "";
  // Existing UI uses this only as a connected flag; never expose the credential.
  result.companionCredential = config.companionCredential ? "connected" : "";
  // Zero-setup companion: the device key never reaches the page, only whether there is one.
  if (config.deviceSecret) result.deviceSecret = "set";
  return result;
}
module.exports = { validateIpc, assertSender, rendererConfig };
