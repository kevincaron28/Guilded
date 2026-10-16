import { readFile, access, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { readAddonExport } from "./lua-export.mjs";
import { standingsFileHolds, writeStandings } from "./standings.mjs";
import { credentialHeaders, checkUrl, requestJson, jsonBody, MAX_UPLOAD_BYTES } from "./request.mjs";
import { acknowledgements, pruneAcknowledged } from "./delta.mjs";
import { createPoeEngine, validatePoeConfig } from "./poe-engine.mjs";

// The companion's working parts, shared by the command-line watcher
// (watcher.mjs) and the desktop app (companion-app/). It watches the addon's
// saved file, uploads changes to the bot, and keeps the addon's Standings.lua
// fresh. Nothing here prints; everything is reported through `hooks`:
//   onLog({ time, level, message })   level: info | ok | warn | error
//   onState(state)                    a snapshot after every change
export function validateConfig(config) {
  const problems = [];
  if (config.wowEnabled !== false && !config.watchFile) problems.push("The saved-data file (Guilded.lua) is not set.");
  if (config.wowEnabled === false && !config.poeEnabled) problems.push("Enable WoW or PoE2 tracking before starting.");
  if (!config.uploadUrl) problems.push("The bot address is not set.");
  if (!config.guildDiscordId) problems.push("The Discord server ID is not set.");
  if (typeof config.companionCredential !== "string" || config.companionCredential.length < 32) problems.push("Link this companion with /character pair or /poe pair before starting.");
  if (config.uploadUrl) { try { checkUrl(config.uploadUrl); } catch (error) { problems.push(error.message); } }
  return [...problems, ...validatePoeConfig(config)];
}

// Checks the bot address and token without changing anything.
export async function testConnection(config) {
  try {
    const url = new URL(config.wowEnabled === false ? "/api/v1/poe/status" : "/api/v1/standings", config.uploadUrl);
    url.searchParams.set("guild", config.guildDiscordId);
    const { response, body } = await requestJson(url, { headers: credentialHeaders(config) });
    if (response.ok) return { ok: true, message: config.wowEnabled === false ? `Connected. PoE2 tracking is ${body.enabled ? "enabled" : "paused; an officer can enable /poe setup"}.` : `Connected. The bot knows ${body.standings?.length ?? 0} character(s).` };
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
    return { ok: true, message: config.wowEnabled === false ? "Discord account paired. Your PoE2 observations will belong to this account; choose your PoE2 settings and Save and start." : "Discord account paired. The companion links your own character on its next upload; the guild import still follows its usual apply setting.", companionCredential: body.companionCredential };
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

// How long the bot may hold a standings request open waiting for a change (long poll). The
// website proxy in front of the bot gives up after 20 seconds; 12 leaves room for a slow
// connection or a busy bot, so a quiet poll ends as "nothing new", not as a proxy error.
const LONG_POLL_SECONDS = 12;
// Two standings requests are never closer than this, whatever the bot answers.
const MIN_POLL_GAP_MS = 2_000;
// Safety net for the folder watch, which can miss a save on some Windows setups.
const FILE_CHECK_MS = 30_000;
// A folder watch that gave up (antivirus, backup software) is tried again this often, and one
// that ran this long before failing counts as a fresh problem, not a repeat.
const WATCH_RETRY_MS = 5 * 60_000;
const WATCH_STABLE_MS = 10 * 60_000;

export function createEngine(initialConfig, hooks = {}) {
  let config = initialConfig;
  let watcher;
  let poe;
  let uploadTimer;
  let standingsTimer;
  let fileCheckTimer;
  let controller = new AbortController();
  let uploading = false;
  let refreshing = false;
  let queued = false;
  let generation = 0;
  let failures = 0;
  // What the bot can do (features), what it already stored (ack) and which standings answer the
  // addon folder holds now (etag). All three come from the standings answer.
  let features = new Set();
  let ack = null;
  let etag = null;
  let gzipOff = false;
  let lastFile = null;
  let lastText = null;
  let watchRestarts = 0;
  let watchStartedAt = 0;
  let watchGaveUpAt = 0;
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
    uploads: 0,
    // "live" (the bot tells this companion about changes as they happen) or "interval".
    standingsMode: null,
    // "watching" (saves upload at once) or "checking" (the folder watch failed; saves are
    // noticed within 30 seconds until it works again).
    fileWatch: null,
    lastUploadBytes: null,
    poe: null
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

  // A pause that ends early when the companion stops.
  const sleep = (ms, epoch) => new Promise((resolve) => {
    if (epoch !== generation) { resolve(); return; }
    const signal = controller.signal;
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

  async function fileStamp(path) {
    try { const info = await stat(path); return `${info.mtimeMs}:${info.size}`; } catch { return null; }
  }

  async function send(current, exported, epoch) {
    const gzip = features.has("gzip-upload") && !gzipOff;
    const payload = jsonBody({ guildDiscordId: current.guildDiscordId, export: exported }, { gzip });
    if (payload.bytes > MAX_UPLOAD_BYTES) {
      const error = new Error(`This upload is ${Math.ceil(payload.bytes / 1000)} KB; the bot accepts at most ${MAX_UPLOAD_BYTES / 1000} KB. Update the bot so the companion can send only new entries, or ask an officer to check the saved data.`);
      error.retryable = false;
      throw error;
    }
    state.lastUploadBytes = payload.bytes;
    const result = await requestJson(current.uploadUrl, {
      method: "POST",
      headers: { ...credentialHeaders(current), ...payload.headers },
      body: payload.body
    }, controller.signal);
    // A compressed upload the bot (or something on the way) could not read: send it plain from now on.
    if (gzip && epoch === generation && (result.response.status === 400 || result.response.status === 415)) {
      gzipOff = true;
      log("warn", "The bot could not read a compressed upload; sending uncompressed from now on.");
      return send(current, exported, epoch);
    }
    return result;
  }

  async function upload() {
    if (!state.running || config.wowEnabled === false) return;
    if (uploading) { queued = true; return; }
    uploading = true;
    queued = false;
    const epoch = generation;
    const current = { ...config };
    state.pendingUpload = true;
    state.retryAt = null;
    try {
    lastFile = await fileStamp(current.watchFile);
    const full = current.watchFile.toLowerCase().endsWith(".lua")
      ? await readAddonExport(current.watchFile, current.realm)
      : JSON.parse(await readFile(current.watchFile, "utf8"));
    // The saved data belongs to one WoW guild; do not send an alt's other guild.
    if (current.wowGuild && full.wowGuild && full.wowGuild !== current.wowGuild) {
      state.pendingUpload = false;
      log("warn", `Skipped: the saved data belongs to "${full.wowGuild}", this companion is for "${current.wowGuild}".`);
      return;
    }
    // Leave out what the bot already stored (it said so in the last standings answer).
    const { exported, omitted } = pruneAcknowledged(full, ack, features);
    const { response, body } = await send(current, exported, epoch);
    if (epoch !== generation) return;
    state.botVersion = body.botVersion ?? state.botVersion;
    state.addonVersion = exported.addonVersion ?? state.addonVersion;
    const left = omitted.ledger + omitted.loot;
    const leftNote = left > 0 ? ` ${left} entries the bot already has were not sent again.` : "";
    if (response.ok) {
      const message = body.applyError
        ? `Uploaded, but the bot could not apply it: ${body.applyError}`
        : body.autoApplied
        ? `Uploaded and applied automatically (${body.autoApplied.epgp} ledger entries, ${body.autoApplied.discovered} new characters).${heldNote(body.autoApplied)}${pairingNote(body.pairedCharacterStatus)}`
        : body.professionRelay
          ? `Professions and recipes synced. Guild ledger imports still await officer review.${pairingNote(body.pairedCharacterStatus)}`
          : `Uploaded ${body.transactionCount} ledger entries. Apply on Discord with: /import apply id:${body.importId}.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      state.uploads += 1;
      log(body.applyError || body.autoApplied?.held ? "warn" : "ok", message + leftNote);
      // A live standings connection hears about the change by itself.
      if (state.standingsMode !== "live") void refreshStandings();
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

  // Entries the bot kept back (unlinked character, no raid core...): the rest went through.
  function heldNote(applied) {
    const parts = [];
    if (applied?.held) parts.push(`${applied.held} on hold: an officer can see why with /import held`);
    if (applied?.voided) parts.push(`${applied.voided} voided in game and taken back`);
    if (applied?.rejected) parts.push(`${applied.rejected} unreadable row(s) left out`);
    return parts.length ? ` ${parts.join("; ")}.` : "";
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

  // One standings answer: written to the addon folder (unless unchanged), and what it says about
  // the bot (features, stored entries) remembered. `waitSeconds` long-polls.
  async function fetchStandings(epoch, options = {}) {
    const result = await writeStandings({ ...config }, controller.signal, { etag: options.force ? null : etag, waitSeconds: options.waitSeconds });
    if (epoch !== generation) return result;
    state.standingsError = null;
    if (result.notModified) {
      // Nothing new, but the file may have been replaced since (an addon update): write it again.
      if (lastText && !await standingsFileHolds(result.path, lastText)) return fetchStandings(epoch, { force: true });
      hooks.onState?.(snapshot());
      return result;
    }
    etag = result.etag;
    lastText = result.text ?? null;
    features = new Set(Array.isArray(result.body?.features) ? result.body.features : []);
    ack = acknowledgements(result.body);
    state.botVersion = result.botVersion ?? state.botVersion;
    state.lastStandings = { at: new Date().toISOString(), message: result.unchanged ? `Standings already up to date (${result.count} characters).` : `Wrote standings for ${result.count} character(s).` };
    if (!result.unchanged) log("ok", `Wrote EPGP standings for ${result.count} character(s) to ${result.path}.`);
    else hooks.onState?.(snapshot());
    return result;
  }

  async function refreshStandings(options = {}) {
    if (!state.running || refreshing || config.wowEnabled === false) return;
    refreshing = true;
    const epoch = generation;
    try {
      await fetchStandings(epoch, options);
    } catch (error) {
      if (epoch !== generation) return;
      state.standingsError = describeError(error);
      log("error", `Standings update failed: ${state.standingsError}`);
    } finally { refreshing = false; hooks.onState?.(snapshot()); }
  }

  function startInterval(epoch) {
    if (epoch !== generation) return;
    state.standingsMode = "interval";
    clearInterval(standingsTimer);
    const minutes = Math.max(1, Number(config.standingsIntervalMinutes) || 2);
    standingsTimer = setInterval(() => track(refreshStandings()), minutes * 60 * 1000);
    hooks.onState?.(snapshot());
  }

  // Live standings: the bot holds each request until something changes (or 15 seconds pass), so
  // a change made on Discord or by an import reaches the addon folder within seconds.
  async function liveStandings(epoch) {
    let errors = 0;
    let sameAnswers = 0;
    while (state.running && epoch === generation) {
      const startedAt = Date.now();
      const sent = etag;
      try {
        const result = await fetchStandings(epoch, { waitSeconds: LONG_POLL_SECONDS });
        if (epoch !== generation) return;
        if (errors > 0) log("ok", "Standings connection restored.");
        errors = 0;
        // Answered at once with what we already had: something on the way ignores `since`.
        // Do not spin; ask every few minutes instead.
        sameAnswers = !result.notModified && sent && result.etag === sent ? sameAnswers + 1 : 0;
        if (sameAnswers >= 3 || (!result.notModified && !result.etag)) { startInterval(epoch); return; }
      } catch (error) {
        if (epoch !== generation) return;
        state.standingsError = describeError(error);
        if (errors === 0) log("error", `Standings update failed: ${state.standingsError}`);
        errors++;
        await sleep(Math.min(300_000, 5_000 * 2 ** Math.min(errors - 1, 6)), epoch);
        continue;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_POLL_GAP_MS) await sleep(MIN_POLL_GAP_MS - elapsed, epoch);
    }
  }

  function watchFolder() {
    const name = basename(config.watchFile).toLowerCase();
    // Watch the folder, not the file: WoW replaces the file on save.
    const current = watch(dirname(config.watchFile), (_event, filename) => {
      if (filename && filename.toString().toLowerCase() === name) scheduleUpload();
    });
    watcher = current;
    watchStartedAt = Date.now();
    state.fileWatch = "watching";
    current.on("error", (error) => {
      current.close();
      if (watcher === current) watcher = undefined;
      if (!state.running) return;
      state.fileWatch = "checking";
      // A watch that ran fine for a long time before failing is a new problem, not a repeat.
      if (Date.now() - watchStartedAt >= WATCH_STABLE_MS) watchRestarts = 0;
      // The periodic file check keeps uploads going meanwhile; try to watch again.
      if (watchRestarts++ < 5) {
        log("warn", `File watch stopped (${error.message}); starting it again.`);
        setTimeout(() => {
          if (!state.running || watcher) return;
          try { watchFolder(); } catch (again) { log("error", `File watch could not restart: ${again.message}. Saves are still checked every 30 seconds.`); }
        }, 5_000);
      } else {
        watchGaveUpAt = Date.now();
        log("error", `File watch keeps stopping (${error.message}). Saves are still checked every 30 seconds, and the watch is tried again every 5 minutes.`);
      }
      hooks.onState?.(snapshot());
    });
  }

  // Called by the 30-second check: a watch that gave up is tried again now and then, so a
  // passing problem does not leave the companion on the slower check for the whole session.
  function retryWatch() {
    if (!state.running || watcher || !watchGaveUpAt || Date.now() - watchGaveUpAt < WATCH_RETRY_MS) return;
    watchGaveUpAt = 0;
    watchRestarts = 0;
    try {
      watchFolder();
      log("ok", "File watch is working again; saves upload at once.");
    } catch (error) {
      watchGaveUpAt = Date.now();
      log("warn", `File watch still unavailable (${error.message}). Saves are still checked every 30 seconds.`);
    }
  }

  async function startWatching() {
    const epoch = generation;
    const problems = validateConfig(config);
    if (problems.length > 0) { log("warn", `Not started: ${problems[0]}`); return false; }
    if (config.poeEnabled) {
      poe = createPoeEngine(config, {
        onLog: ({ level, message }) => log(level, message),
        onState: next => { state.poe = next; state.botVersion = next.botVersion ?? state.botVersion; hooks.onState?.(snapshot()); }
      });
      if (!await poe.start()) { log("error", poe.state().error || "PoE2 tracking could not start."); return false; }
      if (epoch !== generation) return false;
    }
    if (config.wowEnabled === false) {
      state.running = true; state.watching = config.poeLogFile;
      log("info", "PoE2 tracking started. New map observations are shared with your guild; chat stays on this computer.");
      return true;
    }
    try {
      await access(dirname(config.watchFile));
    } catch {
      if (epoch !== generation) return false;
      await poe?.stop();
      log("error", `The folder ${dirname(config.watchFile)} does not exist. Check the saved-data file in Settings.`);
      return false;
    }
    if (epoch !== generation) return false;
    watchRestarts = 0;
    watchGaveUpAt = 0;
    watchFolder();
    state.running = true;
    state.watching = config.watchFile;
    log("info", `Watching ${config.watchFile}`);
    // Standings first: they say what the bot already has, which the first upload leaves out.
    await refreshStandings();
    if (epoch !== generation || !state.running) return false;
    scheduleUpload(0);
    // Safety net for the folder watch: a save it missed is noticed within 30 seconds.
    fileCheckTimer = setInterval(() => track((async () => {
      retryWatch();
      if (!state.running || uploading || lastFile === null) return;
      const now = await fileStamp(config.watchFile);
      if (now && now !== lastFile) scheduleUpload(0);
    })()), FILE_CHECK_MS);
    if (features.has("long-poll") && etag && config.liveStandings !== false) {
      state.standingsMode = "live";
      track(liveStandings(epoch));
    } else {
      startInterval(epoch);
    }
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
      await poe?.stop(); poe = undefined; state.poe = null;
      clearTimeout(uploadTimer); clearInterval(standingsTimer); clearInterval(fileCheckTimer);
      queued = false;
      await Promise.allSettled([...active]);
      state.pendingUpload = false; state.retryAt = null; state.standingsMode = null;
      state.watching = null; state.fileWatch = null; watchGaveUpAt = 0;
      if (was) log("info", "Stopped."); else hooks.onState?.(snapshot());
    },
    // Apply new settings and restart.
    async configure(next) { await this.stop(); config = next; etag = null; ack = null; features = new Set(); gzipOff = false; lastFile = null; lastText = null; return this.start(); },
    uploadNow() { if (config.wowEnabled !== false) scheduleUpload(0); if (poe) track(poe.pollNow()); },
    // The tray's "Refresh in-game standings now" always fetches and writes the full answer.
    refreshStandings: () => refreshStandings({ force: true })
  };
}
