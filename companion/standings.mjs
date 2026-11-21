import { cleanRunCards } from "./run-cards.mjs";
import { standingsToLua, linkedAsLua, linkedMapLua, linkedMapKey, ownProfileMatcher } from "./standings-format.mjs";
export { standingsToLua } from "./standings-format.mjs";
import { readFile, readdir, stat, writeFile, rename, rm } from "node:fs/promises";
import { readSavedText } from "./saved-file.mjs";
import { credentialHeaders, requestJson, protocolSupported, MIN_KNOWN_PROTOCOL } from "./request.mjs";
import { writeDataAddon } from "./data-addon.mjs";
import { dirname, join, sep } from "node:path";
import { withoutFeatureStamp } from "./group-relay.mjs";
import { readSavedIdentity, savedFilePair } from "./addon-files.mjs";
import { standaloneReceiptsToLua } from "./device-receipts.mjs";
import { existsSync } from "node:fs";
import { assertSameEdition } from "./game-edition.mjs";
import { readRecord, withRecordReceipts } from "./parked-runs.mjs";

// SavedVariables live at <game>\WTF\Account\<acct>\SavedVariables\Guilded.lua,
// and the addon at <game>\Interface\AddOns\Guilded. `standingsFile` in
// companion.config.json overrides this if the layout is different.
export function resolveStandingsPath(config) {
  if (config.standingsFile) return config.standingsFile;
  const parts = config.watchFile.split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  return join(parts.slice(0, wtf).join(sep) || sep, "Interface", "AddOns", "Guilded", "Standings.lua");
}

// A saved file's identity, read again only when one of its two saved files changed (size or time): the names are needed before
// every standings request, long polls included, and a saved file can be several MB.
const identityCache = new Map();
async function savedIdentityCached(file) {
  const pair = savedFilePair(file);
  const stamp = (await Promise.all([file, pair.guilded, pair.standalone].map((path) => stat(path).then((s) => `${s.size}:${s.mtimeMs}`, () => "-")))).join("|");
  const kept = identityCache.get(file);
  if (kept && kept.stamp === stamp) return kept.identity;
  const identity = await readSavedIdentity(file);
  if (identityCache.size > 50) identityCache.clear();
  identityCache.set(file, { stamp, identity });
  return identity;
}

// The characters of the install's other WoW account folders (WTF\Account\<acct>\SavedVariables): Standings.lua is one file for
// every account of the install, so each of them keeps its own dungeon profile complete (9.4.7). Best effort: an unreadable folder
// adds nothing.
async function otherAccountNames(config) {
  const watch = String(config.watchFile ?? "");
  if (!watch.toLowerCase().endsWith(".lua")) return [];
  const parts = watch.split(/[\\/]/);
  const at = parts.findIndex((part, index) => part.toLowerCase() === "account" && parts[index - 1]?.toLowerCase() === "wtf");
  const files = new Set((Array.isArray(config.watchFiles) ? config.watchFiles : []).filter((file) => typeof file === "string" && file !== watch));
  if (at > 0 && parts.length > at + 2) {
    const accounts = parts.slice(0, at + 1).join(sep) || sep;
    try {
      for (const entry of (await readdir(accounts, { withFileTypes: true })).slice(0, 20)) {
        if (entry.isDirectory() && entry.name !== parts[at + 1]) files.add(join(accounts, entry.name, ...parts.slice(at + 2)));
      }
    } catch { /* no account folder list: only the configured accounts */ }
  }
  const names = [];
  for (const file of files) {
    try { names.push(...(await savedIdentityCached(file)).entries.flatMap((entry) => typeof entry?.name === "string" ? [entry.name] : [])); }
    catch { /* no Guilded save in that account */ }
  }
  return names;
}

// The played account's saved identity (9.3.0: a PC with Guilded Dungeons alone has no GuildedDB: the standalone file answers who
// this PC is, addon-files.mjs) and its characters' names. A missing file is no identity; any other error is the caller's.
async function readLocalIdentity(config) {
  let identity = null;
  if (config.watchFile.toLowerCase().endsWith(".lua")) {
    try { identity = await savedIdentityCached(config.watchFile); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  } else {
    try { const json = JSON.parse(await readSavedText(config.watchFile)); identity = { character: json, entries: [json, ...(Array.isArray(json.alts) ? json.alts : []), ...Object.values(json.myCharacters ?? {})] }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { identity, names: identity ? identity.entries.flatMap((entry) => typeof entry?.name === "string" ? [entry.name] : []) : [] };
}
// The set of this PC's character names as one string (order and repeats do not matter).
const localNamesKey = (names) => [...new Set(names.map((name) => linkedMapKey(name)).filter(Boolean))].sort().join("\n");

// Older bots stamp every answer with the time of the request; compare the rest so an unchanged
// table does not rewrite the file (the game only reads it on reload anyway).
export const withoutStamps = (value) => withoutFeatureStamp(value.replace(/updatedAt = "[^"]*",/g, ""));
// Public vacancies expire after ten minutes in the addon. Keep writing their
// freshness stamp, but do not announce that heartbeat as an EP/GP change.
const withoutRefreshStamps = (value) => withoutStamps(value).replace(/fetchedAt = "[^"]*",/g, "");

// Fetches the standings and writes them for the addon.
// `options.etag`: the ETag of the answer already written. The bot then answers 304 when nothing
// changed. It goes as If-None-Match and as `since`, because the website proxy drops most headers.
// `options.waitSeconds`: the bot may hold the request until something changes (long poll).
export async function writeStandings(config, signal, options = {}) {
  const path = resolveStandingsPath(config);
  if (!path) throw new Error("Could not find the AddOns folder from watchFile; set standingsFile in companion.config.json.");
  const url = new URL("/api/v1/standings", config.uploadUrl);
  url.searchParams.set("guild", config.guildDiscordId);
  const headers = { ...credentialHeaders(config) };
  // This PC's characters, read before asking (an error is raised where it always was, after the answer). 9.4.7: the dungeon board
  // is shaped by them, so when they change (a character played here for the first time) the file is written again even though the
  // bot's answer did not change: the ETag is not sent and the full answer comes back. `options.namesKey`: the set the last write used.
  const local = await readLocalIdentity(config).then((value) => ({ value }), (error) => ({ error }));
  const others = local.error ? [] : await otherAccountNames(config);
  const namesKey = local.error ? null : localNamesKey([...(local.value?.names ?? []), ...others]);
  const sendEtag = options.etag && (options.namesKey === undefined || options.namesKey === namesKey) ? options.etag : null;
  if (sendEtag) {
    headers["if-none-match"] = sendEtag;
    url.searchParams.set("since", sendEtag);
    if (options.waitSeconds) url.searchParams.set("wait", String(options.waitSeconds));
  }
  const { response, body } = await requestJson(url, { headers }, signal, options.waitSeconds ? (options.waitSeconds + 20) * 1000 : undefined);
  const etag = response.headers?.get?.("etag") ?? null;
  if (response.status === 304) return { notModified: true, etag: etag ?? sendEtag ?? null, path, namesKey };
  if (!response.ok) {
    // A reverse proxy can return an empty or HTML error while the bot restarts.
    const detail = typeof body?.error === "string" && body.error.trim() ? body.error
      : response.status >= 500 ? "The guild bot is temporarily unavailable. Standings will retry automatically."
      : "The server did not provide an error message.";
    throw new Error(`Standings request failed (${response.status}): ${detail}`);
  }
  if (!protocolSupported(body)) throw new Error(!Number.isInteger(body.protocolVersion) || body.protocolVersion < MIN_KNOWN_PROTOCOL ? "Update the bot before using this companion (sync protocol 2 or newer required)." : "Update this companion before using this bot (a newer sync protocol is required).");
  // Check the actual saved file before replacing standings or acknowledging
  // its ledger. Missing legacy saves retain first-run repair behavior.
  if (local.error) throw local.error;
  const identity = local.value?.identity ?? null;
  // This PC's own characters (the played one and the account's others), for the per-character "Linked to Discord" line.
  const ownNames = local.value?.names ?? [];
  if (identity) assertSameEdition(identity.character ?? {}, body);
  // The member's own Discord name for the in-game "Linked to Discord as ..." line (Track L).
  // Per character (9.1.4): a name of this PC that the bot holds in this server is linked to the signed-in member; the old
  // PC-wide line stays for older addons. Characters the bot does not hold get no entry, so the addon says nothing for them.
  const account = config.discordAccount && (config.discordAccount.displayName || config.discordAccount.username);
  // `accounts` maps a character to its member: the member holding most of this PC's characters is the signed-in one, so a
  // character of this PC that someone else holds (a squatter) is never shown as linked to this member.
  const owners = new Map(Object.entries(body.accounts ?? {}).map(([character, member]) => [linkedMapKey(character), member]));
  const mine = ownNames.flatMap((name) => owners.has(linkedMapKey(name)) ? [{ name, member: owners.get(linkedMapKey(name)) }] : []);
  const tally = new Map();
  for (const { member } of mine) tally.set(member, (tally.get(member) ?? 0) + 1);
  const self = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const linked = account ? mine.filter(({ member }) => member === self).map(({ name }) => ({ name, discord: account, confirmed: true })) : [];
  // Runs of a parked guild the bot acknowledged stay in the accepted list (the answer above only knows this server's guild).
  // 9.4.7 ("shrink the board"): only this PC's own characters get their complete dungeon profile (runs, bosses, scenarios, per-role
  // runs); a guildmate's is written as much as the addon reads of it (standings-format.mjs). An officer's file keeps every
  // guildmate's runs complete for the officer relay. Nothing known about this PC yet: everything complete, as before.
  const own = ownProfileMatcher([...ownNames, ...others,
    ...(self ? [...owners.entries()].filter(([, member]) => member === self).map(([character]) => character) : [])]);
  const officer = Array.isArray(body.officerInvites) || !!body.promotion;
  const text = standingsToLua(withRecordReceipts(body, await readRecord(config)), own ? { own, officer } : null) + linkedAsLua(config.discordAccount) + linkedMapLua(linked, body.updatedAt ?? new Date().toISOString());
  if (config.writeStandingsEnabled === false) return { notModified: false, etag, body, path, text: null, count: body.standings.length, unchanged: true, downloadedOnly: true, botVersion: body.botVersion, namesKey };
  // 9.3.0: Guilded Dungeons alone (no Guilded folder): it has no standings, only the run receipts. They go to its own
  // Accepted.lua, so it stops resending runs the bot holds and shows why one earned nothing.
  // (9.3.3) Reading and replacing the generated files is one job at a time with the companion's heartbeat (options.lock).
  return (options.lock ?? ((job) => job()))(async () => {
  const guildedFolder = dirname(path);
  if (!config.standingsFile && !existsSync(guildedFolder)) {
    const accepted = join(dirname(guildedFolder), "GuildedDungeons", "Accepted.lua");
    if (existsSync(dirname(accepted))) {
      const receipts = standaloneReceiptsToLua({ refs: Array.isArray(body.acceptedRunRefs) ? body.acceptedRunRefs : [], notes: body.runNotes && typeof body.runNotes === "object" ? body.runNotes : {}, cards: cleanRunCards(body.runCards) });
      let same = false;
      try { same = await readFile(accepted, "utf8") === receipts; } catch { /* first write */ }
      if (!same) {
        const temporary = `${accepted}.${process.pid}.tmp`;
        try { await writeFile(temporary, receipts, "utf8"); signal?.throwIfAborted(); await rename(temporary, accepted); }
        finally { await rm(temporary, { force: true }); }
      }
      return { notModified: false, etag, body, path: accepted, dataPath: null, text: receipts, count: body.standings.length, unchanged: same, refreshOnly: false, acceptedOnly: true, botVersion: body.botVersion, namesKey };
    }
  }
  let unchanged = false;
  let refreshOnly = false;
  try {
    const current = await readFile(path, "utf8");
    unchanged = withoutStamps(current) === withoutStamps(text);
    refreshOnly = !unchanged && withoutRefreshStamps(current) === withoutRefreshStamps(text);
  } catch { /* Missing file: restore it and report the repair. */ }
  signal?.throwIfAborted();
  if (!unchanged) {
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, text, "utf8"); signal?.throwIfAborted(); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  // The copy that survives addon updates (data-addon.mjs). Best effort: Guilded's own file above
  // is what older addons and setups rely on.
  let dataPath = null;
  if (config.dataAddon !== false) {
    try { dataPath = await writeDataAddon(path, text, body.updatedAt, signal); } catch { signal?.throwIfAborted(); dataPath = null; }
  }
  return { notModified: false, etag, body, path, dataPath, text, count: body.standings.length, unchanged, refreshOnly, botVersion: body.botVersion, namesKey };
  });
}

// True when the addon's Standings.lua still holds `text` (an addon update replaces it with the
// empty file it ships, and the bot would keep answering "not modified").
export async function standingsFileHolds(path, text) {
  try { return withoutStamps(await readFile(path, "utf8")) === withoutStamps(text); } catch { return false; }
}
