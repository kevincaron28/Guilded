import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";

// Launch-day check (WoW Forever goes live on 4 November 2026). The companion watches the exact
// saved file the player picked, and every tested install points into the beta client
// (<WoW>\_classic_beta_\WTF\Account\<account>\SavedVariables). If the live client saves under
// another game folder, that file never changes again and nothing is uploaded, with no error.
//
// This looks at the other game folders of the same install (the install folder itself, or a
// folder starting with "_" that holds WTF\Account, as scripts/setup-companion.mjs does) for the
// same file name, and offers one when:
//   - the watched file is in a beta folder and a non-beta folder has the file ("beta"), or
//   - the watched file has not changed for 3 days and another folder's copy is newer ("stale").
// The same account folder name comes first, then any account; then the newest file. Beta folders
// are never offered, and neither is an older file than the one being watched.
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const isBeta = (name) => /beta/i.test(name);
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();

// "C:" alone means "the current folder on C:", not the drive's root.
const joinParts = (parts) => {
  const path = parts.join(sep) || sep;
  return /^[A-Za-z]:$/.test(path) ? path + sep : path;
};

// <root>\[<_flavor_>\]WTF\Account\<account>\SavedVariables\<file>, or null for any other path.
export function savedFileParts(watchFile) {
  const parts = String(watchFile ?? "").split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1 || parts.length !== wtf + 5) return null;
  if (parts[wtf + 1].toLowerCase() !== "account" || parts[wtf + 3].toLowerCase() !== "savedvariables" || !parts[wtf + 4]) return null;
  const game = parts.slice(0, wtf);
  const flavor = game.length > 1 && game.at(-1).startsWith("_") ? game.at(-1) : "";
  const root = flavor ? game.slice(0, -1) : game;
  return { root: joinParts(root), rootName: root.at(-1) || "", flavor, account: parts[wtf + 2], file: parts[wtf + 4] };
}

async function modifiedMs(path) {
  try { const info = await stat(path); return info.isFile() ? info.mtimeMs : null; } catch { return null; }
}

async function subfolders(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
}

// { changedAt, stale, candidate }: when the watched file last changed (ISO, or null when it does
// not exist), whether that is 3 days or more ago, and the better file to watch, or null.
// A candidate is { path, reason: "beta" | "stale", gameFolder, account, sameAccount, changedAt }.
// `ignore`: paths the player already declined; the next best one is offered instead.
export async function checkSavedFile(watchFile, { now = Date.now(), ignore = /** @type {string[]} */ ([]) } = {}) {
  const watchedMs = watchFile ? await modifiedMs(watchFile) : null;
  const stale = watchedMs !== null && now - watchedMs >= STALE_AFTER_MS;
  const result = { changedAt: watchedMs === null ? null : new Date(watchedMs).toISOString(), stale, candidate: null };
  const parts = savedFileParts(watchFile);
  if (!parts) return result;
  const fromBeta = isBeta(parts.flavor);
  if (!fromBeta && !stale) return result;

  const games = [{ name: "", path: parts.root }];
  for (const name of await subfolders(parts.root)) if (name.startsWith("_")) games.push({ name, path: join(parts.root, name) });
  const found = [];
  for (const game of games) {
    if (samePath(game.name, parts.flavor) || isBeta(game.name)) continue;
    const accounts = join(game.path, "WTF", "Account");
    for (const account of await subfolders(accounts)) {
      const path = join(accounts, account, "SavedVariables", parts.file);
      if (ignore.some((declined) => samePath(declined, path))) continue;
      const ms = await modifiedMs(path);
      if (ms === null) continue;
      // Never offer an older file; a copied WTF folder keeps its dates, so equal counts.
      const reason = fromBeta && (watchedMs === null || ms >= watchedMs) ? "beta" : stale && ms > watchedMs ? "stale" : null;
      if (!reason) continue;
      found.push({ path, reason, gameFolder: game.name || parts.rootName, account, sameAccount: samePath(account, parts.account), ms });
    }
  }
  found.sort((a, b) => Number(b.sameAccount) - Number(a.sameAccount) || b.ms - a.ms);
  const best = found[0];
  if (best) {
    const { ms, ...candidate } = best;
    result.candidate = { ...candidate, changedAt: new Date(ms).toISOString() };
  }
  return result;
}
