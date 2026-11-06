"use strict";
// Loading the companion's settings at start (9.0). An upgrade must always keep the member's
// Discord sign-in, WoW folder and connections, so:
// - the start logs where the settings were looked for and what was found (file, size, date,
//   how many connections, signed in or not), so a lost setup says why;
// - the first start of each new version keeps the previous version's file untouched as
//   config.secure.before-<version>.bak (the last three are kept), and every good load refreshes
//   config.secure.bak, before any start-up migration rewrites the file;
// - when the settings file is missing, the newest readable backup with a setup in it is put
//   back instead of starting blank;
// - a file that exists but cannot be read is never replaced (store-config.cjs refuses the save).
// Every side effect comes in through the arguments, so this is tested without Electron.

const fs = require("node:fs");
const path = require("node:path");

const KEEP_VERSION_BACKUPS = 3;

/** Nothing set up: no sign-in, no saved-data file, no other connection. */
function isUnset(config) {
  if (!config || typeof config !== "object") return true;
  const own = (p) => Boolean(p?.companionCredential || p?.uploadToken || p?.watchFile || p?.uploadUrl || p?.poeEnabled);
  return !own(config) && !Object.values(config.profiles ?? {}).some(own);
}

/** What the log may say about a configuration: counts and yes/no, never a credential. */
function configSummary(config) {
  const profiles = config?.profiles && typeof config.profiles === "object" ? Object.keys(config.profiles) : [];
  const active = config?.activeProfile || "default";
  const connections = new Set([...profiles, active]).size;
  const signedIn = Boolean(config?.companionCredential) || Object.values(config?.profiles ?? {}).some((p) => Boolean(p?.companionCredential));
  return { connections, active, signedIn, wowFolder: Boolean(config?.watchFile) };
}

function describeFile(file, fsImpl = fs) {
  try {
    const stats = fsImpl.statSync(file);
    return { exists: true, size: stats.size, modified: stats.mtime.toISOString() };
  } catch { return { exists: false, size: 0, modified: null }; }
}

const versionBackupName = (file, version) => `${file}.before-${String(version).replace(/[^0-9A-Za-z.-]/g, "_")}.bak`;

/** The first start of `version` copies the current file, byte for byte, before anything reads or rewrites it. */
function backupBeforeVersion({ file, version, fsImpl = fs }) {
  if (!version || !describeFile(file, fsImpl).exists) return null;
  const target = versionBackupName(file, version);
  if (fsImpl.existsSync(target)) return null;
  fsImpl.copyFileSync(file, target);
  // Keep the newest few.
  const folder = path.dirname(file), base = path.basename(file);
  const old = fsImpl.readdirSync(folder)
    .filter((name) => name.startsWith(`${base}.before-`) && name.endsWith(".bak"))
    .map((name) => ({ name, at: fsImpl.statSync(path.join(folder, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(KEEP_VERSION_BACKUPS);
  for (const item of old) { try { fsImpl.rmSync(path.join(folder, item.name), { force: true }); } catch { /* best effort */ } }
  return target;
}

function backupCandidates(file, fsImpl = fs) {
  const folder = path.dirname(file), base = path.basename(file);
  let names = [];
  try { names = fsImpl.readdirSync(folder); } catch { return []; }
  return names
    .filter((name) => name === `${base}.bak` || (name.startsWith(`${base}.before-`) && name.endsWith(".bak")))
    .map((name) => ({ file: path.join(folder, name), at: fsImpl.statSync(path.join(folder, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map((item) => item.file);
}

/**
 * @param {{
 *   store: { read: (file: string) => Promise<any>, migrate: (file: string, legacy: string) => Promise<any> },
 *   file: string, legacyFile: string, isStore: boolean, defaults: Record<string, any>, version: string,
 *   log: (level: "info" | "warn" | "error", key: string, ...values: unknown[]) => void, fsImpl?: typeof fs
 * }} input
 * @returns {Promise<{ config: Record<string, any>, source: "file" | "backup" | "none" }>}
 */
async function loadSavedConfig({ store, file, legacyFile, isStore, defaults, version, log, fsImpl = fs }) {
  const before = describeFile(file, fsImpl);
  log("info", "Looking for settings in {0}: {1}.", file, before.exists ? `found, ${before.size} bytes, saved ${before.modified}` : "no file");
  if (before.exists) {
    try {
      const kept = backupBeforeVersion({ file, version, fsImpl });
      if (kept) log("info", "Settings from the previous version were kept in {0}.", kept);
    } catch (error) { log("warn", "The settings backup could not be written: {0}", error instanceof Error ? error.message : String(error)); }
  }

  let saved;
  try {
    saved = isStore ? await store.read(file) : await store.migrate(file, legacyFile);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log("error", "Your saved settings in {0} ({1} bytes) could not be read: {2}. They were kept as they are; nothing will overwrite them.", file, before.size, reason);
    throw new Error(`Your saved settings could not be read (${reason}). They were kept in ${file}.`);
  }

  if (saved !== null) {
    const summary = configSummary(saved);
    log("info", "Saved settings hold: {0}.", Object.keys(saved).sort().join(", ") || "(nothing)");
    log("info", "Settings loaded from {0} ({1} bytes, saved {2}): {3} connection(s), signed in: {4}, WoW folder chosen: {5}.", file, before.size, before.modified ?? "?", summary.connections, summary.signedIn ? "yes" : "no", summary.wowFolder ? "yes" : "no");
    if (!isUnset(saved)) { try { fsImpl.copyFileSync(file, `${file}.bak`); } catch { /* best effort */ } }
    return { config: { ...defaults, ...saved }, source: "file" };
  }

  // No settings file: put back the newest backup that holds a setup, if any.
  for (const candidate of backupCandidates(file, fsImpl)) {
    let restored = null;
    try { restored = await store.read(candidate); } catch { restored = null; }
    if (!restored || isUnset(restored)) continue;
    fsImpl.copyFileSync(candidate, file);
    const summary = configSummary(restored);
    log("warn", "No settings file was found in {0}; your settings were restored from {1} ({2} connection(s), signed in: {3}).", path.dirname(file), candidate, summary.connections, summary.signedIn ? "yes" : "no");
    return { config: { ...defaults, ...restored }, source: "backup" };
  }
  log("info", "No saved settings in {0}: starting with a new setup.", path.dirname(file));
  return { config: { ...defaults }, source: "none" };
}

module.exports = { loadSavedConfig, backupBeforeVersion, isUnset, configSummary, describeFile, versionBackupName, KEEP_VERSION_BACKUPS };
