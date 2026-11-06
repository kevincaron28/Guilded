// Guilded's data (GuildedDB) is saved ACCOUNT-wide: <WoW>\<_edition_>\WTF\Account\<account>\SavedVariables\Guilded.lua.
// WoW also keeps a per-character SavedVariables folder (WTF\Account\<account>\<realm>\<character>\SavedVariables)
// that only holds the addon's per-character tables, so a Guilded.lua picked there has no GuildedDB.
// On WoW Forever the realm folder is a number (for example "91") and the account folder can carry a
// Battle.net suffix ("988134169#1"); neither matters here: only the shape below the account does.
//
// Plain ESM with no imports so the companion, the desktop app and the tests can all load it.

const isFolder = (part, name) => String(part ?? "").toLowerCase() === name;

/**
 * Turns any path inside WTF\Account\<account> into the account-level SavedVariables path.
 *   ...\Account\X\SavedVariables\Guilded.lua           -> unchanged
 *   ...\Account\X\<realm>\<char>\SavedVariables\Guilded.lua -> ...\Account\X\SavedVariables\Guilded.lua
 *   ...\Account\X\<realm>\<char>\SavedVariables        -> ...\Account\X\SavedVariables[\defaultFile]
 *   ...\Account\X                                      -> ...\Account\X\SavedVariables[\defaultFile]
 * Paths outside WTF\Account\<account> come back untouched (a file picked elsewhere is the player's choice).
 * @param {string} path @param {string} [defaultFile] appended when the result is the folder itself
 */
export function normalizeSavedPath(path, defaultFile = "") {
  const text = String(path ?? "");
  if (!text.trim()) return text;
  const separator = text.includes("\\") || !text.includes("/") ? "\\" : "/";
  const parts = text.split(/[\\/]/);
  while (parts.length > 1 && parts.at(-1) === "") parts.pop();
  const account = parts.findIndex((part, index) => index > 0 && isFolder(part, "account") && isFolder(parts[index - 1], "wtf"));
  if (account < 0 || parts.length <= account + 1) return text;
  const head = parts.slice(0, account + 2);
  const rest = parts.slice(account + 2);
  if (isFolder(rest[0], "savedvariables")) return text;
  const savedIndex = rest.findIndex((part) => isFolder(part, "savedvariables"));
  let tail;
  if (savedIndex > 0) tail = rest.slice(savedIndex + 1);
  else if (rest.length > 0 && /\.lua$/i.test(rest.at(-1))) tail = [rest.at(-1)];
  else tail = [];
  if (tail.length === 0 && defaultFile) tail = [defaultFile];
  return [...head, "SavedVariables", ...tail].join(separator);
}

/** True when the path is below an account folder but not directly in its SavedVariables folder. @param {string} path */
export function isCharacterLevelPath(path) {
  const text = String(path ?? "");
  return text.trim() !== "" && normalizeSavedPath(text) !== text;
}

/**
 * Normalizes every saved connection's watched file (the active settings and each saved profile).
 * Returns { config, changed }: the same object when nothing needed changing.
 * @param {Record<string, any>} config
 */
export function migrateWatchFiles(config) {
  let changed = false;
  const fix = (profile) => {
    const next = typeof profile?.watchFile === "string" && profile.watchFile ? normalizeSavedPath(profile.watchFile) : profile?.watchFile;
    if (next === profile?.watchFile) return profile;
    changed = true;
    return { ...profile, watchFile: next };
  };
  const result = fix(config);
  let profiles = result.profiles;
  if (profiles && typeof profiles === "object") {
    profiles = Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, fix(profile)]));
    if (changed) return { config: { ...result, profiles }, changed };
  }
  return { config: result, changed };
}

/** The account folder name of a saved file ("988134169#1"), or "". @param {string} path */
export function accountOf(path) {
  const parts = String(path ?? "").split(/[\\/]/);
  const index = parts.findIndex((part, i) => i > 0 && isFolder(part, "account") && isFolder(parts[i - 1], "wtf"));
  return index >= 0 ? parts[index + 1] ?? "" : "";
}
