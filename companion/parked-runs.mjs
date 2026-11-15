import { readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { leaveOut } from "./group-relay.mjs";

// Dungeon runs of a PARKED guild (9.3.0). Full Guilded keeps one guild's data at the root of GuildedDB; when a character of another
// guild logs in, everything except the guild key moves into GuildedDB.otherGuilds[<guild key>] (addon Core.lua resolveGuildData).
// The export reads the root only, so the finished runs of the parked guild stayed invisible to the bot until a character of that
// guild logged in again. This module reads ONLY those runs (a parked table's character names for "who was in the run", and its
// dungeon.runs), tagged with their own guild key, and keeps the companion-side record of the ones the bot acknowledged.
// Nothing else of a parked guild is ever read here: no roster, officer, ledger, bank, board or map data.

const DAY = 86_400_000;
/** The addon prunes a synced run after 30 days and an unconfirmed guildmate copy after 45 (Dungeon.lua): the record keeps a ref no longer. */
export const RECORD_DAYS = 45;
export const RECORD_MAX = 1200;
const NOTE_MAX = 80;
const NOT_THIS_PC = "Not one of this PC's characters";

export const compactKey = (key) => String(key ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * The parked guilds of a parsed GuildedDB that hold finished runs the bot has not acknowledged: [{ key, database }] where `database`
 * is a minimal GuildedDB-shaped table (guild key, characters, dungeon runs) ready for parseAddonExportDatabase.
 * `skip`: run ids already acknowledged (the record and the addon's receipts). Runs older than RECORD_DAYS are not read: the addon never prunes a parked
 * table, and the record forgets an acknowledgement after that long, so an old run would otherwise be re-sent for ever. A key holding another edition ("edition@key") is ignored.
 */
export function parkedGuildDatabases(database, { loadedKey = "", skip = new Set(), nowMs = Date.now() } = {}) {
  const other = database?.otherGuilds;
  if (!other || typeof other !== "object") return [];
  const out = [];
  for (const [key, parked] of Object.entries(other)) {
    if (!key || key.includes("@") || !parked || typeof parked !== "object") continue;
    if (compactKey(key) === compactKey(loadedKey)) continue;
    const runs = {};
    for (const run of Object.values(parked.dungeon?.runs ?? {})) {
      if (!run || typeof run !== "object" || !run.id || run.synced === true || skip.has(String(run.id))) continue;
      const at = Number(run.endedAt || run.detectedAt || run.startedAt || 0);
      if (!(at > 0) || nowMs - at * 1000 > RECORD_DAYS * DAY) continue;
      runs[String(run.id)] = run;
    }
    if (!Object.keys(runs).length) continue;
    out.push({
      key,
      database: {
        guildKey: key,
        ...(parked.character ? { character: parked.character } : {}),
        myCharacters: parked.myCharacters ?? {},
        dungeon: { runs },
        ...(parked.displayNames ? { displayNames: parked.displayNames } : {}),
        addonVersion: parked.addonVersion ?? database.addonVersion ?? null
      }
    });
  }
  return out;
}

export const waitLine = (guild, count) => `${count} dungeon run${count === 1 ? "" : "s"} of ${guild} wait: log in on a character of that guild or link that server.`;

// ---------------------------------------------------------------------------------------------------------------------------
// The record: { version: 1, runs: { <run id>: { guild, ended, note? } }, servers: { <guildDiscordId>: [compact guild keys] } }.

export const emptyRecord = () => ({ version: 1, runs: {}, servers: {}, outcomes: {} });

export function parseRecord(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") return emptyRecord();
    return { version: 1, runs: value.runs && typeof value.runs === "object" ? value.runs : {}, servers: value.servers && typeof value.servers === "object" ? value.servers : {}, outcomes: value.outcomes && typeof value.outcomes === "object" ? value.outcomes : {} };
  } catch { return emptyRecord(); }
}

export function recordPathFor(config) {
  if (config?.parkedReceiptsFile) return config.parkedReceiptsFile;
  return config?.watchFile ? join(dirname(String(config.watchFile)), "GuildedCompanion-parked.json") : null;
}

export async function readRecord(config) {
  const path = recordPathFor(config);
  if (!path) return emptyRecord();
  try { return parseRecord(await readFile(path, "utf8")); } catch { return emptyRecord(); }
}

/**
 * Reads the record for a change that will be written back. A missing file is an empty record (nothing was saved yet). Any other failure is tried
 * once more after a short wait. The answer is { record } or { record: null, corrupt }: `corrupt` is true only when the text was read but is not a
 * record (it does not parse, or is not an object); a lock or permission error (EBUSY, EPERM, EACCES: antivirus, another program) and any other
 * read error are not corruption, so a caller never writes over, or moves aside, a record that may be perfectly good.
 */
export async function readRecordDetailed(config, { retryMs = 150 } = {}) {
  const path = recordPathFor(config);
  if (!path) return { record: emptyRecord() };
  let corrupt = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try { text = await readFile(path, "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") return { record: emptyRecord() };
      corrupt = false;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== "object") throw new Error("not a record");
      return { record: parseRecord(text) };
    } catch {
      corrupt = true;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  return { record: null, corrupt };
}

/** The record, or null when it could not be read (see readRecordDetailed). */
export async function readRecordStrict(config, options) {
  return (await readRecordDetailed(config, options)).record;
}

// What the member sees in the Activity list (English here; the French window translates them: companion-app/locales/fr.json, keep in step).
export const RECORD_SKIPPED = "The parked-guild run record could not be read; it is left as it is and this change is skipped.";
export const RECORD_NOT_SAVED = "The parked-guild run record could not be saved; this change is lost until the next sync.";
export const RECORD_MOVED = "Problem: the saved list of runs waiting for other guilds was damaged. It was kept as a .bad file next to it and a new list was started; some runs of other guilds may be sent again.";
export const RECORD_STUCK = "Problem: the saved list of runs waiting for other guilds is damaged and could not be moved aside. Those runs are not sent until it is fixed.";

const KEEP_BAD = 3;
/** Moves the record aside as a timestamped .bad copy and keeps the last few. True when the record is out of the way. */
async function moveAside(path) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
  if (!(await rename(path, `${path}.${stamp}.bad`).then(() => true, () => false))) return false;
  try {
    const folder = dirname(path);
    const prefix = `${path.slice(folder.length + 1)}.`;
    // Exactly the names made above (<record file>.<YYYYMMDD-HHMMSSmmm>.bad): nothing else in the folder is ever removed.
    const copies = (await readdir(folder)).filter((name) => name.startsWith(prefix) && /^\d{8}-\d{9}\.bad$/.test(name.slice(prefix.length))).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - KEEP_BAD))) await rm(join(folder, old), { force: true });
  } catch { /* the copies are only kept tidy */ }
  return true;
}

/**
 * One change at a time to the record: each change is applied to the record read just before it, so a slower writer never puts back an older
 * copy. `change(record)` returns the new record, or null to leave the file as it is. A record that cannot be read is left alone (one log line),
 * and a failed write is logged. Resolves to what was written, or null. Only a record that is read but damaged (not a lock) counts toward
 * `unreadableLimit`: after that many in a row it is moved aside and a new one is started.
 */
const noLog = (level, message) => { void level; void message; };
/** After this many damaged reads in a row the record is moved aside and a new one is started. */
export const UNREADABLE_LIMIT = 3;
/** The "moved aside" warning stays visible at least this long (a fresh record that read well a moment later must not hide it before the member sees it). */
export const MOVED_VISIBLE_MS = 15 * 60 * 1000;
/** What the engine keeps in its state for the Problems panel, from an updater status. */
export const parkedRecordState = (status) => (status === "moved" || status === "stuck" ? { moved: status === "moved", stuck: status === "stuck" } : null);
export function createRecordUpdater({ onLog = noLog, onStatus = (status) => { void status; }, retryMs = 150, unreadableLimit = UNREADABLE_LIMIT, moveRecordAside = moveAside, clock = Date.now, movedVisibleMs = MOVED_VISIBLE_MS } = {}) {
  let tail = Promise.resolve();
  let damaged = 0;
  // The member-visible problem (the Problems panel): "moved" or "stuck" until a later change finds a good record; null when there is none.
  let problem = null;
  let problemAt = 0;
  const setProblem = (next) => { if (next !== problem) { problem = next; problemAt = clock(); onStatus(next); } };
  return (config, change) => {
    const run = tail.then(async () => {
      const read = await readRecordDetailed(config, { retryMs });
      let record = read.record;
      if (!record) {
        if (!read.corrupt) { onLog("warn", RECORD_SKIPPED); return null; }
        damaged += 1;
        if (damaged < unreadableLimit) { onLog("warn", RECORD_SKIPPED); return null; }
        // Damaged several times in a row: the file is moved aside (kept as a .bad copy) and a fresh record is started, so the runs of other guilds are not stuck for good.
        const path = recordPathFor(config);
        if (!path || !(await moveRecordAside(path))) { onLog("error", RECORD_STUCK); setProblem("stuck"); return null; }
        onLog("error", RECORD_MOVED);
        setProblem("moved");
        record = emptyRecord();
        damaged = 0;
      } else {
        damaged = 0;
        // A good record on a later change: the fresh record works, so the problem is over. A "moved" warning is kept for a while first: when the
        // fresh record could not be written there is no file, which reads as good at the next change, within seconds.
        if (problem === "stuck" || problem === "moved" && clock() - problemAt >= movedVisibleMs) setProblem(null);
      }
      const next = await change(record);
      if (!next) return null;
      if (!(await writeRecord(config, next))) { onLog("warn", RECORD_NOT_SAVED); return null; }
      return next;
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

export async function writeRecord(config, record) {
  const path = recordPathFor(config);
  if (!path) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, JSON.stringify(record), "utf8"); await rename(temporary, path); return true; }
  catch { return false; }
  finally { await rm(temporary, { force: true }); }
}

/** Drops what the addon no longer holds (older than RECORD_DAYS by the run's end) and keeps the newest RECORD_MAX. */
export function pruneRecord(record, nowMs = Date.now()) {
  const entries = Object.entries(record.runs).filter(([, entry]) => entry && typeof entry === "object" && nowMs - Number(entry.ended ?? 0) * 1000 <= RECORD_DAYS * DAY);
  entries.sort((a, b) => Number(b[1].ended ?? 0) - Number(a[1].ended ?? 0));
  return { ...record, runs: Object.fromEntries(entries.slice(0, RECORD_MAX)) };
}

/**
 * Adds what the bot acknowledged for `guild`'s runs. `sent`: the runs of that upload ({ id, endedAt }); `acceptedRefs`/`notes`: the bot's answer.
 * Returns { record, added }. A ref the bot refused for this PC is not a receipt.
 */
export function recordAcknowledged(record, guild, sent, acceptedRefs, notes = {}, nowMs = Date.now()) {
  const held = new Set(Array.isArray(acceptedRefs) ? acceptedRefs.filter((ref) => typeof ref === "string") : []);
  const next = { ...record, runs: { ...record.runs } };
  let added = 0;
  for (const run of Array.isArray(sent) ? sent : []) {
    const id = typeof run === "string" ? run : run?.id;
    if (typeof id !== "string" || !held.has(id)) continue;
    const note = typeof notes?.[id] === "string" ? notes[id].slice(0, NOTE_MAX) : "";
    if (note === NOT_THIS_PC) continue;
    if (!next.runs[id]) added++;
    next.runs[id] = { guild, ended: Number(run?.endedAt) || Math.floor(nowMs / 1000), ...(note ? { note } : {}) };
  }
  return { record: pruneRecord(next, nowMs), added };
}

export const rememberServer = (record, guildDiscordId, guildKey) => {
  const id = String(guildDiscordId ?? "");
  if (!id || !guildKey) return record;
  const list = Array.isArray(record.servers[id]) ? record.servers[id] : [];
  const key = compactKey(guildKey);
  return list.includes(key) ? record : { ...record, servers: { ...record.servers, [id]: [...list, key].slice(-8) } };
};
export const forgetServer = (record, guildDiscordId, guildKey) => {
  const id = String(guildDiscordId ?? "");
  const list = Array.isArray(record.servers[id]) ? record.servers[id] : [];
  return list.includes(compactKey(guildKey)) ? { ...record, servers: { ...record.servers, [id]: list.filter((key) => key !== compactKey(guildKey)) } } : record;
};
/** Is `guildKey` a guild this signed-in profile's server is known to hold (the profile's own guild, or one an earlier upload showed it knows)? */
export function serverHoldsGuild(config, record, guildKey) {
  const key = compactKey(guildKey);
  if (config?.wowGuild && compactKey(config.wowGuild) === key) return true;
  const list = record?.servers?.[String(config?.guildDiscordId ?? "")];
  return Array.isArray(list) && list.includes(key);
}

/** The accepted refs and notes the record adds to every receipts file the companion writes. */
export function recordReceipts(record) {
  const refs = Object.keys(record?.runs ?? {});
  const notes = Object.fromEntries(Object.entries(record?.runs ?? {}).flatMap(([id, entry]) => (entry?.note ? [[id, entry.note]] : [])));
  return { refs, notes };
}

/** `body` with the record's refs and notes added (the bot's own answer wins), for the receipts a standings write carries. */
export function withRecordReceipts(body, record) {
  const extra = recordReceipts(record);
  if (!extra.refs.length) return body;
  const refs = [...new Set([...(Array.isArray(body?.acceptedRunRefs) ? body.acceptedRunRefs : []), ...extra.refs])].slice(0, RECORD_MAX);
  return { ...body, acceptedRunRefs: refs, runNotes: { ...extra.notes, ...(body?.runNotes && typeof body.runNotes === "object" ? body.runNotes : {}) } };
}

const luaString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An existing Standings.lua text with the record's refs and notes added to its GuildedDungeonAccepted and GuildedDungeonNotes blocks. */
export function patchReceiptBlocks(text, record) {
  const extra = recordReceipts(record);
  if (!extra.refs.length || typeof text !== "string") return text;
  const block = (name) => new RegExp(String.raw`(${name} = \{)([\s\S]*?)(\n\})`);
  let out = text;
  const accepted = block("GuildedDungeonAccepted").exec(out);
  if (!accepted) return text;
  const have = new Set([...accepted[2].matchAll(/^\s*"((?:[^"\\]|\\.)*)",\s*$/gm)].map((m) => m[1].replace(/\\(["\\])/g, "$1")));
  const add = extra.refs.filter((ref) => !have.has(ref));
  if (add.length) out = out.replace(block("GuildedDungeonAccepted"), (_, open, body, close) => `${open}${body}${add.map((ref) => `\n  ${luaString(ref)},`).join("")}${close}`);
  const noteLines = Object.entries(extra.notes).filter(([ref]) => !new RegExp(String.raw`\[${escapeRegExp(luaString(ref))}\]`).test(out));
  if (noteLines.length) out = out.replace(block("GuildedDungeonNotes"), (_, open, body, close) => `${open}${body}${noteLines.map(([ref, note]) => `\n  [${luaString(ref)}] = ${luaString(note)},`).join("")}${close}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Pacing (9.3.1). A parked guild is one more request per sync and the bot limits a device's uploads per hour, so: at most
// MAX_PER_SYNC guilds per sync (the least recently tried first, so every guild gets its turn), a guild whose last answer was a dead end for
// this run set (no server, several servers to choose from, nobody to vouch, not confirmed) is not asked again for RETRY_MS, and the whole
// loop stops on a 429. The loaded guild's upload always goes first. The outcomes live in the record, so a restart does not start over.

export const MAX_PER_SYNC = 3;
export const RETRY_MS = 3_600_000;
const OUTCOME_DAYS = 7;

/** A short fingerprint of a run set: a guild is asked again at once when it holds a run it was not asked about. */
export function runSetOf(ids) {
  let hash = 5381;
  for (const id of [...ids].map(String).sort()) for (let i = 0; i < id.length; i++) hash = ((hash * 33) ^ id.charCodeAt(i)) >>> 0;
  return `${ids.length}:${hash.toString(36)}`;
}

/** The parked guilds to try this sync: not waiting out a dead end for the same run set, least recently tried first, at most `max`. */
export function chooseParked(record, candidates, nowMs = Date.now(), max = MAX_PER_SYNC) {
  const outcomes = record?.outcomes ?? {};
  return candidates
    .filter((entry) => {
      const last = outcomes[compactKey(entry.key)];
      return !(last && last.kind !== "ok" && last.runSet === runSetOf(entry.ids) && nowMs - Number(last.at ?? 0) < RETRY_MS);
    })
    .sort((a, b) => Number(outcomes[compactKey(a.key)]?.at ?? 0) - Number(outcomes[compactKey(b.key)]?.at ?? 0))
    .slice(0, max);
}

/** Remembers how the last request for a guild's run set ended: "ok", "no-guild", "choose", "unvouched", "unconfirmed" or "error". */
export function noteOutcome(record, guildKey, ids, kind, nowMs = Date.now()) {
  const outcomes = { ...(record.outcomes ?? {}), [compactKey(guildKey)]: { kind, at: nowMs, runSet: runSetOf(ids) } };
  const kept = Object.entries(outcomes).filter(([, entry]) => nowMs - Number(entry?.at ?? 0) <= OUTCOME_DAYS * 86_400_000).sort((a, b) => Number(b[1].at) - Number(a[1].at)).slice(0, 50);
  return { ...record, outcomes: Object.fromEntries(kept) };
}

/** The purpose-built body of a signed parked upload: the guild, this account's characters in it and the runs, nothing else (no empty sections). */
export function minimalParkedExport(full, { groupRelay = false } = {}) {
  const out = {};
  for (const field of ["gameEdition", "interface", "source", "exportedAt", "addonVersion", "wowGuild", "character", "alts", "dungeonRuns"]) {
    // (9.3.1) The same gate as every other upload: runs carried for players near this PC go only to a bot that announced the feature.
    const value = field === "dungeonRuns" && Array.isArray(full?.[field]) ? full[field].filter((run) => !leaveOut(run, { enabled: groupRelay, acknowledged: new Set() })) : full?.[field];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
    out[field] = value;
  }
  return out;
}
