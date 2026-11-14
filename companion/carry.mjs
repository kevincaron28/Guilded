import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStandingsPath } from "./standings.mjs";

// (9.3.2) Records an addon carries for players near it (docs/plans/ADDON_ONLY_REACH_2026-11-14.md). The addon keeps the records a
// player made until a carrier is heard (kind, key, author, data in <DB>.carry.records); this companion sends them to a bot that
// says it handles them (feature "carry-records") and writes the bot's receipts (the keys it dealt with) to Carry.lua, a file only
// this module writes, so a signed standings file, a device receipts file and a personal Accepted.lua never have to merge them.

import { CARRY_RECEIPT_PREFIX } from "./carry-content.mjs";
export { CARRY_FEATURE, CARRY_RECEIPT_PREFIX, MAX_CARRIED, carryId, exportCarriedRecords } from "./carry-content.mjs";
const MAX_RECEIPTS = 1200;

const luaString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
const unquote = (text) => text.replace(/\\(["\\])/g, "$1");

/** The ids in a Carry.lua this module wrote (anything else is ignored). */
export function parseCarryReceipts(text) {
  const block = /GuildedCarryReceipts = \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
  return [...block.matchAll(new RegExp(String.raw`^\s*${QUOTED},\s*$`, "gm"))].map((match) => unquote(match[1]));
}

export function carryReceiptsToLua(ids, updatedAt = "") {
  return [
    "-- Written by the Guilded companion: records the bot holds, so the addon stops carrying them. Overwritten automatically; edits here are lost.",
    `-- updated ${updatedAt}`,
    "GuildedCarryReceipts = {",
    ...ids.slice(0, MAX_RECEIPTS).map((id) => `  ${luaString(id)},`),
    "}",
    ""
  ].join("\n");
}

/** The receipt refs a bot answer lists, as record ids (the bot prefixes them so they never look like run receipts). */
export function receiptIdsOf(answer) {
  const list = Array.isArray(answer?.carriedReceipts) ? answer.carriedReceipts : [];
  return list.filter((ref) => typeof ref === "string" && ref.startsWith(CARRY_RECEIPT_PREFIX)).map((ref) => ref.slice(CARRY_RECEIPT_PREFIX.length)).filter((id) => id.length <= 160);
}

const carryPaths = (config) => {
  const standings = resolveStandingsPath(config);
  if (!standings) return [];
  const guilded = dirname(standings);
  return [join(guilded, "Carry.lua"), join(dirname(guilded), "GuildedDungeons", "Carry.lua")].filter((path) => existsSync(dirname(path)));
};

async function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, text, "utf8"); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

/** The ids already acknowledged on this PC (so a record is never sent again while the addon still lists it). */
export async function readCarryReceipts(config) {
  const seen = new Set();
  for (const path of carryPaths(config)) { try { for (const id of parseCarryReceipts(await readFile(path, "utf8"))) seen.add(id); } catch { /* not written yet */ } }
  return seen;
}

/** Adds the ids of an answer to every Carry.lua beside an installed addon. Returns the paths written. */
export async function writeCarryReceipts(config, answer, signal, now = new Date()) {
  const fresh = receiptIdsOf(answer);
  if (!fresh.length) return [];
  const written = [];
  for (const path of carryPaths(config)) {
    signal?.throwIfAborted();
    let previous = [];
    try { previous = parseCarryReceipts(await readFile(path, "utf8")); } catch { /* first write */ }
    const ids = [...new Set([...fresh, ...previous])].slice(0, MAX_RECEIPTS);
    if (ids.length === previous.length && ids.every((id, index) => id === previous[index])) continue;
    try { await writeAtomic(path, carryReceiptsToLua(ids, now.toISOString())); written.push(path); } catch { signal?.throwIfAborted(); }
  }
  return written;
}
