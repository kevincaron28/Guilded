const { pathToFileURL } = require("node:url");
const path = require("node:path");

const configFields = new Set(["uploadUrl", "guildDiscordId", "pairingCode", "watchFile", "realm", "wowGuild", "standingsIntervalMinutes", "poeLogFile", "poeCharacter", "poeLeague", "poeMode", "wowEnabled", "poeEnabled"]);
const noArgs = new Set(["get-all", "list-profiles", "switch-live-folder", "dismiss-live-folder", "open-update", "open-startup-settings", "install-update", "sign-in-wait", "sign-in-cancel", "browse-file", "detect-wow", "browse-poe-log", "upload-now", "refresh-standings", "open-addon-folder", "remove-data", "toggle-tracking", "get-poe-runs", "manage-view", "open-online"]);
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
  if (["save-config", "test-connection", "pair-account", "sign-in-start"].includes(channel)) {
    object(value, configFields);
    for (const [key, entry] of Object.entries(value)) {
      if (["wowEnabled", "poeEnabled"].includes(key)) { if (typeof entry !== "boolean") fail(); }
      else if (key === "standingsIntervalMinutes") {
        if (!["string", "number"].includes(typeof entry) || !Number.isFinite(Number(entry)) || Number(entry) < 1 || Number(entry) > 1440) fail();
      } else text(entry, key === "pairingCode" ? 64 : 4096);
    }
  } else if (channel === "set-language") {
    if (!["en", "fr"].includes(value)) throw new Error("Unsupported language");
  } else if (channel === "set-autostart") { if (typeof value !== "boolean") fail(); }
  else if (channel === "change-profile") {
    object(value, new Set(["id", "name"]));
    if (Boolean(value.id) === Boolean(value.name)) fail();
    text(value.id || value.name, 80);
  } else if (channel === "export-sheets") { if (value !== undefined && value !== null) text(value, 40); }
  else if (channel === "convert-grm") {
    object(value, new Set(["guild", "realm", "edition", "includePrivate"]));
    text(value.guild, 120); text(value.realm, 120);
    if (!["forever", "classic-era", "classic-tbc", "classic-mists", "retail"].includes(value.edition) || typeof value.includePrivate !== "boolean") fail();
  } else if (channel === "manage-edit") {
    // The server owns the exact action schema and current role checks. Bound the
    // IPC envelope too, before serializing or sending it over the network.
    object(value, new Set(["action", "characterId", "item", "priority", "coreId", "text", "base", "changes", "memberId", "role", "bench", "character"]));
    text(value.action, 40);
    if (JSON.stringify(value).length > 220_000) fail();
  } else fail();
}
function assertSender(event, win, directory) {
  const contents = win?.webContents;
  if (!contents || event?.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error("Untrusted companion window.");
  const url = new URL(event.senderFrame.url);
  url.search = ""; url.hash = "";
  if (url.href !== pathToFileURL(path.join(directory, "renderer", "index.html")).href) throw new Error("Untrusted companion window.");
}
function rendererConfig(config) {
  const result = { ...config };
  delete result.profiles;
  delete result.uploadToken;
  result.pairingCode = "";
  // Existing UI uses this only as a connected flag; never expose the credential.
  result.companionCredential = config.companionCredential ? "connected" : "";
  return result;
}
module.exports = { validateIpc, assertSender, rendererConfig };
