import { parseAddonExportText } from "./lua-export-content.mjs";
import { parsePoeRecord, consumePoeRecord, poeInstanceKey } from "./poe-events.mjs";

export async function readBrowserAddon(file, realm) {
  if (file.size > 16_000_000) throw new Error("Choose a Guilded.lua file smaller than 16 MB.");
  if (!/\.lua$/i.test(file.name)) throw new Error("Choose Guilded.lua from your account's SavedVariables folder.");
  return parseAddonExportText(await file.text(), realm);
}

const sha256 = async text => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");

// Manual browser import deliberately previews recent history, unlike the
// desktop watcher, which begins at EOF. Only completed transitions are sent.
export async function readBrowserPoe(file, profile, now = Date.now()) {
  for (const key of ["character", "league"]) {
    if (typeof profile[key] !== "string" || !profile[key].trim() || profile[key].length > 100 || /\p{Cc}/u.test(profile[key])) throw new Error("Enter your PoE2 character and league before selecting a log.");
  }
  if (!["STANDARD", "HARDCORE", "SSF", "SSF_HARDCORE"].includes(profile.mode)) throw new Error("Choose a valid PoE2 mode.");
  if (!/\.txt$/i.test(file.name)) throw new Error("Choose Client.txt from Path of Exile 2's logs folder.");
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff) || head.includes(0)) {
    throw new Error("PoE2 log encoding is unsupported (UTF-16 or binary). Select the game's original UTF-8 Client.txt.");
  }
  const offset = Math.max(0, file.size - 8_000_000);
  let text = await file.slice(offset).text();
  if (offset) text = text.slice(text.indexOf("\n") + 1);
  // As on desktop, an unfinished final line is not an observation yet.
  text = text.slice(0, text.lastIndexOf("\n") + 1);
  const journal = { active: /** @type {{ areaId: string } | null} */ (null), pending: /** @type {import('./poe-events.mjs').PoeVisit[]} */ ([]) };
  for (const line of text.split(/\r?\n/)) {
    if (new TextEncoder().encode(line).length > 8192 || line.includes("\u0000") || line.includes("\ufffd")) continue;
    const record = parsePoeRecord(line);
    if (!record) continue;
    if (Date.parse(record.at) < now - 86_400_000 || Date.parse(record.at) > now + 300_000) continue;
    if (record.kind === "area") record.fingerprint = await sha256(line);
    const runRef = record.kind === "area" ? await sha256(JSON.stringify([profile.character, profile.league, profile.mode, record.fingerprint])) : null;
    const instanceRef = record.kind === "area" ? await sha256(poeInstanceKey(record)) : null;
    consumePoeRecord(journal, record, profile, runRef, instanceRef);
    if (journal.pending.length >= 1000) throw new Error("This log has too many recent visits. Use the installed companion for continuous tracking.");
  }
  return { visits: journal.pending, currentArea: journal.active?.areaId ?? null, truncated: offset > 0 };
}
