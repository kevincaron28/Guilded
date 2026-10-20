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
        results.push({ path: found ?? path.join(folder, names[0]), exists: !!found });
      }
    }
  }
  results.sort((a, b) => Number(b.exists) - Number(a.exists));
  return results;
}

module.exports = { detectSavedVariables };
