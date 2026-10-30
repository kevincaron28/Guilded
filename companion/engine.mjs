import { access, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readSavedText } from "./saved-file.mjs";
import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { readAddonExport } from "./lua-export.mjs";
import { standingsFileHolds, writeStandings } from "./standings.mjs";
import { credentialHeaders, checkUrl, requestJson, jsonBody, MAX_UPLOAD_BYTES } from "./request.mjs";
import { acknowledgements, pruneAcknowledged } from "./delta.mjs";
import { createPoeEngine, validatePoeConfig } from "./poe-engine.mjs";
import { personalSavedFiles, uploadPersonalRuns } from "./personal-runs.mjs";
import { GAME_EDITIONS } from "./game-edition.mjs";

// The companion's working parts, shared by the command-line watcher
// (watcher.mjs) and the desktop app (companion-app/). It watches the addon's
// saved file, uploads changes to the bot, and keeps the addon's Standings.lua
// fresh. Nothing here prints; everything is reported through `hooks`:
//   onLog({ time, level, message })   level: info | ok | warn | error
//   onState(state)                    a snapshot after every change
export function validateConfig(config) {
  const problems = [];
  if (config.wowEnabled !== false && !config.watchFile) problems.push(config.personal ? "The saved-data file (GuildedDungeons.lua or Guilded.lua) is not set." : "The saved-data file (Guilded.lua) is not set.");
  if (config.wowEnabled === false && !config.poeEnabled) problems.push("Enable WoW or PoE2 tracking before starting.");
  if (!config.uploadUrl) problems.push("The bot address is not set.");
  const linked = typeof config.companionCredential === "string" && config.companionCredential.length >= 32;
  if (!linked) problems.push("Connect your account first: choose Sign in with Discord (or enter a pairing code) in Connection & setup.");
  // Personal mode (leaderboards only, from Sign in with Discord or a /me/ code) has no guild: only public dungeon runs.
  else if (!config.guildDiscordId && !config.personal) problems.push("The Discord server ID is not set.");
  if (config.uploadUrl) { try { checkUrl(config.uploadUrl); } catch (error) { problems.push(error.message); } }
  return [...problems, ...validatePoeConfig(config)];
}

// Checks the bot address and token without changing anything.
export async function testConnection(config) {
  try {
    const url = new URL(config.personal ? "/api/v1/companion/personal-status" : config.wowEnabled === false ? "/api/v1/poe/status" : "/api/v1/standings", config.uploadUrl);
    url.searchParams.set("guild", config.guildDiscordId);
    const { response, body } = await requestJson(url, { headers: credentialHeaders(config) });
    if (response.ok && config.personal) return body.ok === true && body.scope === "personal"
      ? { ok: true, message: "Leaderboards account connected. Your personal companion link is valid." }
      : { ok: false, message: "The server did not confirm this personal companion link." };
    if (response.ok) return { ok: true, message: config.wowEnabled === false ? `Connected. PoE2 tracking is ${body.enabled ? "enabled" : "paused; an officer can enable /poe setup"}.` : `Connected. The bot knows ${body.standings?.length ?? 0} character(s).` };
    if (response.status === 401 || response.status === 403) return { ok: false, message: "The bot refused this companion link. Choose Sign in with Discord again (or use a fresh /character pair code)." };
    return { ok: false, message: `The bot answered ${response.status}: ${describeApiError(response.status, body.error)}` };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export async function pairAccount(config) {
  if (!config.uploadUrl || typeof config.pairingCode !== "string" || !config.pairingCode.trim()) {
    return { ok: false, message: "Enter the bot address and the code from /character pair first." };
  }
  try {
    const url = new URL("/api/v1/addon-pairings", config.uploadUrl);
    const { response, body } = await requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The server ID is optional: the bot finds the server from the code (6.5.1).
      body: JSON.stringify({ ...(config.guildDiscordId?.trim() ? { guildDiscordId: config.guildDiscordId.trim() } : {}), code: config.pairingCode.trim() }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return { ok: false, message: `Pairing failed (${response.status}): ${describeApiError(response.status, body.error)}` };
    return pairingResult(config, body);
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

// The bot's answer to a pairing code or a Discord sign-in: the same fields either way.
function pairingResult(config, body) {
  if (typeof body.companionCredential !== "string" || body.companionCredential.length < 32) {
    return { ok: false, message: "The bot response did not include a valid companion credential." };
  }
  if (body.personal === true) {
    return { ok: true, personal: true, companionCredential: body.companionCredential, guildDiscordId: "", message: "Leaderboards account connected. Your finished dungeon runs go to the public leaderboards (guilded.kcaron.top/leaderboards/). In step 2, choose GuildedDungeons.lua or Guilded.lua (with both addons, both are read), then Save and start." };
  }
  return { ok: true, personal: false, message: config.wowEnabled === false ? "Discord account paired. Your PoE2 observations will belong to this account; choose your PoE2 settings and Save and start." : "Discord account paired. The companion links your own character on its next upload; the guild import still follows its usual apply setting.", companionCredential: body.companionCredential, guildDiscordId: typeof body.guildDiscordId === "string" ? body.guildDiscordId : config.guildDiscordId,
    ...(typeof body.wowGuildId === "string" && body.wowGuildId ? { wowGuildId: body.wowGuildId } : {}),
    ...(typeof body.wowGuildName === "string" && body.wowGuildName ? { wowGuildName: body.wowGuildName } : {}),
    ...(GAME_EDITIONS.includes(body.gameEdition) ? { gameEdition: body.gameEdition } : {}) };
}

// The hosted bot, used when no address was entered: Discord sign-in needs no other setting.
export const HOSTED_UPLOAD_URL = "https://guilded.kcaron.top/api/v1/addon-imports";

// "Sign in with Discord" (7.2): ask for a sign-in request, then open `url` in a browser.
// loopback: the Windows app's 127.0.0.1 port. The page then sends the browser back there with a
// proof instead of asking for the code (src/services/companion-signin.ts); pass it to waitForSignIn.
export async function startSignIn(config, { loopback } = {}) {
  const uploadUrl = config.uploadUrl?.trim() || HOSTED_UPLOAD_URL;
  try {
    const { response, body } = await requestJson(new URL("/api/v1/companion/sign-in", uploadUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(loopback ? { loopback } : {}) }, undefined, 10_000);
    if (response.status === 404) return { ok: false, message: "This bot does not offer Discord sign-in yet. Use a pairing code instead." };
    if (!response.ok) return { ok: false, message: describeApiError(response.status, body.error) };
    if (typeof body.requestId !== "string" || typeof body.url !== "string" || typeof body.confirm !== "string") return { ok: false, message: "The bot's sign-in answer was incomplete." };
    const page = checkUrl(body.url);
    return { ok: true, uploadUrl, requestId: body.requestId, confirm: body.confirm, url: page.href, automatic: !!loopback && body.loopbackAccepted === true };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

// Asks every few seconds until the member approves in the browser (or 10 minutes pass).
// proof: returns what came back through the loopback port (startSignIn's loopback), once it has.
export async function waitForSignIn(config, requestId, { signal, proof = /** @type {(() => string | undefined) | undefined} */ (undefined), intervalMs = 2_000, timeoutMs = 10 * 60_000, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  const uploadUrl = config.uploadUrl?.trim() || HOSTED_UPLOAD_URL;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (signal?.aborted) return { ok: false, message: "Sign-in cancelled." };
    try {
      const { response, body } = await requestJson(new URL("/api/v1/companion/sign-in/poll", uploadUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, ...(proof?.() ? { proof: proof() } : {}) }) }, signal, 10_000);
      if (response.status === 200) return { ...pairingResult(config, body), uploadUrl };
      if (response.status !== 202) return { ok: false, message: describeApiError(response.status, body.error) };
    } catch (error) {
      if (signal?.aborted) return { ok: false, message: "Sign-in cancelled." };
      // A dropped connection is retried until the time runs out.
      if (Date.now() + intervalMs >= until) return { ok: false, message: describeError(error) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, message: "Sign-in timed out. Choose Sign in with Discord again." };
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
    syncPhase: "waiting-save",
    syncEvidence: {},
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
  // Personal mode reads both addons' saved files from the folder (personal-runs.mjs).
  const watchedFiles = (current = config) => (current.personal ? personalSavedFiles(current.watchFile) : [current.watchFile]);
  async function savedStamp(current = config) {
    const [first, ...rest] = await Promise.all(watchedFiles(current).map(fileStamp));
    return first === null ? null : [first, ...rest].join("|");
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

  // Personal mode: finished dungeon runs to the public leaderboards (personal-runs.mjs).
  async function personalUpload() {
    if (uploading) { queued = true; return; }
    uploading = true;
    queued = false;
    const epoch = generation;
    const current = { ...config };
    state.pendingUpload = true;
    state.syncPhase = "uploading";
    state.retryAt = null;
    try {
      lastFile = await savedStamp(current);
      const result = await uploadPersonalRuns(current, controller.signal, evidence => { if (epoch === generation) state.syncEvidence = evidence; });
      if (epoch !== generation) return;
      if (result.scoreSaved) {
        state.lastStandings = { at: new Date().toISOString(), message: "Public scores saved to Guilded Dungeons. Use /reload, then /gdungeons score." };
        log("ok", state.lastStandings.message);
      }
      state.lastUpload = { at: new Date().toISOString(), message: result.message };
      state.syncPhase = result.level === "warn" || !state.syncEvidence.acceptedAt ? "needs-attention" : "synced";
      if (result.sent) state.uploads += 1;
      state.uploadError = null;
      failures = 0;
      state.pendingUpload = false;
      log(result.level, result.message);
    } catch (error) {
      if (epoch !== generation) return;
      state.uploadError = describeError(error);
      state.syncPhase = error.retryable === false ? "needs-attention" : "retry";
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

  async function upload() {
    if (!state.running || config.wowEnabled === false) return;
    if (config.personal) return personalUpload();
    if (uploading) { queued = true; return; }
    uploading = true;
    queued = false;
    const epoch = generation;
    const current = { ...config };
    state.pendingUpload = true;
    state.syncPhase = "uploading";
    state.retryAt = null;
    try {
    lastFile = await fileStamp(current.watchFile);
    const full = current.watchFile.toLowerCase().endsWith(".lua")
      ? await readAddonExport(current.watchFile, current.realm)
      : JSON.parse(await readSavedText(current.watchFile));
    const stamp = await stat(current.watchFile);
    if (`${stamp.mtimeMs}:${stamp.size}` !== lastFile) throw new Error("Saved data changed during reading. Retrying the latest save.");
    const revision = createHash("sha256").update(JSON.stringify(full)).digest("hex");
    state.syncEvidence = { savedAt: stamp.mtime.toISOString(), savedRevision: revision,
      character: full.character?.name ? `${full.character.name} — ${full.character.realm || current.realm || "?"}` : null,
      edition: full.gameEdition || full.character?.gameEdition };
    // The saved data belongs to one WoW guild; do not send an alt's other guild.
    if (current.wowGuild && (full.wowGuild || current.requireWowGuild) && full.wowGuild !== current.wowGuild) {
      state.pendingUpload = false;
      state.syncPhase = "waiting-save";
      log("warn", `Skipped: the saved data belongs to "${full.wowGuild}", this companion is for "${current.wowGuild}".`);
      return;
    }
    // Leave out what the bot already stored (it said so in the last standings answer).
    const { exported, omitted } = pruneAcknowledged(full, ack, features);
    const uploadedAt = new Date().toISOString();
    const { response, body } = await send(current, exported, epoch);
    if (epoch !== generation) return;
    if (response.ok || response.status === 409 && body.importId) {
      Object.assign(state.syncEvidence, { uploadedAt, uploadedRevision: revision });
      if (body.importId) Object.assign(state.syncEvidence, { acceptedAt: new Date().toISOString(), acceptedRevision: revision });
    }
    state.botVersion = body.botVersion ?? state.botVersion;
    state.addonVersion = exported.addonVersion ?? state.addonVersion;
    const left = omitted.ledger + omitted.loot + (omitted.raids ?? 0);
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
      state.syncPhase = body.applyError ? "apply-error" : body.autoApplied?.held || !body.autoApplied && !body.professionRelay ? "officer-review" : "synced";
      state.uploads += 1;
      log(body.applyError || body.autoApplied?.held ? "warn" : "ok", message + leftNote);
      // A live standings connection hears about the change by itself.
      if (state.standingsMode !== "live") track(refreshStandings());
    } else if (response.status === 409 && body.importId) {
      const message = body.status === "PREVIEWED"
        ? `Upload is waiting for officer review: /import apply id:${body.importId}.`
        : `Nothing new since the last upload.${pairingNote(body.pairedCharacterStatus)}`;
      state.lastUpload = { at: new Date().toISOString(), message };
      state.syncPhase = body.status === "PREVIEWED" ? "officer-review" : "synced";
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
      state.syncPhase = error.retryable === false ? "needs-attention" : "retry";
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
    state.lastStandings = { at: new Date().toISOString(), message: result.downloadedOnly ? "Standings downloaded. Select this connection to write them to the shared addon folder." : result.unchanged || result.refreshOnly ? `Standings already up to date (${result.count} characters).` : `Wrote standings for ${result.count} character(s). Use /reload in WoW to load them.` };
    if (!result.unchanged && !result.refreshOnly) log("ok", `Updated addon data for ${result.count} character(s) in ${result.path}.`);
    else hooks.onState?.(snapshot());
    return result;
  }

  async function refreshStandings(options = {}) {
    if (!state.running || refreshing || config.wowEnabled === false || config.personal) return;
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
    const names = watchedFiles().map((path) => basename(path).toLowerCase());
    // Watch the folder, not the file: WoW replaces the file on save.
    const current = watch(dirname(config.watchFile), (_event, filename) => {
      if (filename && names.includes(filename.toString().toLowerCase())) scheduleUpload();
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
    try { watchFolder(); }
    catch (error) { state.fileWatch = "checking"; watchGaveUpAt = Date.now(); log("warn", `Folder watch unavailable (${error.message}). Saves are checked every 30 seconds.`); }
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
      if (!state.running || uploading) return;
      const now = await savedStamp();
      if (now && now !== lastFile) scheduleUpload(0);
    })()), FILE_CHECK_MS);
    if (config.personal) {
      // No guild standings in personal mode.
    } else if (features.has("long-poll") && etag && config.liveStandings !== false) {
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
    async configure(next) { await this.stop(); state.syncEvidence = {}; state.syncPhase = "waiting-save"; state.lastUpload = null; state.lastStandings = null; state.lastUploadBytes = null; state.error = null; state.standingsError = null; config = next; etag = null; ack = null; features = new Set(); gzipOff = false; lastFile = null; lastText = null; return this.start(); },
    uploadNow() { if (config.wowEnabled !== false) scheduleUpload(0); if (poe) track(poe.pollNow()); },
    // The tray's "Refresh in-game standings now" always fetches and writes the full answer.
    refreshStandings: () => { const pending = config.personal ? personalUpload() : refreshStandings({ force: true }); track(pending); return pending; }
  };
}
