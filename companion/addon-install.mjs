import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { editionFromInterface } from "./game-edition.mjs";
import { savedFileParts } from "./live-folder.mjs";
import { isOtherEditionFolder } from "./wow-folder.mjs";

// Wrong-edition install check. Guilded supports WoW Forever only. The client silently skips an
// addon whose interface it does not accept, so an old build for another WoW version in _forever_
// never loads, never saves Guilded.lua, and nothing says why. Read the installed Guilded.toc next
// to the watched saved file and say so. Folders that do not name an edition (_classic_,
// _classic_beta_, the install folder itself) are not judged.
const FOLDER_EDITIONS = { _forever_: "forever" };

/** @param {string} toc @returns {string[]} editions the TOC claims to support */
export function tocEditions(toc) {
  const stated = /^##\s*X-Guilded-Edition:\s*(\S+)/m.exec(toc)?.[1];
  if (stated) return [stated];
  const list = /^##\s*Interface:\s*(.+)$/m.exec(toc)?.[1] ?? "";
  return [...new Set(list.split(",").map((part) => editionFromInterface(Number(part.trim()))).filter(Boolean))];
}

/**
 * @param {string} watchFile
 * @returns {Promise<{ status: "ok" | "wrong-edition" | "not-installed" | "unchecked" | "other-edition", expected?: string, installed?: string[], folder?: string }>}
 */
export async function checkInstalledAddon(watchFile) {
  const parts = savedFileParts(watchFile);
  // A game folder of another WoW version is not an error: it is left alone (Guilded supports WoW Forever only).
  if (parts && isOtherEditionFolder(parts.flavor)) return { status: "other-edition", folder: parts.flavor };
  const expected = parts ? FOLDER_EDITIONS[parts.flavor.toLowerCase()] : undefined;
  if (!parts || !expected) return { status: "unchecked" };
  const folder = join(parts.root, parts.flavor, "Interface", "AddOns", "Guilded");
  // (9.1.3) Other Guilded addons installed beside Guilded (GuildedDungeons): the companion updates them with it.
  const extras = [];
  for (const name of ["GuildedDungeons"]) {
    try {
      const text = await readFile(join(parts.root, parts.flavor, "Interface", "AddOns", name, name + ".toc"), "utf8");
      extras.push({ name, version: /^##\s*Version:\s*(\d{1,3}\.\d{1,3}\.\d{1,3})\s*$/m.exec(text)?.[1] ?? null });
    } catch { /* not installed */ }
  }
  let toc;
  try { toc = await readFile(join(folder, "Guilded.toc"), "utf8"); } catch { return { status: "not-installed", expected, folder, extras }; }
  const installed = tocEditions(toc);
  // The version on disk: newer than the one that last saved means WoW still runs the old files.
  const version = /^##\s*Version:\s*(\d{1,3}\.\d{1,3}\.\d{1,3})\s*$/m.exec(toc)?.[1] ?? null;
  return installed.includes(expected) ? { status: "ok", expected, installed, folder, version, extras } : { status: "wrong-edition", expected, installed, folder, version, extras };
}
