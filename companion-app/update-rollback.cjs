"use strict";
// Self-update rollback (9.4 T2). A direct-download companion that updates itself and then fails to run
// puts the previous version back by itself.
//
// Life cycle of the "trial" marker (update-trial.json in the data folder):
// - beginTrial: written before an installer starts: { from, to, launches: 0, keep, toFile, toSha256 }.
//   `keep` is the installer of `from` kept from its own healthy trial (or null: no rollback is possible).
// - noteLaunch: every start of version `to` counts a launch (entry.cjs calls it before main.cjs loads).
// - cleanQuit: a start that ends by a normal quit is not a failed launch (the member just closed the tray app).
// - markHealthy: still running HEALTHY_MS after a start: the marker goes, and the installer that put this version
//   on becomes the kept one (one file only), ready for the next update's rollback.
// - guard: at the start, when `to` has already had MAX_FAILED_LAUNCHES launches and no healthy run, the kept
//   installer (checked against its SHA-256) is started and the failed version is banned until a newer one appears.
// Settings, the Discord link and the WoW data folders are never touched: only the program files are reinstalled.
// Microsoft Store installs are skipped (the Store updates them), and so is every unpackaged run.
const fs = require("node:fs");
const path = require("node:path");

const TRIAL_FILE = "update-trial.json";
const BAN_FILE = "update-banned.json";
const RESULT_FILE = "update-rolledback.json";
const KEPT_FILE = "kept.json";
const MAX_FAILED_LAUNCHES = 3;
const HEALTHY_MS = 10 * 60 * 1000;
const TRIAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALLER_ARGS = ["/S", "--updated", "--force-run"];

const trialPath = (dir) => path.join(dir, TRIAL_FILE);
const keepDir = (dir) => path.join(dir, "updates", "keep");
const SHA = /^[0-9a-f]{64}$/;

function version(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return match ? match.slice(1).map(Number) : null;
}
function newer(a, b) {
  const x = version(a), y = version(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function readJson(file, fsImpl = fs) {
  try { const value = JSON.parse(fsImpl.readFileSync(file, "utf8")); return value && typeof value === "object" ? value : null; } catch { return null; }
}
function writeJson(file, value, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, JSON.stringify(value));
}
function remove(file, fsImpl = fs) { try { fsImpl.rmSync(file, { force: true }); } catch { /* best effort */ } }

/** The kept installer of a version that ran healthily: { version, file, sha256 } or null. */
function readKept(dir, fsImpl = fs) {
  const record = readJson(path.join(keepDir(dir), KEPT_FILE), fsImpl);
  if (!record || !version(record.version) || !SHA.test(String(record.sha256 ?? "")) || typeof record.name !== "string" || record.name !== path.basename(record.name)) return null;
  const file = path.join(keepDir(dir), record.name);
  return fsImpl.existsSync(file) ? { version: record.version, file, sha256: record.sha256 } : null;
}

/** Called before an installer for `to` starts. A second call for the same update keeps the first launch count. */
function beginTrial({ dir, from, to, toFile = null, toSha256 = null, now = Date.now(), fsImpl = fs }) {
  const keep = readKept(dir, fsImpl);
  const trial = {
    from, to, launches: 0, at: new Date(now).toISOString(),
    keep: keep && keep.version === from ? { version: keep.version, name: path.basename(keep.file), sha256: keep.sha256 } : null,
    toFile: toFile && SHA.test(String(toSha256 ?? "")) ? toFile : null,
    toSha256: toFile && SHA.test(String(toSha256 ?? "")) ? toSha256 : null
  };
  writeJson(trialPath(dir), trial, fsImpl);
  return trial;
}
/** The installer did not start or ended with an error: no trial. */
function abortTrial(dir, fsImpl = fs) { remove(trialPath(dir), fsImpl); }
function readTrial(dir, fsImpl = fs) {
  const trial = readJson(trialPath(dir), fsImpl);
  return trial && typeof trial.from === "string" && typeof trial.to === "string" ? trial : null;
}

/**
 * A start of version `current`. Returns the trial that now applies to this run, or null.
 * The marker of an update that never installed (still on `from`), of another version or an old one is dropped.
 */
function noteLaunch({ dir, current, now = Date.now(), fsImpl = fs }) {
  const trial = readTrial(dir, fsImpl);
  if (!trial) return null;
  const age = now - Date.parse(trial.at ?? "");
  if (trial.to !== current) {
    // Still the old version after an installer that did not run: the updater's own failure record handles that.
    // Anything else (a third version) cannot be judged here.
    if (current === trial.from) { if (!(age >= 0 && age < 15 * 60 * 1000)) remove(trialPath(dir), fsImpl); return null; }
    remove(trialPath(dir), fsImpl);
    return null;
  }
  if (!(age < TRIAL_MAX_AGE_MS)) { remove(trialPath(dir), fsImpl); return null; }
  const next = { ...trial, launches: (Number(trial.launches) || 0) + 1 };
  writeJson(trialPath(dir), next, fsImpl);
  return next;
}

/** After noteLaunch: roll back once the update has had MAX_FAILED_LAUNCHES launches that never ran healthily. */
function decide(trial, { max = MAX_FAILED_LAUNCHES } = {}) {
  if (!trial) return { action: "none" };
  if ((Number(trial.launches) || 0) > max) return trial.keep ? { action: "rollback" } : { action: "drop", reason: "no-previous-installer" };
  return { action: "watch" };
}

/** A normal quit during the trial does not count as a failed launch. */
function cleanQuit({ dir, current, fsImpl = fs }) {
  const trial = readTrial(dir, fsImpl);
  if (!trial || trial.to !== current || !(trial.launches > 0)) return false;
  writeJson(trialPath(dir), { ...trial, launches: trial.launches - 1 }, fsImpl);
  return true;
}

/** The new version ran HEALTHY_MS: the marker goes and its installer becomes the kept one. Returns { promoted }. */
function markHealthy({ dir, current, fsImpl = fs }) {
  const trial = readTrial(dir, fsImpl);
  if (!trial || trial.to !== current) return { promoted: false };
  remove(trialPath(dir), fsImpl);
  let promoted = false;
  try {
    if (trial.toFile && trial.toSha256 && fsImpl.existsSync(trial.toFile)) {
      const folder = keepDir(dir);
      fsImpl.mkdirSync(folder, { recursive: true });
      const name = `Guilded.Companion.Setup.${current}.exe`;
      const target = path.join(folder, name);
      remove(path.join(folder, KEPT_FILE), fsImpl);
      for (const entry of fsImpl.readdirSync(folder)) if (entry !== name) remove(path.join(folder, entry), fsImpl);
      fsImpl.renameSync(trial.toFile, target);
      writeJson(path.join(folder, KEPT_FILE), { version: current, name, sha256: trial.toSha256 }, fsImpl);
      promoted = true;
    }
  } catch { /* the kept installer is a convenience: no rollback next time, nothing else changes */ }
  return { promoted };
}

/** True when `file` is the installer a running trial still needs (the updater must not delete it). */
function protectsFile(dir, file, fsImpl = fs) {
  const trial = readTrial(dir, fsImpl);
  return !!trial?.toFile && !!file && path.resolve(trial.toFile) === path.resolve(file);
}

function isBanned(dir, candidate, fsImpl = fs) {
  const ban = readJson(path.join(dir, BAN_FILE), fsImpl);
  return !!ban && typeof ban.version === "string" && !newer(candidate, ban.version) && !newer(ban.version, candidate);
}
/** The notice for the window, once: { failed, back } or null. */
function takeResult({ dir, current, fsImpl = fs }) {
  const result = readJson(path.join(dir, RESULT_FILE), fsImpl);
  if (!result) return null;
  remove(path.join(dir, RESULT_FILE), fsImpl);
  return result.back === current && typeof result.failed === "string" ? { failed: result.failed, back: result.back } : null;
}

/**
 * Runs at the very start (entry.cjs), before main.cjs loads. `env`: { dir, current, packaged, store, now, fsImpl,
 * spawn(file, args, options), hashFile(file) (sync), notify(failed, back), log(text) }.
 * @returns {{ action: "none"|"watch"|"rollback"|"drop"|"failed", trial?: object, reason?: string }}
 */
function guard(env) {
  const fsImpl = env.fsImpl ?? fs;
  if (env.store || !env.packaged) return { action: "none", reason: "not-direct" };
  const trial = noteLaunch({ dir: env.dir, current: env.current, now: env.now, fsImpl });
  const verdict = decide(trial);
  if (verdict.action === "drop") { abortTrial(env.dir, fsImpl); env.log?.(`rollback: ${trial.to} failed ${trial.launches - 1} launches but there is no previous installer`); return { ...verdict, trial }; }
  if (verdict.action !== "rollback") return { ...verdict, trial };
  const kept = readKept(env.dir, fsImpl);
  if (!kept || kept.version !== trial.keep.version || kept.sha256 !== trial.keep.sha256) { abortTrial(env.dir, fsImpl); return { action: "drop", reason: "no-previous-installer", trial }; }
  let sum = null;
  try { sum = env.hashFile(kept.file); } catch { /* unreadable: treated as a mismatch */ }
  if (sum !== kept.sha256) { abortTrial(env.dir, fsImpl); env.log?.(`rollback: the kept installer for ${kept.version} did not match its checksum`); return { action: "failed", reason: "checksum", trial }; }
  try {
    writeJson(path.join(env.dir, BAN_FILE), { version: trial.to, at: new Date(env.now ?? Date.now()).toISOString() }, fsImpl);
    writeJson(path.join(env.dir, RESULT_FILE), { failed: trial.to, back: trial.from, at: new Date(env.now ?? Date.now()).toISOString() }, fsImpl);
    abortTrial(env.dir, fsImpl);
    if (trial.toFile) remove(trial.toFile, fsImpl);
    const child = env.spawn(kept.file, INSTALLER_ARGS, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref?.();
    env.notify?.(trial.to, trial.from);
    env.log?.(`rollback: ${trial.to} failed to run; the installer for ${trial.from} started`);
    return { action: "rollback", trial };
  } catch (error) {
    remove(path.join(env.dir, RESULT_FILE), fsImpl);
    env.log?.(`rollback: could not start the installer for ${trial.from}: ${error instanceof Error ? error.message : String(error)}`);
    return { action: "failed", reason: "spawn", trial };
  }
}

module.exports = { guard, beginTrial, abortTrial, readTrial, noteLaunch, decide, cleanQuit, markHealthy, protectsFile, isBanned, takeResult, readKept, keepDir, MAX_FAILED_LAUNCHES, HEALTHY_MS, TRIAL_FILE, BAN_FILE, RESULT_FILE };
