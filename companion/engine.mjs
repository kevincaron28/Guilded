import { readFile, access } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { readAddonExport } from "./lua-export.mjs";
import { writeStandings } from "./standings.mjs";
import { credentialHeaders, checkUrl, requestJson } from "./request.mjs";

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
  if (typeof config.companionCredential !== "string" || config.companionCredential.length < 32) problems.push("Link this companion with /character pair before starting.");
  if (config.uploadUrl) { try { checkUrl(config.uploadUrl); } catch (error) { problems.push(error.message); } }
  return problems;
}

// Checks the bot address and token without changing anything.
export async function testConnection(config) {
  try {
    const url = new URL("/api/v1/standings", config.uploadUrl);
    url.searchParams.set("guild", config.guildDiscordId);
    const { response, body } = await requestJson(url, { headers: credentialHeaders(config) });
    if (response.ok) return { ok: true, message: `Connected. The bot knows ${body.standings?.length ?? 0} character(s).` };
    if (response.status === 401 || response.status === 403) return { ok: false, message: "The bot refused the pairing. Run /character pair and link this companion again." };
    return { ok: false, message: `The bot answered ${response.status}: ${describeApiError(response.status, body.error)}` };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export async function pairAccount(config) {
  if (!config.uploadUrl || !config.guildDiscordId || typeof config.pairingCode !== "string" || !config.pairingCode.trim()) {
    return { ok: false, message: "Enter the bot address, Discord server ID and code from /character pair first." };
  }
  try {
    const url = new URL("/api/v1/addon-pairings", config.uploadUrl);
    const { response, body } = await requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildDiscordId: config.guildDiscordId, code: config.pairingCode }),
      signal: AbortSignal.timeout(10_000)
    });
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
  let controller = new AbortController();
  let uploading = false;
  let refreshing = false;
  let queued = false;
  let generation = 0;
  let failures = 0;
  const active = new Set();
  const state = {
    running: false,
    watching: null,
    lastUpload: null,     // { at, message }
    lastStandings: null,  // { at, message }
    lastError: null,      // { at, message }
    botVersion: null,
    addonVersion: null,
    pendingUpload: false,
    retryAt: null,
    uploadError: null,
    standingsError: null,
    uploads: 0
  };

  const snapshot = () => JSON.parse(JSON.stringify(state));
  const log = (level, message) => {
    for (const secret of [config.companionCredential, config.uploadToken, config.pairingCode]) {
      if (typeof secret === "string" && secret.length >= 6) message = message.replaceAll(secret, "[redacted]");
    }
    const at = new Date().toISOString();
    if (level === "error") state.lastError = { at, message };
    hooks.onLog?.({ time: at, level, message });
    hooks.onState?.(snapshot());
  };

  async function upload() {
    if (!state.running) return;
    if (uploading) { queued = true; return; }
    uploading = true;
    queued = false;
    const epoch = generation;
    const current = { ...config };
    state.pendingUpload = true;
    state.retryAt = null;
    try {
    const exported = current.watchFile.toLowerCase().endsWith(".lua")
      ? await readAddonExport(current.watchFile, current.realm)
      : JSON.parse(await readFile(current.watchFile, "utf8"));
    // The saved data belongs to one WoW guild; do not send an alt's other guild.
    if (current.wowGuild && exported.wowGuild && exported.wowGuild !== current.wowGuild) {
      state.pendingUpload = false;
      log("warn", `Skipped: the saved data belongs to "${exported.wowGuild}", this companion is for "${current.wowGuild}".`);
      return;
    }
    const { response, body } = await requestJson(current.uploadUrl, {
      method: "POST",
      headers: { ...credentialHeaders(current), "content-type": "application/json" },
      body: JSON.stringify({ guildDiscordId: current.guildDiscordId, export: exported })
    }, controller.signal);
    if (epoch !== generation) return;
    state.botVersion = body.botVersion ?? state.botVersion;
    state.addonVersion = exported.addonVersion ?? state.addonVersion;
    if (response.ok) {
      const message = body.autoApplied
        ? `Uploaded and applied automatically (${body.autoApplied.epgp} ledger entries, ${body.autoApplied.discovered} new characters).${pairingNote(body.pairedCharacterStatus)}`
        : body.professionRelay
          ? `Professions and recipes synced. Guild ledger imports still await officer review.${pairingNote(body.pairedCharacterStatus)}`
          : `Uploaded ${body.transactionCount} ledger entries. Apply on Discord with: /import apply id:${body.importId}.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      state.uploads += 1;
      log("ok", message);
      void refreshStandings();
    } else if (response.status === 409) {
      const message = body.status === "PREVIEWED"
        ? `Upload is waiting for officer review: /import apply id:${body.importId}.`
        : `Nothing new since the last upload.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      log("info", message);
    } else {
      const error = new Error(`Upload failed (${response.status}): ${describeApiError(response.status, body.error)}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
      state.uploadError = null;
      failures = 0;
      state.pendingUpload = false;
    } catch (error) {
      if (epoch !== generation) return;
      state.uploadError = describeError(error);
      log("error", `Upload failed: ${state.uploadError}`);
      if (error.retryable !== false && state.running) {
        const delay = Math.min(300_000, 5_000 * 2 ** Math.min(failures++, 6));
        state.retryAt = new Date(Date.now() + delay).toISOString();
        scheduleUpload(delay);
      }
    } finally {
      uploading = false;
      if (epoch === generation && state.running && queued) scheduleUpload(0);
      hooks.onState?.(snapshot());
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
    uploadTimer = setTimeout(() => track(upload()), delay);
  }

  function track(promise) { active.add(promise); void promise.finally(() => active.delete(promise)); }

  async function refreshStandings() {
    if (!state.running || refreshing) return;
    refreshing = true;
    const epoch = generation;
    try {
      const { path, count, unchanged, botVersion } = await writeStandings({ ...config }, controller.signal);
      if (epoch !== generation) return;
      state.botVersion = botVersion ?? state.botVersion;
      state.standingsError = null;
      state.lastStandings = { at: new Date().toISOString(), message: unchanged ? `Standings already up to date (${count} characters).` : `Wrote standings for ${count} character(s).` };
      if (!unchanged) log("ok", `Wrote EPGP standings for ${count} character(s) to ${path}.`);
      else hooks.onState?.(snapshot());
    } catch (error) {
      if (epoch !== generation) return;
      state.standingsError = describeError(error);
      log("error", `Standings update failed: ${state.standingsError}`);
    } finally { refreshing = false; hooks.onState?.(snapshot()); }
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
    watcher.on("error", (error) => { state.running = false; log("error", `File watch stopped: ${error.message}. Restart the companion.`); });
    state.running = true;
    state.watching = config.watchFile;
    log("info", `Watching ${config.watchFile}`);
    await refreshStandings();
    scheduleUpload(0);
    standingsTimer = setInterval(() => track(refreshStandings()), Math.max(1, Number(config.standingsIntervalMinutes) || 2) * 60 * 1000);
    return true;
  }

  return {
    state: snapshot,
    async start() { await this.stop(); controller = new AbortController(); return startWatching(); },
    async stop() {
      const was = state.running;
      state.running = false;
      watcher?.close(); watcher = undefined;
      generation++;
      controller.abort();
      clearTimeout(uploadTimer); clearInterval(standingsTimer);
      queued = false;
      await Promise.allSettled([...active]);
      state.pendingUpload = false; state.retryAt = null;
      state.watching = null;
      if (was) log("info", "Stopped."); else hooks.onState?.(snapshot());
    },
    // Apply new settings and restart.
    async configure(next) { await this.stop(); config = next; return this.start(); },
    uploadNow() { scheduleUpload(0); },
    refreshStandings
  };
}
