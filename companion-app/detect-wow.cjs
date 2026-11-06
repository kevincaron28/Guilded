// Looks for the addon's saved-data file (Guilded.lua) in the usual game
// folders, so most people never have to browse for it.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// True when the file defines the account-wide table (a per-character Guilded.lua holds only
// GuildedPresenceDB). A file that cannot be read counts as "no".
function hasDatabase(file) {
  try {
    if (fs.statSync(file).size > 64 * 1024 * 1024) return false;
    return /^\s*GuildedDB\s*=/m.test(fs.readFileSync(file, "utf8"));
  } catch { return false; }
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch { return []; }
}

// Game installs contain a WTF folder, directly or inside _classic_ / _era_ etc.
function findWtfFolders(root) {
  const found = [];
  for (const dir of [root, ...subdirs(root).filter((d) => /^_/.test(path.basename(d)))]) {
    const wtf = path.join(dir, "WTF");
    if (fs.existsSync(wtf)) found.push(wtf);
  }
  return found;
}

function candidateRoots() {
  const home = os.homedir();
  const parents = [];
  for (const drive of ["C", "D", "E", "F", "G"]) {
    for (const sub of ["", "Games", "Program Files (x86)", "Program Files", "Blizzard", "Battle.net"]) parents.push(`${drive}:\\${sub}`);
  }
  parents.push(path.join(home, "Desktop"), path.join(home, "Games"), path.join(home, "Downloads"), path.join(home, "AppData", "Local"));
  const roots = [];
  for (const parent of parents) {
    for (const dir of subdirs(parent)) {
      if (/warcraft|wow|forever/i.test(path.basename(dir))) roots.push(dir);
    }
  }
  return roots;
}

// `isHeld(game)`: true for a game folder whose edition is switched off (companion/active-editions.mjs);
// those files are left out, never offered. Use detectHeldSavedVariables to count them.
// Returns [{ path, exists }]: the file itself when it exists, otherwise where
// it will appear once the game has saved once (an account's SavedVariables).
// `names` in order of preference: leaderboards-only (personal) mode passes
// GuildedDungeons.lua then Guilded.lua; the companion reads both from the folder.
function detectSavedVariables(names = ["Guilded.lua"], isHeld = () => false) {
  const results = [];
  for (const root of candidateRoots()) {
    for (const wtf of findWtfFolders(root)) {
      for (const account of subdirs(path.join(wtf, "Account"))) {
        const folder = path.join(account, "SavedVariables");
        if (!fs.existsSync(folder)) continue;
        const found = names.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file));
        results.push({ path: found ?? path.join(folder, names[0]), exists: !!found, game: path.basename(path.dirname(wtf)), account: path.basename(account), modifiedMs: found ? modifiedMs(found) : 0, hasDatabase: found ? hasDatabase(found) : false });
      }
    }
  }
  return rankSavedVariables(results);
}

// Same scan, but only the files of editions that are on hold (so the app can say so plainly).
function detectHeldSavedVariables(names = ["Guilded.lua"], isHeld = () => false) {
  return detectSavedVariables(names).filter((entry) => isHeld(entry.game));
}

function modifiedMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// Existing files first, then those that hold GuildedDB (the real account file); then the live WoW
// Forever folder before any other game, the beta client last (it stops saving once the live client
// is installed), and the newest file within a tier.
function rankSavedVariables(results) {
  const tier = (entry) => (/forever/i.test(entry.game) ? 0 : /beta/i.test(entry.game) ? 2 : 1);
  return [...results].sort((a, b) => Number(b.exists) - Number(a.exists) || Number(!!b.hasDatabase) - Number(!!a.hasDatabase) || tier(a) - tier(b) || b.modifiedMs - a.modifiedMs);
}

// Several accounts (Battle.net ids, "#1" / "#2" logins): the newest file wins only when it is clearly
// the one being played, not a copy from the same hour.
const CLEARLY_NEWER_MS = 10 * 60 * 1000;
function newestClear(list) {
  if (list.length === 1) return list[0];
  const sorted = [...list].sort((a, b) => b.modifiedMs - a.modifiedMs);
  return sorted.length > 1 && sorted[0].modifiedMs - sorted[1].modifiedMs >= CLEARLY_NEWER_MS ? sorted[0] : null;
}

// The file to pick without asking: the only one, or the only one in a WoW Forever folder; entries that
// hold GuildedDB are preferred, and among several of them the clearly newest one. Otherwise null (ask).
function pickSavedVariables(existing) {
  if (existing.length === 1) return existing[0];
  const withDatabase = existing.filter((entry) => entry.hasDatabase === true);
  if (withDatabase.length > 0 && withDatabase.length < existing.length) {
    const picked = pickSavedVariables(withDatabase);
    if (picked) return picked;
  }
  const forever = existing.filter((entry) => /forever/i.test(entry.game));
  if (forever.length === 1) return forever[0];
  if (existing.every((entry) => entry.hasDatabase === true)) {
    return newestClear(forever.length > 1 ? forever : existing);
  }
  return null;
}

// Folder picker (8.5, track F3). The install folder of a saved file (…\World of Warcraft for
// …\World of Warcraft\_forever_\WTF\Account\X\SavedVariables\Guilded.lua), or null.
function installRootOf(file) {
  const parts = String(file ?? "").split(/[\\/]/);
  const wtf = parts.findIndex((part, index) => index > 0 && part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  const game = parts.slice(0, wtf);
  const root = game.length > 1 && game.at(-1).startsWith("_") ? game.slice(0, -1) : game;
  const text = root.join(path.sep);
  return /^[A-Za-z]:$/.test(text) ? text + path.sep : text;
}

// Where the picker opens: the watched file's install, a detected one, or the usual Battle.net
// folder when it exists. Undefined lets Windows choose.
function pickerStart(watchFile, detected = []) {
  const known = installRootOf(watchFile) || detected.map((entry) => installRootOf(entry.path)).find(Boolean);
  if (known && fs.existsSync(known)) return known;
  for (const guess of ["C:\\Program Files (x86)\\World of Warcraft", "C:\\Program Files\\World of Warcraft"]) if (fs.existsSync(guess)) return guess;
  return undefined;
}

// Every WoW account below a folder the member picked: the install folder, a game folder
// (_forever_), WTF, WTF\Account, one account folder or anything inside it, or a folder that holds
// the install. Editions on hold and the beta client are left out when anything else is found.
// Same entries as detectSavedVariables, ranked the same way.
function accountsUnder(folder, names = ["Guilded.lua"], isHeld = () => false) {
  const parts = String(folder ?? "").split(/[\\/]/).filter((part, index) => part !== "" || index === 0);
  const wtfIndex = parts.findIndex((part, index) => index > 0 && part.toLowerCase() === "wtf");
  const entry = (account, wtf) => {
    const saved = path.join(account, "SavedVariables");
    const found = names.map((name) => path.join(saved, name)).find((file) => fs.existsSync(file));
    return { path: found ?? path.join(saved, names[0]), exists: !!found, game: path.basename(path.dirname(wtf)), account: path.basename(account), modifiedMs: found ? modifiedMs(found) : 0, hasDatabase: found ? hasDatabase(found) : false };
  };
  const accountsIn = (wtf) => subdirs(path.join(wtf, "Account")).filter((dir) => path.basename(dir).toLowerCase() !== "savedvariables").map((account) => entry(account, wtf));
  let results = [];
  if (wtfIndex > 0) {
    const wtf = parts.slice(0, wtfIndex + 1).join(path.sep);
    // Inside one account (…\WTF\Account\X\…): that account only.
    if (parts.length > wtfIndex + 2 && parts[wtfIndex + 1].toLowerCase() === "account") {
      results = [entry(parts.slice(0, wtfIndex + 3).join(path.sep), wtf)];
    } else results = accountsIn(wtf);
  } else {
    // The install, a game folder, or one level above the install ("C:\Games").
    const roots = [folder, ...subdirs(folder)];
    for (const root of roots) for (const wtf of findWtfFolders(root)) results.push(...accountsIn(wtf));
  }
  const unique = [...new Map(results.map((item) => [item.path.toLowerCase(), item])).values()];
  const playable = unique.filter((item) => !isHeld(item.game) && !/beta/i.test(item.game));
  return rankSavedVariables(playable.length ? playable : unique.filter((item) => !isHeld(item.game)));
}

module.exports = { hasDatabase, detectSavedVariables, detectHeldSavedVariables, rankSavedVariables, pickSavedVariables, installRootOf, pickerStart, accountsUnder };
