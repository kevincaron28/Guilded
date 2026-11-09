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

module.exports = { migrateStoreSettings, findStoreFolders };
