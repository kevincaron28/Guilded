// Offline preview and local-history archive. External awards never become Guilded GP/EP or live awards.
import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GAME_EDITIONS } from "./game-edition.mjs";

export const LOOT_IMPORT_LIMITS = Object.freeze({ bytes: 2_000_000, rows: 5000, field: 4096, columns: 64 });
const hash = value => createHash("sha256").update(value).digest("hex");
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
function text(value, label, required = false, max = LOOT_IMPORT_LIMITS.field) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > max || [...value].some(char => {
    const code = char.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  })) throw new Error(`Invalid ${label}.`);
  value = value.trim();
  if (required && !value) throw new Error(`Missing ${label}.`);
  return value;
}
function identity(value, label) {
  const result = text(value, label, true, 160);
  if (/[|\r\n\t]/u.test(result)) throw new Error(`Invalid ${label}.`);
  return result;
}
function sourceId(value) {
  if (value === undefined || value === null || value === "nil" || value === "") return "";
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) value = String(value);
  return text(value, "source award ID", true, 160);
}
function itemId(value, link) {
  if (value === undefined || value === null || value === "") value = /(?:^|\|H)item:(\d+)/u.exec(link ?? "")?.[1];
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new Error("Invalid item ID.");
  return value;
}
function calendar(value) {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/u.exec(value);
  if (!match) throw new Error("Use an unambiguous YYYY-MM-DD or YYYY/MM/DD date.");
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number(y) < 2004 || Number(y) > 2100 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error("Invalid award date.");
  return iso;
}
function epoch(value) {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1072915200 || value > 4133980799) throw new Error("Invalid award timestamp.");
  return { value: new Date(value * 1000).toISOString(), precision: "second", timezone: "UTC" };
}
function localTime(date, time) {
  const day = calendar(text(date, "award date", true, 10));
  const clock = text(time, "award time", false, 8);
  if (!clock) return { value: day, precision: "day", timezone: "unknown" };
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.test(clock)) throw new Error("Invalid award time.");
  return { value: `${day}T${clock}`, precision: clock.length === 8 ? "second" : "minute", timezone: "unknown" };
}

// Strict RFC-style CSV: handles quoted newlines, BOM and CRLF; never truncates.
function csv(input) {
  const rows = []; let row = [], field = "", quoted = false, closed = false;
  function pushField() {
    row.push(field); field = ""; closed = false;
    if (row.length > LOOT_IMPORT_LIMITS.columns) throw new Error("Too many CSV columns.");
  }
  function pushRow() {
    pushField();
    if (row.some(value => value !== "")) rows.push(row);
    row = [];
    if (rows.length > LOOT_IMPORT_LIMITS.rows + 1) throw new Error("Loot export exceeds 5,000 awards.");
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ",") pushField();
    else if (char === "\n" || char === "\r") { if (char === "\r" && input[i + 1] === "\n") i++; pushRow(); }
    else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting.");
      field += char;
    }
    if (field.length > LOOT_IMPORT_LIMITS.field) throw new Error("CSV field exceeds 4 KB.");
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (field || row.length || closed) pushRow();
  const header = rows.shift()?.map(key => key.trim());
  if (!header || new Set(header).size !== header.length || header.some(key => !key || ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid or duplicate CSV header.");
  return { header, rows: rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  }) };
}

export function parseLootHistory(input, source) {
  if (!["rclootcouncil", "gargul"].includes(source)) throw new Error("Choose rclootcouncil or gargul explicitly.");
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > LOOT_IMPORT_LIMITS.bytes) throw new Error("Loot export exceeds 2 MB.");
  const content = input.replace(/^\uFEFF/u, "").trim();
  let rows, format;
  if (content.startsWith("[")) {
    try { rows = JSON.parse(content); } catch { throw new Error("Invalid JSON export."); }
    format = "json";
  } else {
    const parsed = csv(content);
    const required = source === "rclootcouncil" ? ["player", "date", "time", "itemID"] : ["dateTime", "character", "itemID", "offspec", "id"];
    if (!required.every(key => parsed.header.includes(key))) throw new Error("Use RCLootCouncil CSV/JSON or Gargul JSON/TMB CSV with its header.");
    rows = parsed.rows; format = "csv";
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > LOOT_IMPORT_LIMITS.rows) throw new Error("Export must contain 1–5,000 awards.");
  const entries = rows.map((row, index) => {
    try {
      if (!plain(row)) throw new Error("Award must be an object.");
      const rc = source === "rclootcouncil", gargulJson = !rc && format === "json";
      const recipient = identity(rc ? row.player : gargulJson ? row.awardedTo : row.character, "source character");
      const id = sourceId(rc || !gargulJson ? row.id : row.checksum);
      const link = text(gargulJson ? row.itemLink : row.itemString, "item link");
      const at = gargulJson ? epoch(row.timestamp) : rc && row.servertime !== undefined ? epoch(row.servertime) : localTime(rc ? row.date : row.dateTime, rc ? row.time : "");
      const response = rc ? text(row.response, "response") : "";
      const offspec = rc ? null : gargulJson ? row.OS ?? false : row.offspec;
      if (!rc && ![true, false, 0, 1, "0", "1"].includes(offspec)) throw new Error("Invalid offspec flag.");
      return { row: index + (format === "csv" ? 2 : 1), sourceId: id, sourceCharacter: recipient,
        itemId: itemId(row.itemID, link), itemString: link, awardedAt: at, response,
        offspec: rc ? null : [true, 1, "1"].includes(offspec),
        instance: rc ? text(row.instance, "instance") : "", boss: rc ? text(row.boss, "boss") : "" };
    } catch (error) { throw new Error(`Award ${index + 1}: ${error.message}`, { cause: error }); }
  });
  return { source, format, sourceHash: hash(input), entries };
}

/**
 * Mapping keys are exact source names; values must be explicit Name-Realm identities.
 * @param {string} input
 * @param {{source?: unknown, guild?: unknown, realm?: unknown, edition?: unknown, characterMap?: Record<string, string>}} [options]
 */
export function previewLootHistory(input, { source, guild, realm, edition, characterMap = {} } = {}) {
  const scope = { guild: identity(guild, "destination guild"), realm: identity(realm, "destination realm"), edition };
  if (!GAME_EDITIONS.includes(edition)) throw new Error("Choose an explicit supported WoW edition.");
  if (!plain(characterMap)) throw new Error("Character mapping must be an object.");
  const parsed = parseLootHistory(input, source), seen = new Map(), fingerprints = new Map();
  const unmapped = new Set(), duplicateRows = [], ambiguousRows = [], entries = [];
  for (const entry of parsed.entries) {
    let character = null;
    if (Object.hasOwn(characterMap, entry.sourceCharacter)) {
      character = identity(characterMap[entry.sourceCharacter], "mapped character");
      if (!/^[^-\s]+-[^-]+$/u.test(character)) throw new Error("Map characters explicitly as Name-Realm; names are never stripped or guessed.");
    } else unmapped.add(entry.sourceCharacter);
    const identityData = [scope, source, entry.sourceCharacter, entry.sourceId];
    const key = entry.sourceId ? hash(JSON.stringify(identityData)) : null;
    const { row, sourceId: ignored, ...data } = entry; // Source row is provenance, not award content.
    void ignored;
    const fingerprint = hash(JSON.stringify(data));
    if (key && seen.has(key)) {
      if (seen.get(key) !== fingerprint) throw new Error(`Conflicting contents for source award ID at row ${row}.`);
      duplicateRows.push(row); continue;
    }
    if (key) seen.set(key, fingerprint);
    // Without a stable ID, identical rows could be two genuine awards. Retain and flag them.
    if (!key && fingerprints.has(fingerprint)) ambiguousRows.push(row);
    if (!key) fingerprints.set(fingerprint, row);
    entries.push({ ...entry, character, importKey: key, identityConfidence: key ? "source-id" : "needs-review" });
  }
  return { format: "guilded-loot-history-preview-v1", previewOnly: true, scope,
    provenance: { source, exportFormat: parsed.format, sourceHash: parsed.sourceHash },
    summary: { sourceRows: parsed.entries.length, previewRows: entries.length, duplicates: duplicateRows.length,
      unmappedCharacters: unmapped.size, missingSourceIds: entries.filter(entry => !entry.sourceId).length },
    unmappedCharacters: [...unmapped].sort(), duplicateRows, ambiguousRows, entries,
    warnings: ["Preview only: nothing is saved to the addon, uploaded, awarded or charged.",
      "Guild and edition are officer-selected; these exports do not prove guild membership or edition.",
      ...(entries.some(entry => entry.awardedAt.timezone === "unknown") ? ["Local source dates have no timezone; they are preserved without guessing UTC."] : []),
      ...(source === "gargul" && parsed.format === "csv" ? ["Gargul TMB CSV contains dates only and may substitute token item IDs. Prefer JSON for original item IDs and timestamps."] : [])] };
}

export async function readLootImportFile(file, limit = LOOT_IMPORT_LIMITS.bytes) {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const part = await handle.read(bytes, size, bytes.length - size, null); if (!part.bytesRead) break; size += part.bytesRead; }
    if (size > limit) throw new Error("Input file exceeds size limit.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}

// Backup.lua's bounded plain-data grammar, not executable Lua. Arrays are 1-based.
function encodeArchive(value) {
  if (typeof value === "string") return '"' + value.replace(/[\\"\n\r]/gu, char => char === "\n" ? "\\n" : char === "\r" ? "\\r" : "\\" + char) + '"';
  if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") return String(value);
  const entries = Array.isArray(value) ? value.map((item, index) => [`#${index + 1}`, item]) : Object.entries(value).map(([key, item]) => [encodeArchive(key), item]);
  return "{" + entries.map(([key, item]) => key + ":" + encodeArchive(item)).join(",") + "}";
}

/** Build only from the original export plus reviewed mapping, never a supplied preview object. */
export function createLootHistoryArchive(input, options, allowUnidentified = false) {
  const preview = previewLootHistory(input, options);
  if (preview.unmappedCharacters.length) throw new Error("Map every source character before saving an archive.");
  if (preview.summary.missingSourceIds && allowUnidentified !== true) throw new Error("Review and acknowledge awards without stable source IDs first.");
  const archive = { format: 1, ...preview.scope, source: preview.provenance.source, sourceHash: preview.provenance.sourceHash,
    allowUnidentified: allowUnidentified === true, entries: preview.entries.map(entry => ({
      row: entry.row, sourceId: entry.sourceId, sourceCharacter: entry.sourceCharacter, character: entry.character,
      itemId: entry.itemId, itemString: entry.itemString, at: entry.awardedAt.value, precision: entry.awardedAt.precision,
      timezone: entry.awardedAt.timezone, response: entry.response, offspec: entry.offspec === null ? "unknown" : entry.offspec,
      instance: entry.instance, boss: entry.boss
    })) };
  // Lua measures UTF-8 bytes, not JS UTF-16 code units.
  for (const value of [archive.guild, archive.realm]) if (Buffer.byteLength(value) > 120) throw new Error("Guild and realm must fit the addon's 120-byte limit.");
  for (const row of archive.entries) for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && Buffer.byteLength(value) > (["sourceId", "sourceCharacter", "character"].includes(key) ? 160 : 4096)) throw new Error("Award text exceeds the addon's byte limit.");
  }
  const bytes = Buffer.from(encodeArchive(archive));
  if (bytes.length > 290_000) throw new Error("Archive exceeds the in-game paste limit. Export a smaller date range.");
  let sum = 0; for (const byte of bytes) sum = (sum * 31 + byte) % 16777213;
  return { preview, code: `GLH1:${sum.toString(16).padStart(6, "0")}:${bytes.toString("base64")}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, mappingFile, output, ...extra] = process.argv.slice(2);
    if (!file || !mappingFile || !output || extra.some(flag => !["--archive", "--allow-unidentified"].includes(flag))) throw new Error("Usage: node companion/loot-history-import.mjs EXPORT MAPPING.json NEW-OUTPUT [--archive] [--allow-unidentified]");
    const input = await readLootImportFile(file);
    const mapping = JSON.parse(await readLootImportFile(mappingFile, 500_000));
    const preview = previewLootHistory(input, mapping);
    const archive = extra.includes("--archive");
    const result = archive ? createLootHistoryArchive(input, mapping, extra.includes("--allow-unidentified")).code : JSON.stringify(preview, null, 2);
    await writeFile(output, result + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ...preview.summary, previewOnly: !archive, output }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
