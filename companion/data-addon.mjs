import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// A tiny second addon, Interface/AddOns/GuildedData, that holds the companion's standings.
//
// Guilded's own Standings.lua ships empty, so every addon update replaced the companion's data
// with nothing until the next write and /reload. This folder is not part of the Guilded
// download, so updates leave it alone. It loads after Guilded (Dependencies) and only replaces
// what Guilded's own Standings.lua set when it is at least as new, so a stale copy here never
// hides fresher data. Guilded still reads the same globals; guilds without a companion never
// have this folder.
export const DATA_ADDON = "GuildedData";

export function dataAddonToc(interfaceLine) {
  return [
    `## Interface: ${interfaceLine}`,
    "## Title: Guilded Data",
    "## Notes: Standings written by the Guilded companion. Safe to delete: the companion writes it again.",
    "## Dependencies: Guilded",
    "## X-Generated-By: Guilded companion",
    "",
    "Standings.lua",
    ""
  ].join("\n");
}

// The guard that keeps a stale copy from replacing newer data in Guilded's own Standings.lua.
export function guardedStandings(text, updatedAt) {
  const stamp = String(updatedAt ?? "").replace(/[^0-9A-Za-z:.-]/g, "");
  return [
    "-- Guilded companion data (GuildedData). Skipped when Guilded's own Standings.lua is newer.",
    `if type(GuildedStandings) == "table" and type(GuildedStandings.updatedAt) == "string" and GuildedStandings.updatedAt > "${stamp}" then return end`,
    text
  ].join("\n");
}

async function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, text, "utf8"); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

// `guildedStandingsPath` is Interface/AddOns/Guilded/Standings.lua. Returns the data file's
// path, or null when Guilded's TOC cannot be read (then only Guilded's own file is written).
export async function writeDataAddon(guildedStandingsPath, text, updatedAt) {
  const guildedFolder = dirname(guildedStandingsPath);
  let toc;
  try { toc = await readFile(join(guildedFolder, "Guilded.toc"), "utf8"); } catch { return null; }
  const interfaceLine = /^##\s*Interface:\s*([0-9 ,]+)\s*$/m.exec(toc)?.[1]?.trim();
  if (!interfaceLine) return null;
  const folder = join(dirname(guildedFolder), DATA_ADDON);
  await mkdir(folder, { recursive: true });
  const tocPath = join(folder, `${DATA_ADDON}.toc`);
  const wantedToc = dataAddonToc(interfaceLine);
  let currentToc = null;
  try { currentToc = await readFile(tocPath, "utf8"); } catch { /* first write */ }
  if (currentToc !== wantedToc) await writeAtomic(tocPath, wantedToc);
  const path = join(folder, "Standings.lua");
  const wanted = guardedStandings(text, updatedAt);
  let current = null;
  try { current = await readFile(path, "utf8"); } catch { /* first write */ }
  if (current !== wanted) await writeAtomic(path, wanted);
  return path;
}
