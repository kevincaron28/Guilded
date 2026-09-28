import { readFile, access } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { readAddonExport } from "./lua-export.mjs";
import { writeStandings } from "./standings.mjs";

// The companion's working parts, shared by the command-line watcher
// (watcher.mjs) and the desktop app (companion-app/). It watches the addon's
// saved file, uploads changes to the bot, and keeps the addon's Standings.lua
// fresh. Nothing here prints; everything is reported through `hooks`:
//   onLog({ time, level, message })   level: info | ok | warn | error
//   onState(state)                    a snapshot after every change
export function validateConfig(config) {
  const problems = [];
  if (!config.watchFile) problems.push("The saved-data file (Guilded.lua) is not set.");
  if (!config.uploadUrl) problems.push("The bot address is not set.");
  if (!config.guildDiscordId) problems.push("The Discord server ID is not set.");
  if (typeof config.uploadToken !== "string" || config.uploadToken.length < 32) problems.push("The upload token must be at least 32 characters.");
  return problems;
}

// Checks the bot address and token without changing anything.
export async function testConnection(config) {
  try {
    const url = new URL("/api/v1/standings", config.uploadUrl);
    url.searchParams.set("guild", config.guildDiscordId);
    const response = await fetch(url, { headers: { authorization: `Bearer ${config.uploadToken}` }, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, message: `Connected. The bot knows ${body.standings?.length ?? 0} character(s).` };
    if (response.status === 401 || response.status === 403) return { ok: false, message: "The bot refused the token. Check COMPANION_UPLOAD_TOKEN on the bot." };
    return { ok: false, message: `The bot answered ${response.status}: ${describeApiError(response.status, body.error)}` };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export async function pairAccount(config) {
  if (!config.uploadUrl || !config.guildDiscordId || !config.uploadToken || typeof config.pairingCode !== "string" || !config.pairingCode.trim()) {
    return { ok: false, message: "Enter the bot address, upload token, Discord server ID and code from /character pair first." };
  }
  try {
    const url = new URL("/api/v1/addon-pairings", config.uploadUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.uploadToken}`, "content-type": "application/json" },
      body: JSON.stringify({ guildDiscordId: config.guildDiscordId, code: config.pairingCode }),
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: `Pairing failed (${response.status}): ${describeApiError(response.status, body.error)}` };
    if (typeof body.companionCredential !== "string" || body.companionCredential.length < 32) {
      return { ok: false, message: "The bot response did not include a valid companion credential." };
    }
    return { ok: true, message: "Discord account paired. The companion links your own character on its next upload; the guild import still follows its usual apply setting.", companionCredential: body.companionCredential };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

// "fetch failed" tells nobody anything: say what to check.
export function describeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|aborted/i.test(text + (error?.cause?.code ?? ""))) {
    return "Could not reach the bot. Is it running, and is the bot address right?";
  }
  return text;
}

// The bot doesn't recognize this Discord server ID at all (wrong ID, or the
// bot isn't in that server). Distinct from a bad token (401/403) or a config
// problem on the bot's own side.
function describeApiError(status, apiError) {
  if (status === 404 && apiError === "Guild is not initialized") {
    return `${apiError}. Check the Discord server ID: Discord Settings, Advanced, Developer Mode, then right-click your server and Copy Server ID again — paste it in exactly, don't retype it.`;
  }
  return apiError ?? "unknown error";
}

export function createEngine(initialConfig, hooks = {}) {
  let config = initialConfig;
  let watcher;
  let uploadTimer;
  let standingsTimer;
  const state = {
    running: false,
    watching: null,
    lastUpload: null,     // { at, message }
    lastStandings: null,  // { at, message }
    lastError: null,      // { at, message }
    uploads: 0
  };

  const snapshot = () => JSON.parse(JSON.stringify(state));
  const log = (level, message) => {
    const at = new Date().toISOString();
    if (level === "error") state.lastError = { at, message };
    hooks.onLog?.({ time: at, level, message });
    hooks.onState?.(snapshot());
  };

  async function upload() {
    const exported = config.watchFile.toLowerCase().endsWith(".lua")
      ? await readAddonExport(config.watchFile, config.realm)
      : JSON.parse(await readFile(config.watchFile, "utf8"));
    // The saved data belongs to one WoW guild; do not send an alt's other guild.
    if (config.wowGuild && exported.wowGuild && exported.wowGuild !== config.wowGuild) {
      log("warn", `Skipped: the saved data belongs to "${exported.wowGuild}", this companion is for "${config.wowGuild}".`);
      return;
    }
    const response = await fetch(config.uploadUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.uploadToken}`,
        "content-type": "application/json",
        ...(config.companionCredential ? { "x-companion-credential": config.companionCredential } : {})
      },
      body: JSON.stringify({ guildDiscordId: config.guildDiscordId, export: exported })
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const message = body.autoApplied
        ? `Uploaded and applied automatically (${body.autoApplied.epgp} ledger entries, ${body.autoApplied.discovered} new characters).${pairingNote(body.pairedCharacterStatus)}`
        : `Uploaded ${body.transactionCount} ledger entries. Apply on Discord with: /import apply id:${body.importId}.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      state.uploads += 1;
      log("ok", message);
      setTimeout(() => void refreshStandings(), 5000);
    } else if (response.status === 409) {
      const message = `Nothing new since the last upload.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      log("info", message);
    } else {
      log("error", `Upload failed (${response.status}): ${describeApiError(response.status, body.error)}`);
    }
  }

  function pairingNote(status) {
    if (status === "linked") return " Your character was linked to your Discord account.";
    if (status === "already-linked") return " Your character is linked to your Discord account.";
    if (status === "owned-by-another") return " This character is linked to another member; ask an officer to resolve it.";
    if (status === "missing-class" || status === "missing-character") return " The export did not include character details; use /guilded character and /character import.";
    return "";
  }

  function scheduleUpload(delay = 1000) {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => upload().catch((error) => log("error", `Upload failed: ${describeError(error)}`)), delay);
  }

  async function refreshStandings() {
    try {
      const { path, count, unchanged } = await writeStandings(config);
      state.lastStandings = { at: new Date().toISOString(), message: unchanged ? `Standings already up to date (${count} characters).` : `Wrote standings for ${count} character(s).` };
      if (!unchanged) log("ok", `Wrote EPGP standings for ${count} character(s) to ${path}.`);
      else hooks.onState?.(snapshot());
    } catch (error) {
      log("error", `Standings update failed: ${describeError(error)}`);
    }
  }

  async function startWatching() {
    const problems = validateConfig(config);
    if (problems.length > 0) { log("warn", `Not started: ${problems[0]}`); return false; }
    try {
      await access(dirname(config.watchFile));
    } catch {
      log("error", `The folder ${dirname(config.watchFile)} does not exist. Check the saved-data file in Settings.`);
      return false;
    }
    // Watch the folder, not the file: WoW replaces the file on save.
    const name = basename(config.watchFile).toLowerCase();
    watcher = watch(dirname(config.watchFile), (_event, filename) => {
      if (filename && filename.toString().toLowerCase() === name) scheduleUpload();
    });
    watcher.on("error", (error) => log("error", `File watch stopped: ${error.message}`));
    state.running = true;
    state.watching = config.watchFile;
    log("info", `Watching ${config.watchFile}`);
    await refreshStandings();
    standingsTimer = setInterval(refreshStandings, Math.max(1, Number(config.standingsIntervalMinutes) || 2) * 60 * 1000);
    return true;
  }

  return {
    state: snapshot,
    async start() { await this.stop(); return startWatching(); },
    async stop() {
      clearTimeout(uploadTimer); clearInterval(standingsTimer);
      watcher?.close(); watcher = undefined;
      const was = state.running;
      state.running = false; state.watching = null;
      if (was) log("info", "Stopped."); else hooks.onState?.(snapshot());
    },
    // Apply new settings and restart.
    async configure(next) { config = next; return this.start(); },
    uploadNow() { scheduleUpload(0); },
    refreshStandings
  };
}
