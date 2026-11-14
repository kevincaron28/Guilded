"use strict";
// A downloaded update installs by itself while nobody is using the companion (9.3.2, from the second-PC
// finding of 14 November: a hidden tray companion that stays running for days never reached "quit or next
// start"). Everything that touches Electron, the engine or the disk is passed in, so the whole flow runs in tests.
//
// Rules (the owner wants an unattended update to end with the companion back in the tray, never on screen):
// - idle means: window hidden (a minimized window counts as in use for 30 minutes), WoW closed, no sync running;
// - the restart marker is written before the installer starts, so the restarted companion stays hidden;
// - the companion is NOT quit by this code: the installer asks it to quit (quit-for-update, saves settings) and
//   restarts it. If the installer fails to start or exits with an error, the companion is still running;
// - a version whose install failed is not tried again for a day, then two, four ... up to a week.
const fs = require("node:fs");
const path = require("node:path");

const MINIMIZED_IN_USE_MS = 30 * 60 * 1000;
const MARKER_FRESH_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKER_NAME = "update-restart.json";
const INSTALLER_ARGS = ["/S", "--updated", "--force-run"];

/** How long a version that failed to install waits: 1 day, then 2, 4 ... at most 7. */
function backoffMs(count) {
  return Math.min(7 * DAY_MS, DAY_MS * 2 ** Math.max(0, (Number(count) || 1) - 1));
}

/** The failure record after another failed install of `version`. */
function recordFailure(previous, version, now) {
  const count = previous?.version === version ? (Number(previous.count) || 0) + 1 : 1;
  return { version, count, at: new Date(now).toISOString(), nextAt: new Date(now + backoffMs(count)).toISOString() };
}

/** True while `version` failed to install and its waiting time has not passed. */
function inBackoff(failure, version, now) {
  const next = Date.parse(failure?.nextAt ?? "");
  return !!failure && failure.version === version && Number.isFinite(next) && now < next;
}

/** Whether the restarted companion should stay in the tray (the marker the installer-started update left). */
function markerIsFresh(marker, now = Date.now()) {
  const at = Date.parse(marker?.at ?? "");
  return Number.isFinite(at) && now - at >= 0 && now - at < MARKER_FRESH_MS;
}

/**
 * @returns {{ install: boolean, reason: string }}
 */
function decideIdle({ verdict, window = {}, now = Date.now(), wowRunning = false, syncBusy = false, active = false, autoUpdate = true, failure = null }) {
  if (autoUpdate === false) return { install: false, reason: "disabled" };
  if (!verdict || verdict.action !== "install") return { install: false, reason: "nothing-staged" };
  if (active) return { install: false, reason: "busy" };
  if (inBackoff(failure, verdict.version, now)) return { install: false, reason: "backoff" };
  if (window.minimized) {
    const since = Number.isFinite(window.minimizedAt) ? now - window.minimizedAt : 0;
    if (since < MINIMIZED_IN_USE_MS) return { install: false, reason: "window-minimized" };
  } else if (window.visible) {
    return { install: false, reason: "window-open" };
  }
  if (wowRunning) return { install: false, reason: "wow-running" };
  if (syncBusy) return { install: false, reason: "sync-running" };
  return { install: true, reason: "idle" };
}

/** SHA-256 of a file without blocking the app (a 120 MB installer). */
function hashFileAsync(file, fsImpl = fs) {
  const { createHash } = require("node:crypto");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fsImpl.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * The idle installer. `deps`:
 *   updates (update-check.cjs), now(), eligible() (packaged direct build), currentVersion, directory,
 *   getConfig(), saveConfig(), window() -> { visible, minimized, minimizedAt }, wowRunning(), syncBusy(),
 *   checkDisk() -> { ok, freeMb, neededMb, drive }, writeMarker(version), clearMarker(), spawn, log(text),
 *   hashFile(file) (optional, async), fsImpl (optional)
 */
function createIdleInstaller(deps) {
  const now = deps.now ?? Date.now;
  const verified = new Map(); // "file|mtime|size" -> true: a file checked once is not read again while it is unchanged
  let active = false;
  let lastNote = "";
  let child = null;

  function note(text) {
    if (text === lastNote) return;
    lastNote = text;
    deps.log(text);
  }

  async function inspect() {
    const config = deps.getConfig();
    const fsImpl = deps.fsImpl ?? fs;
    // Shape, version, location and attempts first; the file's checksum is checked here, once, without blocking.
    const verdict = deps.updates.inspectPending({ pending: config.pendingUpdate, current: deps.currentVersion, directory: deps.directory, hash: () => config.pendingUpdate?.sha256 });
    if (verdict.action !== "install") return verdict;
    let stat;
    try { stat = fsImpl.statSync(verdict.file); } catch { return { action: "clear", reason: "missing" }; }
    const key = `${verdict.file}|${stat.mtimeMs}|${stat.size}`;
    if (!verified.has(key)) {
      let sum;
      try { sum = await (deps.hashFile ?? ((file) => hashFileAsync(file, fsImpl)))(verdict.file); } catch { return { action: "clear", reason: "missing" }; }
      if (sum !== config.pendingUpdate.sha256) return { action: "clear", reason: "checksum" };
      verified.clear();
      verified.set(key, true);
    }
    return verdict;
  }

  function failed(version, why) {
    const config = deps.getConfig();
    config.updateFailure = recordFailure(config.updateFailure, version, now());
    deps.clearMarker();
    active = false; child = null;
    deps.log(`install of ${version} failed (${why}); not tried again before ${config.updateFailure.nextAt}`);
    return deps.saveConfig();
  }

  /** One look: installs when idle. Safe to call from several places; only one installer ever runs. */
  async function run() {
    if (active) return { started: false, reason: "busy" };
    if (!deps.eligible()) return { started: false, reason: "not-eligible" };
    active = true;
    let started = false;
    try {
      const config = deps.getConfig();
      const verdict = await inspect();
      if (verdict.action === "clear") { note(`downloaded update not usable (${verdict.reason})`); return { started: false, reason: `clear-${verdict.reason}`, verdict }; }
      const decision = decideIdle({ verdict, window: deps.window(), now: now(), wowRunning: deps.wowRunning(), syncBusy: deps.syncBusy(), active: false, autoUpdate: config.autoUpdate, failure: config.updateFailure });
      if (verdict.action === "none") return { started: false, reason: decision.reason };
      if (!decision.install) { note(`install when idle: waiting (${decision.reason})`); return { started: false, reason: decision.reason }; }
      const disk = deps.checkDisk();
      if (!disk.ok) { note(`install not started: only ${disk.freeMb} MB free on ${disk.drive}, ${disk.neededMb} MB needed`); return { started: false, reason: "low-disk" }; }
      lastNote = "";
      config.pendingUpdate = { ...config.pendingUpdate, attempts: (config.pendingUpdate.attempts ?? 0) + 1 };
      await deps.saveConfig();
      deps.writeMarker(verdict.version);
      try {
        child = await new Promise((resolve, reject) => {
          const spawned = deps.spawn(verdict.file, INSTALLER_ARGS, { detached: true, stdio: "ignore", windowsHide: true });
          spawned.once("error", reject);
          spawned.once("spawn", () => resolve(spawned));
        });
      } catch (error) {
        await failed(verdict.version, `could not be started: ${error instanceof Error ? error.message : String(error)}`);
        return { started: false, reason: "spawn-failed" };
      }
      child.unref?.();
      started = true;
      deps.log(`installer for ${verdict.version} started; it asks the companion to quit and restarts it hidden`);
      // The companion keeps running: the installer closes it. An installer that ends with an error leaves it running.
      child.once("exit", (code) => {
        if (code === 0 || code === null) { active = false; child = null; return; }
        void failed(verdict.version, `the installer ended with code ${code}`);
      });
      return { started: true, reason: "idle", version: verdict.version };
    } finally {
      if (!started) active = false;
    }
  }

  return { run, inspect, isActive: () => active };
}

module.exports = { createIdleInstaller, decideIdle, backoffMs, recordFailure, inBackoff, markerIsFresh, hashFileAsync, MARKER_NAME, INSTALLER_ARGS, MINIMIZED_IN_USE_MS, MARKER_FRESH_MS };
