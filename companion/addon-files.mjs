import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readSavedText } from "./saved-file.mjs";
import { parseAddonExportDatabase, parseAddonExportText, readDatabase } from "./lua-export-content.mjs";
import { parkedGuildDatabases } from "./parked-runs.mjs";

// One PC can have Guilded, Guilded Dungeons (the standalone dungeon addon) or both (9.3.0). The guild upload and the
// zero-setup device upload read whichever saved files exist beside the chosen one:
//  - Guilded.lua only: exactly as before.
//  - GuildedDungeons.lua only: the runs, character, guild key and characters of this account from that file; there is no
//    roster, officer or guild data, so those parts of the export are empty (the same shape as a fresh full-Guilded save).
//  - both: Guilded's export, plus every run only the standalone addon recorded (for example while Guilded's dungeon module
//    was off), by run id; Guilded's copy of a run wins.

export const GUILDED_FILE = "Guilded.lua";
export const STANDALONE_FILE = "GuildedDungeons.lua";

/** The two saved files that sit beside `watchFile` (either of them may be the one chosen). */
export function savedFilePair(watchFile) {
  const folder = dirname(String(watchFile ?? ""));
  return { guilded: join(folder, GUILDED_FILE), standalone: join(folder, STANDALONE_FILE) };
}

/** True when `watchFile` is one of the two addon saved files (a .json file or any other name is read as it always was). */
export function isAddonSavedFile(watchFile) {
  const name = basename(String(watchFile ?? "")).toLowerCase();
  return name === GUILDED_FILE.toLowerCase() || name === STANDALONE_FILE.toLowerCase();
}

async function readIfPresent(path) {
  try { return { text: await readSavedText(path), at: (await stat(path)).mtimeMs }; }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

const hasStandaloneDatabase = (text) => typeof text === "string" && /(^|\n)\s*GuildedDungeonsDB\s*=/.test(text);
const hasGuildedDatabase = (text) => typeof text === "string" && /(^|\n)\s*GuildedDB\s*=/.test(text);

const compactKey = (key) => String(key ?? "").replace(/\s+/g, "").toLowerCase();

const baseName = (name) => String(name ?? "").split("-")[0].toLowerCase();
const entriesOf = (sdb) => Object.values(sdb.myCharacters ?? {}).filter((entry) => entry && typeof entry.name === "string" && entry.name);

/** name (lower case) -> guild key of each character of this account ("" = no guild). Old entries without the field take the file's key. */
function guildLookup(sdb) {
  const map = new Map();
  for (const entry of entriesOf(sdb)) map.set(baseName(entry.name), entry.guildKey ?? sdb.guildKey ?? "");
  if (sdb.character?.name && !map.has(baseName(sdb.character.name))) map.set(baseName(sdb.character.name), sdb.guildKey ?? "");
  return map;
}

/**
 * The guild one upload of this file belongs to: the key of the last character that logged in with a guild (the file's root key),
 * else the guild of the most recently seen character that has one (the last login was an unguilded alt). null when none is known.
 */
export function uploadGuild(sdb) {
  if (typeof sdb.guildKey === "string" && sdb.guildKey) return sdb.guildKey;
  let best = null;
  for (const entry of entriesOf(sdb)) {
    if (typeof entry.guildKey !== "string" || !entry.guildKey) continue;
    if (!best || Number(entry.capturedAt ?? 0) >= Number(best.capturedAt ?? 0)) best = entry;
  }
  return best ? best.guildKey : null;
}

/**
 * Does this run belong to `guild`? A run counts for the guild of a character of this account that was in it (the recorder first).
 * A run none of our characters played (copied from a guildmate over the guild channel) belongs to the guild the file's root key names.
 */
function runInGuild(run, sdb, lookup, guild) {
  const wanted = compactKey(guild);
  const names = [run?.recorder, ...Object.keys(run?.players ?? {})].map(baseName).filter((name) => lookup.has(name));
  if (names.length) return names.some((name) => compactKey(lookup.get(name)) === wanted);
  return compactKey(sdb.guildKey) === wanted;
}

function dungeonForGuild(sdb, guild) {
  const dungeon = sdb.dungeon ?? { runs: [] };
  if (!guild || !dungeon.runs || typeof dungeon.runs !== "object") return dungeon;
  const lookup = guildLookup(sdb);
  const list = Array.isArray(dungeon.runs) ? dungeon.runs : Object.values(dungeon.runs);
  const kept = {};
  for (const run of list) if (run && run.id !== undefined && runInGuild(run, sdb, lookup, guild)) kept[run.id] = run;
  return { ...dungeon, runs: kept };
}

/**
 * A GuildedDB-shaped table from a GuildedDungeonsDB, for parseAddonExportDatabase. `withGuild`: export the guild key and the
 * logged-in character (omitted when Guilded's own data decides them). `onlyGuild`: keep only the characters and the runs of that
 * guild (a PC whose account has characters in two guilds uploads one guild per file, never mixes them).
 */
export function standaloneAsGuildedDatabase(sdb, { withGuild = true, onlyGuild = null, savedAt = new Date(0) } = {}) {
  const lookup = guildLookup(sdb);
  const guild = onlyGuild || null;
  const seen = new Set();
  const characters = [];
  for (const entry of [sdb.character, ...entriesOf(sdb)]) {
    if (!entry || typeof entry.name !== "string" || !entry.name) continue;
    const id = entry.name.toLowerCase();
    if (seen.has(id)) continue;
    if (guild && compactKey(lookup.get(baseName(entry.name))) !== compactKey(guild)) continue;
    seen.add(id);
    characters.push({ ...entry, class: entry.class || sdb.character?.class });
  }
  let character = sdb.character;
  if (guild && character && compactKey(lookup.get(baseName(character.name))) !== compactKey(guild)) {
    character = characters.length ? { name: characters[0].name, realm: characters[0].realm, class: characters[0].class } : undefined;
  }
  return {
    ...(withGuild && guild ? { guildKey: guild } : {}),
    ...(withGuild && character ? { character } : {}),
    myCharacters: characters,
    dungeon: dungeonForGuild(sdb, guild),
    ...(sdb.displayNames ? { displayNames: sdb.displayNames } : {}),
    addonVersion: sdb.addonVersion ?? null,
    exports: { [savedAt.toISOString()]: true }
  };
}

/**
 * The export of one or both saved files' texts. Returns { full, source: "guilded" | "standalone" | "both", noGuildKey }.
 * `noGuildKey`: the data comes from Guilded Dungeons alone and that addon has not saved the guild yet (an addon older than
 * 9.3.0, or no login in a guild yet): the bot cannot find the Discord server from it.
 */
/**
 * `parked` (Guilded.lua only): the finished runs of guilds Guilded parked when another guild's character logged in, one export per guild
 * ({ key, full }); `full` holds that guild's runs and this account's characters in it, nothing else. `options.skip`: run ids already acknowledged.
 * @param {{ guilded?: string | null, standalone?: string | null, standaloneAt?: number }} files
 * @param {string} realm
 * @param {{ skip?: Set<string> }} [options]
 */
export function parseSavedFiles({ guilded = null, standalone = null, standaloneAt = 0 }, realm, options = {}) {
  const standaloneDb = hasStandaloneDatabase(standalone) ? readDatabase(standalone, "GuildedDungeonsDB") : null;
  const savedAt = new Date(standaloneAt || 0);
  if (hasGuildedDatabase(guilded) || !standaloneDb) {
    // No standalone data: the plain Guilded export (a missing GuildedDB throws the usual "was not found" error).
    const full = parseAddonExportText(guilded ?? "", realm);
    const parked = /otherGuilds/.test(guilded ?? "")
      ? parkedGuildDatabases(readDatabase(guilded, "GuildedDB"), { loadedKey: full.wowGuild, skip: options.skip }).map(({ key, database }) => ({ key, full: parseAddonExportDatabase(database, realm) }))
      : [];
    if (!standaloneDb) return { full, source: "guilded", noGuildKey: false, parked };
    // Only runs of the guild Guilded exports (and only characters saved for it); with no guild there, nothing is added.
    const extra = full.wowGuild
      ? parseAddonExportDatabase(standaloneAsGuildedDatabase(standaloneDb, { withGuild: false, onlyGuild: full.wowGuild, savedAt }), realm)
      : { dungeonRuns: [], alts: [] };
    const runs = new Map((full.dungeonRuns ?? []).map((run) => [run.id, run]));
    for (const run of extra.dungeonRuns ?? []) if (!runs.has(run.id)) runs.set(run.id, run);
    const known = new Set([full.character?.name, ...(full.alts ?? []).map((entry) => entry.name)].map((name) => String(name ?? "").toLowerCase()));
    const alts = [...(full.alts ?? []), ...(extra.alts ?? []).filter((entry) => !known.has(String(entry.name).toLowerCase()))];
    return { full: { ...full, dungeonRuns: [...runs.values()], ...(alts.length ? { alts } : {}) }, source: "both", noGuildKey: false, parked };
  }
  const full = parseAddonExportDatabase(standaloneAsGuildedDatabase(standaloneDb, { onlyGuild: uploadGuild(standaloneDb), savedAt }), realm);
  return { full, source: "standalone", noGuildKey: !full.wowGuild, parked: [] };
}

/** Reads and parses the saved file(s) beside `watchFile`; a plain Guilded.lua behaves as it always did. */
export async function readSavedExport(watchFile, realm, options = {}) {
  if (!isAddonSavedFile(watchFile)) return { full: parseAddonExportText(await readSavedText(watchFile), realm), source: "guilded", noGuildKey: false, parked: [] };
  const pair = savedFilePair(watchFile);
  const [guilded, standalone] = await Promise.all([readIfPresent(pair.guilded), readIfPresent(pair.standalone)]);
  if (!guilded && !standalone) {
    const error = new Error(`ENOENT: no such file or directory, open '${watchFile}'`);
    error.code = "ENOENT";
    throw error;
  }
  return parseSavedFiles({ guilded: guilded?.text ?? null, standalone: standalone?.text ?? null, standaloneAt: standalone?.at ?? 0 }, realm, options);
}

/** The saved-file paths worth watching and stamping: the chosen one first, then its neighbour from the other addon. */
export function watchedSavedFiles(watchFile) {
  if (!isAddonSavedFile(watchFile)) return [watchFile];
  const pair = savedFilePair(watchFile);
  const chosenIsGuilded = basename(watchFile).toLowerCase() === GUILDED_FILE.toLowerCase();
  return chosenIsGuilded ? [watchFile, pair.standalone] : [watchFile, pair.guilded];
}

/** What to tell the member when Guilded Dungeons alone has no guild saved yet (English; the app translates it). */
export const NO_GUILD_KEY_MESSAGE = "Guilded Dungeons has not saved your guild yet, so the bot cannot tell which Discord server your runs belong to. Update Guilded Dungeons to 9.3.0 or newer, log in to WoW once with it enabled, then type /reload.";

/**
 * Who this PC is, without building the whole export (the standings step runs often): { character, entries } where `entries`
 * are the logged-in character and every saved character of this account, from whichever saved files exist.
 */
export async function readSavedIdentity(watchFile) {
  const pair = isAddonSavedFile(watchFile) ? savedFilePair(watchFile) : { guilded: watchFile, standalone: null };
  const [guilded, standalone] = await Promise.all([readIfPresent(pair.guilded), pair.standalone ? readIfPresent(pair.standalone) : null]);
  if (!guilded && !standalone) { const error = new Error(`ENOENT: no such file or directory, open '${watchFile}'`); error.code = "ENOENT"; throw error; }
  const sources = [];
  if (guilded && hasGuildedDatabase(guilded.text)) sources.push(readDatabase(guilded.text, "GuildedDB"));
  if (standalone && hasStandaloneDatabase(standalone.text)) sources.push(readDatabase(standalone.text, "GuildedDungeonsDB"));
  if (!sources.length) readDatabase(guilded?.text ?? "", "GuildedDB"); // throws the usual "GuildedDB was not found" error
  const character = sources.find((database) => database.character?.name)?.character ?? null;
  const entries = sources.flatMap((database) => [database.character, ...(Array.isArray(database.alts) ? database.alts : []), ...Object.values(database.myCharacters ?? {})]);
  return { character, entries };
}
