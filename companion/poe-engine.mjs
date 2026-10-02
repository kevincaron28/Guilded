import { open, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, basename } from "node:path";
import { credentialHeaders, requestJson } from "./request.mjs";
import { parsePoeLogLine, consumePoeEvent, isPoeMap } from "./poe-log.mjs";

const MAX_LINE_BYTES = 8192;
const MAX_POLL_BYTES = 1_048_576;
const RECOVERY_WINDOW_MS = 300_000;
const isoDate = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const localDay = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

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
  let unrecognizedSince = null;
  const state = { running: false, watching: null, pending: 0, currentArea: null, currentStartedAt: null, todayMaps: 0, lastActivity: null, warning: null, catchingUp: false, lastSync: null, error: null, retryAt: null, botVersion: null };
  const snapshot = () => ({ ...state });
  const publish = () => {
    state.pending = journal?.pending.length ?? 0;
    state.currentArea = journal?.active?.areaId ?? null;
    state.currentStartedAt = journal?.active?.startedAt ?? null;
    state.lastActivity = journal?.lastEventAt ?? null;
    state.todayMaps = journal?.daily?.date === localDay() ? journal.daily.instances.length : 0;
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
  function consume(event) {
    if (!event) return;
    if (journal.recoveryAfter && (Date.parse(event.at) <= Date.parse(journal.recoveryAfter)
      || Date.parse(event.at) < Date.now() - RECOVERY_WINDOW_MS || Date.parse(event.at) > Date.now() + RECOVERY_WINDOW_MS)) return;
    unrecognizedSince = null;
    state.warning = null;
    consumePoeEvent(journal, event, profile);
    if (!journal.lastEventAt || event.at > journal.lastEventAt) journal.lastEventAt = event.at;
    if (event.kind === "area" && journal.active?.fingerprint === event.fingerprint) {
      if (journal.daily?.date !== localDay()) journal.daily = { date: localDay(), instances: [] };
      const at = new Date(event.at);
      const today = new Date();
      if (at.toDateString() === today.toDateString() && !journal.daily.instances.includes(journal.active.instanceRef)
        && journal.daily.instances.length < 10_000) journal.daily.instances.push(journal.active.instanceRef);
    }
  }
  async function readNewLines() {
    const handle = await open(config.poeLogFile, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("The PoE2 log must be a regular file.");
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const sample = Buffer.alloc(Math.min(256, stat.size));
      await handle.read(sample, 0, sample.length, 0);
      if ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff) || sample.includes(0)) {
        throw new Error("PoE2 log encoding is unsupported (UTF-16 or binary). Select the game's original UTF-8 Client.txt; tracking will retry.");
      }
      const head = Buffer.alloc(journal?.prefixBytes ?? Math.min(256, stat.size));
      const read = await handle.read(head, 0, head.length, 0);
      const prefix = createHash("sha256").update(head.subarray(0, read.bytesRead)).digest("hex");
      if (!journal) {
        journal = { version: 1, identity, prefix, prefixBytes: head.length, offset: stat.size, skipping: true, active: null, pending: [], captureStartedAt: new Date().toISOString() };
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
        const cutoff = [journal.captureStartedAt, journal.lastEventAt].filter(Boolean).sort().at(-1);
        const recover = cutoff && stat.size <= MAX_POLL_BYTES && Math.abs(Date.now() - stat.mtimeMs) <= RECOVERY_WINDOW_MS;
        journal.offset = recover ? 0 : stat.size; journal.skipping = false;
        if (recover) journal.recoveryAfter = cutoff;
        else {
          delete journal.recoveryAfter;
          if (stat.size) { const last = Buffer.alloc(1); await handle.read(last, 0, 1, stat.size - 1); journal.skipping = last[0] !== 10; }
        }
        log("warn", recover ? "PoE2 log changed. Recovering recent events newer than the saved checkpoint; interrupted timing is unknown."
          : "PoE2 log changed. Replacement history was skipped because safe recovery could not be established; interrupted timing is unknown.");
        await save();
        if (!recover) return;
      }
      let budget = MAX_POLL_BYTES;
      while (state.running && journal.offset < stat.size && budget > 0) {
        if (journal.pending.length >= 10_000) throw new Error("PoE2 queue is full. Restore uploads before recording more visits.");
        const buffer = Buffer.alloc(Math.min(262_144, stat.size - journal.offset, budget));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, journal.offset);
        if (!bytesRead) break;
        budget -= bytesRead;
        unrecognizedSince ??= Date.now();
        let begin = 0;
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] !== 10) continue;
          if (journal.pending.length >= 10_000) break;
          if (!journal.skipping && index - begin <= MAX_LINE_BYTES) {
            const line = buffer.subarray(begin, index).toString("utf8").replace(/\r$/, "");
            if (!line.includes("\u0000") && !line.includes("\ufffd")) consume(parsePoeLogLine(line));
          }
          journal.skipping = false;
          begin = index + 1;
        }
        // Do not save partial raw text (it may be chat). Re-read it next poll.
        journal.offset += begin;
        if (journal.pending.length < 10_000 && bytesRead - begin > MAX_LINE_BYTES) { journal.offset += bytesRead - begin; journal.skipping = true; }
        // Strengthen the prefix when tracking began with an empty/short file.
        const prefixBytes = Math.min(256, journal.offset, sample.length);
        if (prefixBytes > journal.prefixBytes) {
          journal.prefixBytes = prefixBytes;
          journal.prefix = createHash("sha256").update(sample.subarray(0, prefixBytes)).digest("hex");
        }
        if (journal.offset === stat.size) delete journal.recoveryAfter;
        if (begin || bytesRead > MAX_LINE_BYTES) await save();
        if (!begin && bytesRead <= MAX_LINE_BYTES) break;
      }
      state.catchingUp = stat.size - journal.offset > MAX_LINE_BYTES;
      if (unrecognizedSince !== null && Date.now() - unrecognizedSince >= RECOVERY_WINDOW_MS) {
        state.warning = "No supported PoE2 area or disconnect event recognized in recent log activity. If you have changed areas, check the selected Client.txt and client language/format.";
      }
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
      if (["EACCES", "EPERM", "EBUSY"].includes(error.code)) return "PoE2 Client.txt is locked or access was denied. Tracking will retry; queued observations are kept.";
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
          || ["captureStartedAt", "lastEventAt", "recoveryAfter"].some(key => key in saved && !isoDate(saved[key]))
          || ("daily" in saved && (!saved.daily || !/^\d{4}-\d{2}-\d{2}$/.test(saved.daily.date)
            || !Array.isArray(saved.daily.instances) || saved.daily.instances.length > 10_000
            || !saved.daily.instances.every(ref => typeof ref === "string" && /^[a-f0-9]{64}$/.test(ref))
            || !Object.keys(saved.daily).every(key => ["date", "instances"].includes(key))))
          || !Object.keys(saved).every(key => ["version", "identity", "prefix", "prefixBytes", "offset", "skipping", "active", "pending", "captureStartedAt", "lastEventAt", "recoveryAfter", "daily"].includes(key))) throw new Error("Invalid journal");
        journal = saved;
        journal.captureStartedAt ??= new Date().toISOString();
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
