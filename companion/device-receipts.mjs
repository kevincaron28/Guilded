import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStandingsPath } from "./standings.mjs";
import { writeDataAddon } from "./data-addon.mjs";

// Zero-setup companion (9.1.3): an unsigned device never fetches the guild standings, so nothing told the
// addon which of its dungeon runs the bot had received, and they stayed "waiting" for ever. The bot's answer
// to each unsigned upload now lists the run refs it holds (and why a run earned nothing); this file turns
// them into the same globals a signed-in companion writes to Standings.lua (GuildedDungeonAccepted and
// GuildedDungeonNotes), kept between uploads so a run is acknowledged for good, and says that this PC is
// not signed in, which ends an old "Linked to Discord as <name>" line left by an earlier signed-in companion.

const MAX_REFS = 1200;
const MAX_NOTES = 300;
const luaString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
const unquote = (text) => text.replace(/\\(["\\])/g, "$1");
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;

/** The refs and notes a file written by deviceReceiptsToLua holds (anything else in it is ignored). */
export function parseDeviceReceipts(text) {
  const refs = [];
  const notes = {};
  const block = (name) => new RegExp(String.raw`${name} = \{([\s\S]*?)\n\}`).exec(text)?.[1] ?? "";
  for (const match of block("GuildedDungeonAccepted").matchAll(new RegExp(String.raw`^\s*${QUOTED},\s*$`, "gm"))) refs.push(unquote(match[1]));
  for (const match of block("GuildedDungeonNotes").matchAll(new RegExp(String.raw`^\s*\[${QUOTED}\] = ${QUOTED},\s*$`, "gm"))) notes[unquote(match[1])] = unquote(match[2]);
  return { refs, notes };
}

/** Newest answer first; a ref stays acknowledged until the list is full. */
export function mergeDeviceReceipts(previous, answer) {
  const fresh = Array.isArray(answer?.acceptedRunRefs) ? answer.acceptedRunRefs.filter((ref) => typeof ref === "string" && ref) : [];
  const refs = [...new Set([...fresh, ...(previous?.refs ?? [])])].slice(0, MAX_REFS);
  const notes = { ...(previous?.notes ?? {}) };
  for (const ref of fresh) delete notes[ref]; // The bot's latest word on a run replaces an older note.
  for (const [ref, note] of Object.entries(answer?.runNotes && typeof answer.runNotes === "object" ? answer.runNotes : {})) if (typeof note === "string" && note) notes[ref] = note.slice(0, 80);
  return { refs, notes: Object.fromEntries(Object.entries(notes).filter(([ref]) => refs.includes(ref)).slice(0, MAX_NOTES)) };
}

export function deviceReceiptsToLua({ refs, notes }, updatedAt) {
  return [
    "-- Written by the Guilded companion for an unsigned (zero-setup) PC. Overwritten automatically; edits here are lost.",
    "-- This PC is not signed in with Discord, so any earlier \"Linked to Discord as ...\" line no longer applies.",
    "GuildedLinkedAs = nil",
    `GuildedCompanion = { mode = "device", updatedAt = ${luaString(updatedAt)} }`,
    "GuildedDungeonAccepted = {",
    ...refs.map((ref) => `  ${luaString(ref)},`),
    "}",
    "GuildedDungeonNotes = {",
    ...Object.entries(notes).map(([ref, note]) => `  [${luaString(ref)}] = ${luaString(note)},`),
    "}",
    ""
  ].join("\n");
}

async function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, text, "utf8"); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

/** The refs already acknowledged on this PC (read from the file the last answer wrote), so a run is never sent twice. */
export async function readDeviceReceipts(config) {
  const path = resolveStandingsPath(config);
  if (!path) return { refs: [], notes: {} };
  try { return parseDeviceReceipts(await readFile(path, "utf8")); } catch { /* No Guilded folder: the standalone addon's file below. */ }
  try {
    const text = await readFile(join(dirname(dirname(path)), "GuildedDungeons", "Accepted.lua"), "utf8");
    const list = /ipairs\(\{([^}]*)\}\)/.exec(text)?.[1] ?? "";
    return { refs: [...list.matchAll(new RegExp(QUOTED, "g"))].map((match) => unquote(match[1])), notes: {} };
  } catch { return { refs: [], notes: {} }; }
}

/**
 * Writes the acknowledgements for the addon: Guilded's Standings.lua, the GuildedData copy that survives addon
 * updates, and GuildedDungeons' Accepted.lua when that addon is installed. Returns the paths written.
 * `answer` may be null: that only clears a stale link line (the first start of an unsigned companion).
 */
export async function writeDeviceReceipts(config, answer, signal, now = new Date()) {
  const standings = resolveStandingsPath(config);
  if (!standings) return [];
  const merged = mergeDeviceReceipts(await readDeviceReceipts(config), answer);
  const stamp = now.toISOString();
  const text = deviceReceiptsToLua(merged, stamp);
  const written = [];
  const guilded = dirname(standings);
  if (existsSync(guilded)) {
    signal?.throwIfAborted();
    try {
      let current = null;
      try { current = await readFile(standings, "utf8"); } catch { /* first write */ }
      // Unchanged except for the stamp: leave the file alone (the game only reads it on reload anyway).
      const withoutStamp = (value) => value.replace(/updatedAt = "[^"]*"/, "");
      if (current === null || withoutStamp(current) !== withoutStamp(text)) await writeAtomic(standings, text);
      written.push(standings);
      if (config.dataAddon !== false) { try { const data = await writeDataAddon(standings, text, stamp, signal); if (data) written.push(data); } catch { signal?.throwIfAborted(); } }
    } catch { signal?.throwIfAborted(); }
  }
  const accepted = join(dirname(guilded), "GuildedDungeons", "Accepted.lua");
  if (existsSync(dirname(accepted))) {
    try {
      // Same shape the personal upload writes: it adds to the list GuildedDungeonAccepted already holds.
      await writeAtomic(accepted, `-- Written by the Guilded companion (unsigned).\nGuildedDungeonAccepted = GuildedDungeonAccepted or {}\nfor _, id in ipairs({ ${merged.refs.map(luaString).join(", ")} }) do table.insert(GuildedDungeonAccepted, id) end\n`);
      written.push(accepted);
    } catch { signal?.throwIfAborted(); }
  }
  return written;
}
