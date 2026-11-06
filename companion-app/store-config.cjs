const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Store and desktop profiles keep separate directories. Never silently fall back to
// plaintext or overwrite an unreadable encrypted configuration with defaults.
//
// 9.0 release blocker: on a second PC no save ever reached the disk and nothing was logged. Every
// Windows protected-storage call now has a time limit; when the asynchronous call does not answer,
// the synchronous one (same DPAPI-backed key) is used instead. Each step is logged, one stuck save
// never holds up the next ones, and status() says when the last save failed or is still running.
const STEP_TIMEOUT_MS = 5000;

class StepTimeout extends Error {
  constructor(step, ms) { super(`settings save stuck at ${step} (no answer after ${Math.round(ms / 1000)} s)`); this.step = step; }
}

/**
 * @param {any} safeStorage Electron's safeStorage (or a stand-in in tests)
 * @param {{ timeoutMs?: number, log?: (line: string) => void, now?: () => number }} [options]
 */
function createStoreConfig(safeStorage, { timeoutMs = STEP_TIMEOUT_MS, log = () => {}, now = Date.now } = {}) {
  let pending = Promise.resolve();
  let inFlight = null; // { step, since }
  let lastError = null; // { message, at }
  let lastSavedAt = null;
  // A settings file that exists but could not be read is never overwritten: saving would replace
  // the member's sign-in and folders with whatever this run has (usually the defaults).
  const unreadable = new Map();

  function withTimeout(promise, step) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new StepTimeout(step, timeoutMs)), timeoutMs); timer.unref?.(); })
    ]);
  }
  // One protected-storage call: the asynchronous API with a time limit, then the synchronous one.
  async function protectedCall(step, asyncCall, syncCall) {
    const started = now();
    log(`${step}: start`);
    if (inFlight) inFlight.step = step;
    if (typeof asyncCall === "function") {
      try {
        const value = await withTimeout(asyncCall(), step);
        log(`${step}: ok (${now() - started} ms)`);
        return value;
      } catch (error) {
        if (!(error instanceof StepTimeout)) { log(`${step}: failed: ${message(error)}`); throw error; }
        log(`${error.message}; using the synchronous call`);
      }
    }
    if (typeof syncCall !== "function") {
      const error = new Error(`Windows protected storage did not answer at ${step}. Your settings were not saved; the last saved file is kept.`);
      log(`${step}: no synchronous fallback`);
      throw error;
    }
    const value = syncCall();
    log(`${step}: ok through the synchronous call (${now() - started} ms)`);
    return value;
  }
  async function available() {
    if (!safeStorage) throw new Error("Windows protected storage is unavailable. Your settings were not saved.");
    const asyncCheck = typeof safeStorage.isAsyncEncryptionAvailable === "function" ? () => safeStorage.isAsyncEncryptionAvailable() : null;
    const syncCheck = typeof safeStorage.isEncryptionAvailable === "function" ? () => safeStorage.isEncryptionAvailable() : null;
    if (!await protectedCall("available", asyncCheck, syncCheck)) throw new Error("Windows protected storage is unavailable. Your settings were not saved.");
  }
  const encrypt = (text) => protectedCall("encrypt",
    typeof safeStorage.encryptStringAsync === "function" ? () => safeStorage.encryptStringAsync(text) : null,
    typeof safeStorage.encryptString === "function" ? () => safeStorage.encryptString(text) : null);
  const decrypt = (bytes) => protectedCall("decrypt",
    typeof safeStorage.decryptStringAsync === "function" ? () => safeStorage.decryptStringAsync(bytes) : null,
    typeof safeStorage.decryptString === "function" ? () => ({ result: safeStorage.decryptString(bytes), shouldReEncrypt: false }) : null);

  function write(file, config) {
    if (unreadable.has(file)) return Promise.reject(new Error(`Your saved settings could not be read (${unreadable.get(file)}), so they were kept as they are and nothing was saved.`));
    const snapshot = JSON.stringify(config);
    const previous = pending;
    const save = (async () => {
      // Saves stay in order, but a stuck one holds the next for at most a few steps' time.
      await Promise.race([previous.catch(() => {}), new Promise((resolve) => { const t = setTimeout(resolve, timeoutMs * 4); t.unref?.(); })]);
      inFlight = { step: "start", since: now() };
      log("save: start");
      try {
        await available();
        const encrypted = await encrypt(snapshot);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("Windows did not protect the settings.");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          inFlight.step = "writeFileSync";
          fs.writeFileSync(temporary, encrypted, { flag: "wx", mode: 0o600 });
          inFlight.step = "renameSync";
          fs.renameSync(temporary, file);
        } finally { fs.rmSync(temporary, { force: true }); }
        lastSavedAt = new Date(now()).toISOString();
        lastError = null;
        log(`save: done, ${encrypted.length} bytes`);
      } catch (error) {
        lastError = { message: message(error), at: new Date(now()).toISOString() };
        log(`save: failed: ${message(error)}`);
        throw error;
      } finally { inFlight = null; }
    })();
    pending = save;
    return save;
  }
  return {
    write,
    /** Waits for the queued saves, but never longer than a stuck save may take. */
    flush: () => Promise.race([
      pending,
      new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`Settings save still running at ${inFlight?.step ?? "?"}; the last saved file is kept.`)), timeoutMs * 6); t.unref?.(); })
    ]),
    /** For the Problems panel and the log: the last failure, a save running too long, the last success. */
    status: () => ({
      lastError,
      lastSavedAt,
      stuck: inFlight && now() - inFlight.since > timeoutMs * 2 ? { step: inFlight.step, seconds: Math.round((now() - inFlight.since) / 1000) } : null
    }),
    async migrate(file, legacyFile) {
      const current = await this.read(file);
      if (current !== null) {
        // A previous migration may have saved successfully before deletion failed.
        fs.rmSync(legacyFile, { force: true });
        return current;
      }
      let text;
      try { text = fs.readFileSync(legacyFile, "utf8"); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const config = JSON.parse(text);
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Saved settings are invalid.");
      await write(file, config);
      // Verify Windows can read the new file before removing the old credential.
      const verified = await this.read(file);
      if (JSON.stringify(verified) !== JSON.stringify(config)) throw new Error("Protected settings verification failed.");
      fs.rmSync(legacyFile, { force: true });
      return verified;
    },
    async read(file) {
      let encrypted;
      log(`read ${path.basename(file)}: start`);
      try { encrypted = fs.readFileSync(file); } catch (error) {
        if (error.code === "ENOENT") { log(`read ${path.basename(file)}: no file`); return null; }
        unreadable.set(file, error.code || "read error"); log(`read ${path.basename(file)}: failed: ${error.code || message(error)}`); throw error;
      }
      let config, decrypted;
      try {
        await available();
        decrypted = await decrypt(encrypted);
        config = JSON.parse(decrypted.result);
        if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Protected settings are invalid.");
      } catch (error) {
        unreadable.set(file, message(error));
        log(`read ${path.basename(file)}: failed: ${message(error)}`);
        throw error;
      }
      unreadable.delete(file);
      log(`read ${path.basename(file)}: ok, ${encrypted.length} bytes, ${Object.keys(config).length} keys`);
      if (decrypted.shouldReEncrypt) await write(file, config);
      return config;
    },
    /** Why this file could not be read, or null. */
    unreadableReason: (file) => unreadable.get(file) ?? null
  };
}
const message = (error) => (error instanceof Error ? error.message : String(error));
module.exports = { createStoreConfig, STEP_TIMEOUT_MS };
