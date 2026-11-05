import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { editionFromInterface } from "./game-edition.mjs";
import { savedFileParts } from "./live-folder.mjs";
import { isFolderOnHold } from "./active-editions.mjs";

// Wrong-edition install check. Each WoW edition has its own game folder and its own Guilded
// build (different ## Interface). The client silently skips an addon whose interface it does
// not accept, so a build for another edition in the folder (for example the TBC build in
// _forever_) never loads, never saves Guilded.lua, and nothing says why. Read the installed
// Guilded.toc next to the watched saved file and say so. Folders that do not name one edition
// (_classic_, _classic_beta_, the install folder itself) are not judged.
const FOLDER_EDITIONS = { _forever_: "forever", _classic_era_: "classic-era", _retail_: "retail" };

/** @param {string} toc @returns {string[]} editions the TOC claims to support */
export function tocEditions(toc) {
  const stated = /^##\s*X-Guilded-Edition:\s*(\S+)/m.exec(toc)?.[1];
  if (stated) return [stated];
  const list = /^##\s*Interface:\s*(.+)$/m.exec(toc)?.[1] ?? "";
  return [...new Set(list.split(",").map((part) => editionFromInterface(Number(part.trim()))).filter(Boolean))];
}

/**
 * @param {string} watchFile
 * @returns {Promise<{ status: "ok" | "wrong-edition" | "not-installed" | "unchecked" | "on-hold", expected?: string, installed?: string[], folder?: string }>}
 */
export async function checkInstalledAddon(watchFile) {
  const parts = savedFileParts(watchFile);
  // A game folder of an edition that is on hold (companion/active-editions.mjs) is not an error:
  // it is left alone and the app says plainly that support is paused.
  if (parts && isFolderOnHold(parts.flavor)) return { status: "on-hold", folder: parts.flavor };
  const expected = parts ? FOLDER_EDITIONS[parts.flavor.toLowerCase()] : undefined;
  if (!parts || !expected) return { status: "unchecked" };
  const folder = join(parts.root, parts.flavor, "Interface", "AddOns", "Guilded");
  let toc;
  try { toc = await readFile(join(folder, "Guilded.toc"), "utf8"); } catch { return { status: "not-installed", expected, folder }; }
  const installed = tocEditions(toc);
  return installed.includes(expected) ? { status: "ok", expected, installed, folder } : { status: "wrong-edition", expected, installed, folder };
}
