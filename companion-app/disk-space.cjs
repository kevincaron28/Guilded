"use strict";
// Free disk space before an update or an addon install (9.0). The update installer unpacks in
// %TEMP%, the installed app takes about 360 MB and the downloaded installer about 120 MB, so a
// drive with less than about 600 MB free fails partway. A second PC with 26 MB free on C: did.
// Checked on every drive involved (the install folder, %TEMP%, the companion's data folder and,
// for the addon, the WoW folder); the lowest one decides. Nothing starts when it is too low.

const path = require("node:path");
const fs = require("node:fs");

const DISK_SPACE_NEEDED_MB = 600;
const MB = 1024 * 1024;

/** The drive (or volume root) of a path, compared without case: "C:\\". */
function driveOf(target) {
  const text = String(target);
  const letter = /^([A-Za-z]):/.exec(text);
  if (letter) return `${letter[1].toUpperCase()}:\\`;
  const share = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(text);
  if (share) return `\\\\${share[1]}\\${share[2]}\\`.toUpperCase();
  return path.parse(path.resolve(text)).root;
}

/**
 * @param {{ paths: (string | null | undefined)[], statfs?: (target: string) => { bavail: number | bigint, bsize: number | bigint }, neededMb?: number }} input
 * @returns {{ ok: boolean, freeMb: number | null, neededMb: number, drive: string | null }}
 *   ok is false only when a drive was measured below neededMb. A drive that cannot be measured
 *   (missing folder, no statfs) never blocks: the update or install then reports its own error.
 */
function checkDiskSpace({ paths = [], statfs = fs.statfsSync, neededMb = DISK_SPACE_NEEDED_MB } = {}) {
  const seen = new Set();
  let lowest = null;
  for (const target of paths) {
    if (typeof target !== "string" || !target.trim()) continue;
    const drive = driveOf(target);
    if (seen.has(drive)) continue;
    seen.add(drive);
    let freeMb;
    try {
      const stats = statfs(existingAncestor(target));
      freeMb = Math.floor(Number(stats.bavail) * Number(stats.bsize) / MB);
    } catch { continue; }
    if (!Number.isFinite(freeMb) || freeMb < 0) continue;
    if (!lowest || freeMb < lowest.freeMb) lowest = { freeMb, drive };
  }
  return { ok: !lowest || lowest.freeMb >= neededMb, freeMb: lowest?.freeMb ?? null, neededMb, drive: lowest?.drive ?? null };
}

// statfs needs a folder that exists: walk up to the first one (at worst the drive root).
function existingAncestor(target) {
  // Windows paths are walked as Windows paths on any platform (the tests run on Linux too).
  const paths = /^([A-Za-z]:|[\\/]{2})/.test(target) ? path.win32 : path;
  let current = paths.resolve(target);
  for (let i = 0; i < 40 && !fs.existsSync(current); i++) {
    const parent = paths.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/** English key with {0} slots; the window and the log translate it. */
const LOW_DISK_MESSAGE = "Not enough disk space: {0} MB free, about {1} MB needed. Free space with Windows Settings > Storage, then retry.";

module.exports = { checkDiskSpace, driveOf, DISK_SPACE_NEEDED_MB, LOW_DISK_MESSAGE };
