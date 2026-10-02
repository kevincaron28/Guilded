import { open, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, basename } from "node:path";
import { credentialHeaders, requestJson } from "./request.mjs";
import { parsePoeLogLine, consumePoeEvent, isPoeMap } from "./poe-log.mjs";

export function validatePoeConfig(config) {
  if (!config.poeEnabled) return [];
  const errors = [];
  if (!config.poeLogFile || basename(config.poeLogFile).toLowerCase() !== "client.txt") errors.push("Choose logs/Client.txt from your Path of Exile 2 installation.");
  for (const [key, name] of [["poeCharacter", "character"], ["poeLeague", "league"]]) {
    if (typeof config[key] !== "string" || !config[key].trim() || config[key].trim().length > 100 || /\p{Cc}/u.test(config[key])) errors.push(`Enter your PoE2 ${name} (1–100 characters).`);
  }
  if (!["STANDARD", "HARDCORE", "SSF", "SSF_HARDCORE"].includes(config.poeMode)) errors.push("Choose the PoE2 league mode.");
  return errors;
}

// Separate durable queue per credential, guild, log and declared character/league.
// Changing accounts cannot send another account's queued observations.
export function poeJournalPath(config) {
  const scope = createHash("sha256").update(JSON.stringify([config.guildDiscordId, config.companionCredential, resolve(config.poeLogFile), config.poeCharacter.trim(), config.poeLeague.trim(), config.poeMode])).digest("hex");
  const base = config.poeJournalFile || resolve("companion/poe-journal.json");
  return `${base.replace(/\.json$/i, "")}-${scope}.json`;
}

export function createPoeEngine(config, hooks = {}) {
  let journal;
  let timer;
  let activePoll;
  let controller;
  let failures = 0;
  let retryAt = 0;
  let blocked = false;
  let file;
  let captureError = null;
  let uploadError = null;
  const state = { running: false, watching: null, pending: 0, currentArea: null, lastSync: null, error: null, retryAt: null, botVersion: null };
  const snapshot = () => ({ ...state });
  const publish = () => {
    state.pending = journal?.pending.length ?? 0;
    state.currentArea = journal?.active?.areaId ?? null;
    hooks.onState?.(snapshot());
  };
  const log = (level, message) => hooks.onLog?.({ time: new Date().toISOString(), level, message });
  const profile = { character: config.poeCharacter?.trim(), league: config.poeLeague?.trim(), mode: config.poeMode };
  function validVisit(row, current = false) {
    if (!row || typeof row !== "object") return false;
    const keys = ["character", "league", "mode", "runRef", "areaId", "areaLevel", "startedAt", ...(current ? ["pid", "fingerprint"] : ["endedAt", "endReason"])];
    // instanceRef is optional: journals written before it existed stay valid.
    return Object.keys(row).every(key => keys.includes(key) || key === "instanceRef") && keys.every(key => key in row)
      && (!("instanceRef" in row) || /^[a-f0-9]{64}$/.test(row.instanceRef))
      && row.character === profile.character && row.league === profile.league && row.mode === profile.mode
      && /^[a-f0-9]{64}$/.test(row.runRef) && isPoeMap(row.areaId)
      && Number.isInteger(row.areaLevel) && row.areaLevel >= 1 && row.areaLevel <= 100
      && typeof row.startedAt === "string" && Number.isFinite(Date.parse(row.startedAt))
      && (current ? typeof row.pid === "string" && /^[a-f0-9]{64}$/.test(row.fingerprint)
        : ["AREA_CHANGED", "INTERRUPTED"].includes(row.endReason) && typeof row.endedAt === "string" && Date.parse(row.endedAt) >= Date.parse(row.startedAt));
  }
  async function save() {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(journal), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  function interrupt() {
    if (!journal.active) return;
    consumePoeEvent(journal, { kind: "interrupted", at: journal.active.startedAt, pid: journal.active.pid }, profile);
  }
  async function readNewLines() {
    const handle = await open(config.poeLogFile, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("The PoE2 log must be a regular file.");
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const head = Buffer.alloc(journal?.prefixBytes ?? Math.min(256, stat.size));
      const read = await handle.read(head, 0, head.length, 0);
      const prefix = createHash("sha256").update(head.subarray(0, read.bytesRead)).digest("hex");
      if (!journal) {
        journal = { version: 1, identity, prefix, prefixBytes: head.length, offset: stat.size, skipping: true, active: null, pending: [] };
        // Opt-in starts at EOF. Existing chat/history is never imported.
        if (stat.size === 0) journal.skipping = false;
        else { const last = Buffer.alloc(1); await handle.read(last, 0, 1, stat.size - 1); journal.skipping = last[0] !== 10; }
        await save();
        return;
      }
      if (journal.identity !== identity || stat.size < journal.offset || prefix !== journal.prefix) {
        interrupt();
        const newHead = Buffer.alloc(Math.min(256, stat.size));
        await handle.read(newHead, 0, newHead.length, 0);
        journal.identity = identity; journal.prefix = createHash("sha256").update(newHead).digest("hex"); journal.prefixBytes = newHead.length;
        journal.offset = stat.size; journal.skipping = true;
        if (stat.size === 0) journal.skipping = false;
        else { const last = Buffer.alloc(1); await handle.read(last, 0, 1, stat.size - 1); journal.skipping = last[0] !== 10; }
        log("warn", "PoE2 log was replaced or shortened. Resuming from new activity; interrupted timing is unknown.");
        await save();
        return;
      }
      if (journal.pending.length >= 10_000) throw new Error("PoE2 queue is full. Restore uploads before recording more visits.");
      const buffer = Buffer.alloc(Math.min(262_144, stat.size - journal.offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, journal.offset);
      let begin = 0;
      for (let index = 0; index < bytesRead; index++) {
        if (buffer[index] !== 10) continue;
        if (!journal.skipping) consumePoeEvent(journal, parsePoeLogLine(buffer.subarray(begin, index).toString("utf8").replace(/\r$/, "")), profile);
        journal.skipping = false;
        begin = index + 1;
      }
      // Do not save partial raw text (it may be chat). Re-read it next poll.
      journal.offset += begin;
      if (bytesRead - begin > 8192) { journal.offset += bytesRead - begin; journal.skipping = true; }
      if (begin || bytesRead > 8192) await save();
    } finally { await handle.close(); }
  }
  async function sync() {
    if (blocked || Date.now() < retryAt || !journal?.pending.length || !state.running) return;
    const batch = journal.pending.slice(0, 100);
    const { response, body } = await requestJson(new URL("/api/v1/poe/visits", config.uploadUrl), {
      method: "POST", headers: { ...credentialHeaders(config), "content-type": "application/json" },
      body: JSON.stringify({ guildDiscordId: config.guildDiscordId, visits: batch })
    }, controller.signal);
    if (!state.running) return;
    if (!response.ok) {
      const error = new Error(`PoE2 upload refused (${response.status}). ${response.status === 401 ? "Pair this companion again." : response.status === 403 ? "Ask an officer to enable /poe setup, then Save and start." : "Check bot availability or the computer clock."}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    if (!Array.isArray(body.acceptedRunRefs) || !batch.every(row => body.acceptedRunRefs.includes(row.runRef))) throw new Error("PoE2 upload did not acknowledge all visits. The queue has been kept.");
    journal.pending.splice(0, batch.length);
    try { await save(); } catch (error) { journal.pending.unshift(...batch); throw error; }
    failures = 0; retryAt = 0; state.retryAt = null;
    state.lastSync = new Date().toISOString(); uploadError = null;
    state.botVersion = body.botVersion ?? state.botVersion;
    log("ok", `PoE2 synced ${batch.length} map visit(s). /poe runs`);
  }
  async function poll() {
    if (!state.running) return;
    function messageFor(error) {
      if (error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error.name)) return "PoE2 could not reach the bot. Check your connection; observations stay queued.";
      return error.code === "ENOENT" ? "PoE2 Client.txt is missing. Check the selected file; tracking will retry." : error.message;
    }
    function reportUpload(error) {
      if (!state.running) return;
      const message = messageFor(error);
      if (uploadError !== message) log("error", message);
      uploadError = message;
      if (error.retryable === false) blocked = true;
      else { retryAt = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures++, 6)); state.retryAt = new Date(retryAt).toISOString(); }
    }
    // Keep capturing while the bot is offline, and flush pending visits even if
    // the game log is missing or the queue reached its capture limit.
    try { await readNewLines(); captureError = null; } catch (error) {
      const message = messageFor(error);
      if (state.running && captureError !== message) log("error", message);
      captureError = message;
    }
    try { await sync(); } catch (error) { reportUpload(error); }
    state.error = captureError || uploadError;
    publish();
  }
  return {
    state: snapshot,
    async start() {
      const errors = validatePoeConfig(config);
      if (!config.poeEnabled || errors.length) return false;
      file = poeJournalPath(config);
      try {
        const saved = JSON.parse(await readFile(file, "utf8"));
        if (!saved || saved.version !== 1 || !Array.isArray(saved.pending) || !saved.pending.every(row => validVisit(row))
          || !(saved.active === null || validVisit(saved.active, true))
          || !Number.isSafeInteger(saved.offset) || saved.offset < 0 || !Number.isInteger(saved.prefixBytes) || saved.prefixBytes < 0 || saved.prefixBytes > 256
          || typeof saved.identity !== "string" || typeof saved.skipping !== "boolean" || !/^[a-f0-9]{64}$/.test(saved.prefix)
          || !Object.keys(saved).every(key => ["version", "identity", "prefix", "prefixBytes", "offset", "skipping", "active", "pending"].includes(key))) throw new Error("Invalid journal");
        journal = saved;
        interrupt(); await save();
      } catch (error) {
        if (error.code !== "ENOENT") { state.error = "PoE2 journal could not be read. Keep it for recovery; tracking has stopped."; publish(); return false; }
      }
      controller = new AbortController(); state.running = true; state.watching = config.poeLogFile;
      blocked = false; retryAt = 0; failures = 0;
      await this.pollNow();
      timer = setInterval(() => { void this.pollNow(); }, 1000);
      return true;
    },
    async pollNow() {
      if (activePoll) return activePoll;
      activePoll = poll();
      try { await activePoll; } finally { activePoll = undefined; }
    },
    async stop() {
      state.running = false; clearInterval(timer); controller?.abort();
      await activePoll;
      if (journal) { interrupt(); await save(); }
      state.watching = null; publish();
    }
  };
}
