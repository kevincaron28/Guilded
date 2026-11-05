// Looks for the addon's saved-data file (Guilded.lua) in the usual game
// folders, so most people never have to browse for it.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

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

// Returns [{ path, exists }]: the file itself when it exists, otherwise where
// it will appear once the game has saved once (an account's SavedVariables).
// `names` in order of preference: leaderboards-only (personal) mode passes
// GuildedDungeons.lua then Guilded.lua; the companion reads both from the folder.
function detectSavedVariables(names = ["Guilded.lua"]) {
  const results = [];
  for (const root of candidateRoots()) {
    for (const wtf of findWtfFolders(root)) {
      for (const account of subdirs(path.join(wtf, "Account"))) {
        const folder = path.join(account, "SavedVariables");
        if (!fs.existsSync(folder)) continue;
        const found = names.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file));
        results.push({ path: found ?? path.join(folder, names[0]), exists: !!found, game: path.basename(path.dirname(wtf)), modifiedMs: found ? modifiedMs(found) : 0 });
      }
    }
  }
  return rankSavedVariables(results);
}

function modifiedMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// Existing files first; then the live WoW Forever folder before any other game, the beta client
// last (it stops saving once the live client is installed), and the newest file within a tier.
function rankSavedVariables(results) {
  const tier = (entry) => (/forever/i.test(entry.game) ? 0 : /beta/i.test(entry.game) ? 2 : 1);
  return [...results].sort((a, b) => Number(b.exists) - Number(a.exists) || tier(a) - tier(b) || b.modifiedMs - a.modifiedMs);
}

// The file to pick without asking: the only one, or the only one in a WoW Forever folder.
function pickSavedVariables(existing) {
  if (existing.length === 1) return existing[0];
  const forever = existing.filter((entry) => /forever/i.test(entry.game));
  return forever.length === 1 ? forever[0] : null;
}

module.exports = { detectSavedVariables, rankSavedVariables, pickSavedVariables };
