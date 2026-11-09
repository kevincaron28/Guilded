"use strict";
// (9.1.3) Taking over a Microsoft Store companion's settings that the installer could only set aside.
//
// replace-store.ps1 copies the Store version's settings into this version's folder. When this version
// already had settings (a first start before the Store one was replaced, which an unsigned zero-setup
// start counts as), the Store files were kept in "store-settings-backup" instead, and the member
// started signed out. The settings file is only readable with its own "Local State" key, so the two
// files move as a pair: when this start has no Discord sign-in and the backup is there, the current
// pair is kept in "before-store-adopt" and the Store pair takes its place (then the app restarts once).
// Every file system call comes in through fsImpl, so this is tested without Electron.

const fs = require("node:fs");
const path = require("node:path");

const BACKUP = "store-settings-backup";
const KEPT = "before-store-adopt";
const MARKER = "store-settings-adopted.json";
// The pair that must stay together, then the small files that go with them.
const PAIR = ["config.secure", "Local State"];
const EXTRA = ["language.json", "hub-cache.json"];

function signedIn(config) {
  const own = (p) => Boolean(p?.companionCredential);
  return own(config) || Object.values(config?.profiles ?? {}).some(own);
}

/** True when the Store settings in the backup folder should replace this start's (not signed in, not done before). */
function canAdopt({ folder, config, fsImpl = fs }) {
  if (signedIn(config)) return false;
  if (fsImpl.existsSync(path.join(folder, MARKER))) return false;
  return PAIR.every((name) => fsImpl.existsSync(path.join(folder, BACKUP, name)));
}

/** Moves the current pair aside and puts the Store pair in place. Returns the names it kept and took. */
function adoptStoreSettings({ folder, fsImpl = fs, now = () => new Date() }) {
  const kept = path.join(folder, KEPT);
  fsImpl.mkdirSync(kept, { recursive: true });
  const moved = [];
  for (const name of [...PAIR, ...EXTRA]) {
    const current = path.join(folder, name);
    if (fsImpl.existsSync(current)) fsImpl.copyFileSync(current, path.join(kept, name));
  }
  for (const name of [...PAIR, ...EXTRA]) {
    const source = path.join(folder, BACKUP, name);
    if (!fsImpl.existsSync(source)) continue;
    fsImpl.copyFileSync(source, path.join(folder, name));
    moved.push(name);
  }
  fsImpl.writeFileSync(path.join(folder, MARKER), JSON.stringify({ at: now().toISOString(), took: moved }));
  return { kept, took: moved };
}

module.exports = { canAdopt, adoptStoreSettings, signedIn, BACKUP, KEPT, MARKER };
