"use strict";
// First run of a direct-download companion with no settings of its own (9.1.3): bring over the
// Microsoft Store companion's settings. The Store build keeps them inside its package
// (%LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\Guilded Companion Store, 9.0.2 replace-store.ps1
// does the same when the installer finds the package). config.secure is protected for this Windows
// user (DPAPI), so the copy works for the same person on the same PC. The Store copy is never deleted.
// Every side effect comes in through the arguments, so this is tested without Electron.

const fs = require("node:fs");
const path = require("node:path");

const FAMILY_PREFIX = "kcaron.guildedcompanion_";
const FOLDERS = ["Guilded Companion Store", "Guilded Companion"];
const KEEP = ["config.secure", "Local State", "language.json", "hub-cache.json"];

const wanted = (name) => KEEP.includes(name) || /^poe-journal.*\.json$/.test(name) || /^config\.secure.*\.bak$/.test(name);

/** Store-era settings folders on this PC, newest first (one per installed package family and folder name). */
function findStoreFolders({ localAppData, appData, fsImpl = fs }) {
  const found = [];
  const add = (dir) => { try { if (fsImpl.statSync(path.join(dir, "config.secure")).isFile()) found.push(dir); } catch { /* none here */ } };
  if (localAppData) {
    let families = [];
    try { families = fsImpl.readdirSync(path.join(localAppData, "Packages")).filter((n) => n.toLowerCase().startsWith(FAMILY_PREFIX)); } catch { /* no packages */ }
    for (const family of families) for (const folder of FOLDERS) add(path.join(localAppData, "Packages", family, "LocalCache", "Roaming", folder));
  }
  if (appData) add(path.join(appData, "Guilded Companion Store"));
  const time = (dir) => { try { return fsImpl.statSync(path.join(dir, "config.secure")).mtimeMs; } catch { return 0; } };
  return found.sort((a, b) => time(b) - time(a));
}

/**
 * @returns {{ migrated: boolean, from?: string, files?: string[] }}
 */
function migrateStoreSettings({ userData, localAppData, appData, fsImpl = fs, log = () => {} }) {
  const target = path.join(userData, "config.secure");
  if (fsImpl.existsSync(target) || fsImpl.existsSync(path.join(userData, "config.json"))) return { migrated: false };
  const sources = findStoreFolders({ localAppData, appData, fsImpl }).filter((dir) => path.resolve(dir).toLowerCase() !== path.resolve(userData).toLowerCase());
  const from = sources[0];
  if (!from) return { migrated: false };
  try {
    fsImpl.mkdirSync(userData, { recursive: true });
    const files = fsImpl.readdirSync(from).filter(wanted);
    for (const name of files) fsImpl.copyFileSync(path.join(from, name), path.join(userData, name));
    log(from, files);
    return { migrated: true, from, files };
  } catch {
    // Partial copy: remove it so the next start tries again instead of trusting half a setup.
    try { fsImpl.rmSync(target, { force: true }); } catch { /* best effort */ }
    return { migrated: false };
  }
}

/** Fields that make a Discord sign-in work and say which server it belongs to. */
const CREDENTIAL_FIELDS = ["companionCredential", "guildDiscordId", "personal", "uploadUrl", "wowGuild", "wowGuildName"];
const IMPORT_MARKER = "store-signin-import.done";
const hasCredential = (c) => typeof c?.companionCredential === "string" && c.companionCredential.length >= 32;

/**
 * (9.1.4) A direct-download install that started on its own (zero-setup) holds only a device key. When
 * a Store settings folder on this PC still has a Discord sign-in, take it over: the install keeps its
 * device key and WoW folder, and gains the credential (the device claim then runs as after a sign-in).
 * An install that already has a credential is never changed, so the newer sign-in always wins.
 * `readSettings(dir)` returns the decrypted settings of a Store folder (null when unreadable); it is
 * injected because decrypting needs Windows (store-decrypt.cjs).
 * @returns {Promise<{ patch: Record<string, unknown>, from: string } | null>}
 */
async function importStoreCredential({ config, userData, localAppData, appData, readSettings, fsImpl = fs }) {
  const marker = path.join(userData, IMPORT_MARKER);
  if (!config || hasCredential(config) || Object.values(config.profiles ?? {}).some(hasCredential)) return null;
  const hasDeviceKey = typeof config.deviceSecret === "string" && config.deviceSecret.length > 0;
  if (!hasDeviceKey) return null;
  if (fsImpl.existsSync(marker)) return null;
  try { fsImpl.mkdirSync(userData, { recursive: true }); fsImpl.writeFileSync(marker, new Date().toISOString()); } catch { return null; }
  const folders = findStoreFolders({ localAppData, appData, fsImpl });
  // replace-store.ps1 keeps the Store copy here when the install already had settings of its own.
  const backup = path.join(userData, "store-settings-backup");
  try { if (fsImpl.statSync(path.join(backup, "config.secure")).isFile()) folders.push(backup); } catch { /* none */ }
  const own = path.resolve(userData).toLowerCase();
  for (const dir of folders.filter((d) => path.resolve(d).toLowerCase() !== own)) {
    let stored = null;
    try { stored = await readSettings(dir); } catch { stored = null; }
    if (!hasCredential(stored)) continue;
    const patch = {};
    for (const key of CREDENTIAL_FIELDS) if (stored[key] !== undefined && stored[key] !== "") patch[key] = stored[key];
    // Keep this install's own server pick when it has one.
    if (config.guildDiscordId) delete patch.guildDiscordId;
    return { patch, from: dir };
  }
  return null;
}

module.exports = { migrateStoreSettings, findStoreFolders, importStoreCredential, IMPORT_MARKER };
