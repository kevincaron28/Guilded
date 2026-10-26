// Offline GRM -> Guilded archive conversion. Parses literal SavedVariables data;
// never executes Lua, links Discord identities, calls the game, or uploads notes.
import luaparse from "luaparse";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GAME_EDITIONS } from "./game-edition.mjs";

const VARIABLES = ["GRM_GuildMemberHistory_Save", "GRM_PlayersThatLeftHistory_Save", "GRM_LogReport_Save", "GRM_Alts"];
const FIELDS = new Set(["name", "rankName", "rankIndex", "class", "race", "level", "GUID", "joinDateHist", "rankHist", "altGroup", "main", "mainName", "isMain", "nickname", "professions", "note", "officerNote", "customNote"]);
const PRIVATE = new Set(["officerNote", "customNote"]);
const MAX_CODE = 2_000_000;
export function parseGRM(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16_000_000) throw new Error("GRM file exceeds 16 MB.");
  const ast = luaparse.parse(Buffer.from(text.replace(/^\uFEFF/, ""), "utf8").toString("latin1"), { encodingMode: "pseudo-latin1" });
  let nodes = 0;
  function value(node, depth = 0) {
    if (++nodes > 300_000 || depth > 20) throw new Error("GRM data exceeds structural limits.");
    if (!node) throw new Error("Missing literal.");
    if (node.type === "StringLiteral") {
      // luaparse's byte-oriented mode preserves WoW's UTF-8 and decimal escapes.
      const result = Buffer.from(node.value, "latin1").toString("utf8");
      if (Buffer.byteLength(result) > 16_000) throw new Error("GRM string exceeds 16 KB.");
      return result;
    }
    if (node.type === "NumericLiteral" && Number.isFinite(node.value)) return node.value;
    if (node.type === "BooleanLiteral") return node.value;
    if (node.type === "NilLiteral") return null;
    if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") return -node.argument.value;
    if (node.type !== "TableConstructorExpression") throw new Error("Only literal GRM data is accepted.");
    const result = Object.create(null), keys = new Set(); let index = 1;
    for (const field of node.fields) {
      const key = field.type === "TableValue" ? index++ : field.type === "TableKeyString" ? field.key.name : value(field.key, depth + 1);
      if (!["string", "number"].includes(typeof key) || typeof key === "number" && !Number.isSafeInteger(key)
        || ["__proto__", "constructor", "prototype"].includes(String(key)) || keys.has(String(key))) throw new Error("Invalid or duplicate GRM key.");
      keys.add(String(key));
      const item = value(field.value, depth + 1);
      if (item !== null) result[key] = item; // Lua nil removes a table entry.
    }
    return result;
  }
  const result = Object.create(null);
  for (const statement of ast.body) {
    if (statement.type !== "AssignmentStatement" || statement.variables.length !== 1 || statement.init.length !== 1 || statement.variables[0].type !== "Identifier") throw new Error("Only SavedVariables assignments are accepted.");
    const name = statement.variables[0].name;
    if (VARIABLES.includes(name)) {
      if (Object.hasOwn(result, name)) throw new Error("Duplicate GRM assignment.");
      result[name] = value(statement.init[0]);
    }
  }
  return result;
}
const count = object => object && typeof object === "object" ? Object.keys(object).length : 0;
const cleanIdentity = value => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160 && ![...value].some(char => char.charCodeAt(0) < 32 || char === "|");
export function buildGRMArchive(source, { guildKey, guild, realm, edition, includePrivate = false }, sourceHash = "") {
  if (!GAME_EDITIONS.includes(edition) || ![guildKey, guild, realm].every(cleanIdentity)) throw new Error("Explicit guild, realm and edition are required.");
  const expected = `${guild}-${realm.replace(/[\s-]/g, "")}`;
  if (guildKey !== expected) throw new Error("GRM source guild key does not match the requested guild and realm.");
  const current = source.GRM_GuildMemberHistory_Save?.[guildKey];
  if (!current || typeof current !== "object") throw new Error("Selected GRM guild is missing.");
  for (const variable of VARIABLES) {
    const root = source[variable];
    if (root != null && (typeof root !== "object" || Array.isArray(root))) throw new Error("Selected GRM guild data must use tables.");
    const selected = source[variable]?.[guildKey];
    if (selected !== undefined && (selected === null || typeof selected !== "object" || Array.isArray(selected))) throw new Error("Selected GRM guild data must use tables.");
  }
  const archive = { format: 1, guild, realm, edition, sourceGuild: guildKey, sourceHash, importedAt: new Date().toISOString(), private: includePrivate,
    members: Object.create(null), former: Object.create(null), groups: Object.create(null), logs: includePrivate ? source.GRM_LogReport_Save?.[guildKey] ?? {} : {}, omittedFields: 0, omittedLogs: includePrivate ? 0 : count(source.GRM_LogReport_Save?.[guildKey]) };
  const copyField = value => {
    if (!value || typeof value !== "object") return value;
    const copy = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (!includePrivate && PRIVATE.has(key)) archive.omittedFields++;
      else copy[key] = copyField(item);
    }
    return copy;
  };
  archive.groups = copyField(source.GRM_Alts?.[guildKey] ?? {});
  for (const [name, rows] of [["members", current], ["former", source.GRM_PlayersThatLeftHistory_Save?.[guildKey] ?? {}]]) {
    if (count(rows) > 2000) throw new Error("GRM member archive exceeds 2,000 records per category.");
    for (const [key, row] of Object.entries(rows)) {
      // GRM stores guild-level metadata alongside player records; do not import
      // it as a character. Unknown fields are counted rather than reinterpreted.
      if (!row || typeof row !== "object" || !cleanIdentity(row.name)) continue;
      if (!cleanIdentity(key) || key !== row.name) throw new Error("GRM character key/name mismatch.");
      const copy = Object.create(null);
      for (const [field, item] of Object.entries(row)) {
        if (FIELDS.has(field) && (includePrivate || !PRIVATE.has(field))) copy[field] = copyField(item);
        else archive.omittedFields++;
      }
      archive[name][key] = copy;
    }
  }
  if (!count(archive.members) || count(archive.logs) > 10000 || count(archive.groups) > 2000) throw new Error("Empty or oversized GRM archive.");
  return archive;
}
// Match GRMMigration.lua before reporting a successful conversion. The source
// parser has larger limits because the selected guild is only part of the file.
export function validateGRMArchive(archive) {
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const validString = (value, limit) => typeof value === "string" && Buffer.byteLength(value) <= limit
    && ![...value].some(char => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)));
  const fail = () => { throw new Error("Archive data exceeds the addon's supported structure or limits."); };
  if (!record(archive) || archive.format !== 1 || typeof archive.private !== "boolean") fail();
  for (const key of ["guild", "realm", "edition", "sourceGuild", "sourceHash", "importedAt"]) if (!validString(archive[key], 200) || !archive[key]) fail();
  if (!/^[a-f0-9]{64}$/.test(archive.sourceHash)) fail();
  for (const key of ["members", "former", "groups", "logs"]) if (!record(archive[key]) || count(archive[key]) > (key === "logs" ? 10000 : 2000)) fail();
  if (!count(archive.members) || !archive.private && count(archive.logs)) fail();
  for (const list of [archive.members, archive.former]) for (const [key, row] of Object.entries(list)) {
    if (!record(row) || !validString(row.name, 160) || row.name !== key) fail();
  }
  let nodes = 0;
  function walk(value, depth) {
    if (++nodes > 150000 || depth > 18) fail();
    if (typeof value === "string") { if (!validString(value, 16000)) fail(); return; }
    if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) >= 1e15) fail(); return; }
    if (typeof value === "boolean") return;
    if (!record(value)) fail();
    for (const [key, item] of Object.entries(value)) {
      if (item === null) continue; // Nil source entries are absent from the encoded archive.
      if (!validString(key, 200) || !archive.private && PRIVATE.has(key)) fail();
      walk(item, depth + 1);
    }
  }
  walk(archive, 0);
}
// Compatible with Backup.lua's plain-data parser. This is not executable Lua.
function encode(value) {
  if (typeof value === "string") return '"' + value.replace(/[\\"\n\r]/g, char => char === "\n" ? "\\n" : char === "\r" ? "\\r" : "\\" + char) + '"';
  if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => (/^[1-9]\d*$/.test(key) && Number.isSafeInteger(Number(key)) ? "#" + key : encode(key)) + ":" + encode(item)).join(",") + "}";
  throw new Error("Unsupported archive value.");
}
export function archiveCode(archive) {
  validateGRMArchive(archive);
  const bytes = Buffer.from(encode(archive));
  if (bytes.length > MAX_CODE) throw new Error("Archive exceeds the 2 MB import limit; select a smaller GRM guild backup.");
  let hash = 0;
  for (const byte of bytes) hash = (hash * 31 + byte) % 16_777_213;
  return `GGRM1:${hash.toString(16).padStart(6, "0")}:${bytes.toString("base64")}`;
}
export function convertGRM(text, options) {
  const archive = buildGRMArchive(parseGRM(text), options, createHash("sha256").update(text).digest("hex"));
  return { archive, code: archiveCode(archive), summary: { guild: archive.guild, realm: archive.realm, edition: archive.edition, current: count(archive.members), former: count(archive.former), logs: count(archive.logs), groups: count(archive.groups), private: archive.private, omittedLogs: archive.omittedLogs, omittedFields: archive.omittedFields } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = {}; const flags = new Set(["input", "output", "guild-key", "guild", "realm", "edition"]);
  for (const arg of process.argv.slice(2)) {
    if (arg === "--with-private-history") { options.includePrivate = true; continue; }
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !flags.has(match[1])) throw new Error("Use --input=FILE --output=NEW_FILE --guild-key=Guild-Realm --guild=Guild --realm=Realm --edition=EDITION [--with-private-history].");
    options[match[1] === "guild-key" ? "guildKey" : match[1]] = match[2];
  }
  if (!options.input || !options.output) throw new Error("Input and new output paths are required.");
  const result = convertGRM(await readFile(options.input, "utf8"), options);
  await writeFile(options.output, result.code + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result.summary, null, 2));
  console.log("Local archive created. Preview it in Guilded Roster admin before importing. No data was uploaded or applied to the guild.");
}
