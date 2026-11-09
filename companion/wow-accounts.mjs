// Several WoW accounts on one PC (docs/plans/MULTI_ACCOUNT.md, step 1; owner decisions 7 November
// 2026): every account folder of the watched WoW install that holds Guilded's data can sync, but a
// second one is added only after the member says once that it is theirs too (partners can share a
// PC). The answer is remembered either way.
//
// config.watchFile    the first account, as before (older code and the Copy report read it).
// config.watchFiles   further accounts the member said yes to.
// config.accountsDeclined  accounts the member said are not theirs: never asked again.
//
// Plain ESM with no imports, so the desktop app, the window bundle and the tests share it.

/** At most this many accounts sync per connection (the WoW1 to WoW8 style logins fit easily). */
export const MAX_ACCOUNTS = 8;

const key = (file) => String(file ?? "").replaceAll("\\", "/").toLowerCase();
const parts = (file) => String(file ?? "").split(/[\\/]/);

/** The account folder's name (WOW1, 12345678#1) of …\WTF\Account\<name>\SavedVariables\Guilded.lua. */
export function accountName(file) {
  const list = parts(file);
  return list.length >= 3 ? list.at(-3) : "";
}

/** …\WTF\Account of a saved file, lower case with forward slashes, or "" when it is not inside one. */
export function accountsFolder(file) {
  const list = parts(file);
  const index = list.findLastIndex((part, at) => part.toLowerCase() === "account" && at > 0 && list[at - 1].toLowerCase() === "wtf");
  return index > 0 ? key(list.slice(0, index + 1).join("/")) : "";
}

/**
 * Every saved file this connection syncs: the first account, then the others, without repeats.
 * Another account counts only inside the watched install's WTF\Account folder, so choosing a
 * different WoW folder leaves the old install's accounts out by itself.
 */
export function accountFiles(config = {}) {
  const seen = new Set();
  const files = [];
  const folder = config.watchFile ? accountsFolder(config.watchFile) : null;
  for (const file of [config.watchFile, ...(Array.isArray(config.watchFiles) ? config.watchFiles : [])]) {
    if (typeof file !== "string" || !file || seen.has(key(file))) continue;
    if (folder !== null && file !== config.watchFile && accountsFolder(file) !== folder) continue;
    seen.add(key(file));
    files.push(file);
  }
  return files.slice(0, MAX_ACCOUNTS);
}

/**
 * Accounts to ask about: saved files that hold Guilded's data, in the same WoW install and game
 * folder as the watched one, that are neither synced already nor declined.
 * @param {{ watchFile?: string, watchFiles?: string[], accountsDeclined?: string[], wowEnabled?: boolean }} config
 * @param {{ path: string, exists?: boolean, hasDatabase?: boolean }[]} entries  detect-wow.cjs's entries
 * @returns {{ path: string, account: string }[]}
 */
export function newAccounts(config = {}, entries = []) {
  if (config.wowEnabled === false || !config.watchFile) return [];
  const folder = accountsFolder(config.watchFile);
  if (!folder) return [];
  const known = new Set([...accountFiles(config), ...(Array.isArray(config.accountsDeclined) ? config.accountsDeclined : [])].map(key));
  if (accountFiles(config).length >= MAX_ACCOUNTS) return [];
  const seen = new Set();
  return entries
    .filter((entry) => entry?.exists && entry.hasDatabase === true && accountsFolder(entry.path) === folder && !known.has(key(entry.path)))
    .filter((entry) => !seen.has(key(entry.path)) && seen.add(key(entry.path)))
    .map((entry) => ({ path: entry.path, account: accountName(entry.path) }));
}

/**
 * The member's answer to "Is <account> yours too?". Yes adds it to the synced accounts; no
 * remembers it so it is never asked again. An answer about a file already decided changes nothing.
 * @returns {Record<string, any>} the new config
 */
export function answerAccount(config = {}, file, yes) {
  if (typeof file !== "string" || !file || accountFiles(config).some((known) => key(known) === key(file))) return config;
  const declined = (Array.isArray(config.accountsDeclined) ? config.accountsDeclined : []).filter((known) => key(known) !== key(file));
  if (!yes) return { ...config, accountsDeclined: [...declined, file].slice(-20) };
  if (accountFiles(config).length >= MAX_ACCOUNTS) return config;
  return { ...config, watchFiles: [...accountFiles(config).slice(1), file], accountsDeclined: declined };
}

/** The connections the profile engine runs: one per synced account. The first keeps its id. */
export function expandAccounts(entries) {
  const out = [];
  for (const [id, profile] of entries) {
    const files = profile.wowEnabled === false ? [] : accountFiles(profile);
    out.push([id, { ...profile, watchFile: files[0] ?? profile.watchFile, watchFiles: [] }, null]);
    files.slice(1).forEach((file, index) => {
      // Only the first account tracks PoE2 and owns the connection's own files.
      out.push([`${id}~${index + 2}`, { ...profile, watchFile: file, watchFiles: [], poeEnabled: false }, id]);
    });
  }
  return out;
}

/**
 * The switch beside an account in Settings (plan step 2). On: it syncs (and is no longer "not
 * mine"); off: it stops syncing and is not asked about again. The first account has no switch
 * (turning WoW off does that), and only accounts the companion already knows can be switched.
 * @returns {Record<string, any>} the new config (unchanged when the file is not switchable)
 */
export function switchAccount(config = {}, file, on) {
  if (typeof file !== "string" || !file || !config.watchFile || key(file) === key(config.watchFile)) return config;
  const synced = accountFiles(config).slice(1);
  const declined = Array.isArray(config.accountsDeclined) ? config.accountsDeclined : [];
  const isSynced = synced.some((known) => key(known) === key(file));
  const isDeclined = declined.some((known) => key(known) === key(file)) && accountsFolder(file) === accountsFolder(config.watchFile);
  if (on) return isDeclined ? answerAccount(config, file, true) : config;
  if (!isSynced) return config;
  return { ...config, watchFiles: synced.filter((known) => key(known) !== key(file)), accountsDeclined: [...declined.filter((known) => key(known) !== key(file)), file].slice(-20) };
}

/**
 * One row per account for Settings and the Sync page: the synced ones with what each is doing
 * (from the profile engine's state.accounts), then the ones switched off. Text is an English key
 * with {0} slots; an { ago } value is a time the window words ("2 min ago").
 * @param {Record<string, any>} config
 * @param {{ file: string, running?: boolean, lastUpload?: { at: string } | null, syncPhase?: string | null, error?: string | null }[]} [accounts]
 */
export function accountRows(config = {}, accounts = []) {
  if (config.wowEnabled === false || !config.watchFile) return [];
  const live = new Map(accounts.map((entry) => [key(entry.file), entry]));
  const folder = accountsFolder(config.watchFile);
  const rows = accountFiles(config).map((file, index) => {
    const state = live.get(key(file));
    const account = accountName(file);
    const text = state?.error ? ["{0}: {1}", account, state.error]
      : state?.lastUpload?.at ? ["{0}: synced {1}", account, { ago: state.lastUpload.at }]
      : state?.running ? ["{0}: waiting for WoW to save Guilded's data. Log in on that account and type /reload once.", account]
      : ["{0}: not syncing yet", account];
    return { file, account, on: true, first: index === 0, text };
  });
  const off = (Array.isArray(config.accountsDeclined) ? config.accountsDeclined : [])
    .filter((file) => accountsFolder(file) === folder && !rows.some((row) => key(row.file) === key(file)))
    .map((file) => ({ file, account: accountName(file), on: false, first: false, text: ["{0}: off", accountName(file)] }));
  return [...rows, ...off];
}
