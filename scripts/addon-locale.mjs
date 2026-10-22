// Translator kit for the addon's Locale.lua (German and Spanish, and any later language).
// Locale.lua must stay plain ASCII (the validator rejects other bytes), so accents are written as
// Lua byte escapes such as \195\164. Translators should never have to type those: they edit a
// CSV in a spreadsheet and this script writes the escaped Lua.
//
//   npm run locale -- status                 how many strings each language has
//   npm run locale -- export de [file.csv]   English, French and German columns (UTF-8)
//   npm run locale -- import de file.csv     writes the DE block of Locale.lua from the CSV
//
// After an import, run npm run dungeons:sync (Guilded Dungeons ships a copy of Locale.lua).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LANGUAGES = { de: "DE", es: "ES" };
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const localePath = join(repo, "addon", "Guilded", "Locale.lua");

/** A Lua string literal's body (between double quotes) to text. */
export function luaDecode(body) {
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") { bytes.push(...Buffer.from(char, "utf8")); continue; }
    const next = body[++i];
    const digits = /^\d{1,3}/.exec(body.slice(i))?.[0];
    if (digits) { bytes.push(Number(digits)); i += digits.length - 1; }
    else if (next === "n") bytes.push(10);
    else bytes.push(...Buffer.from(next, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Text to an ASCII-only Lua string literal body. */
export function luaEncode(text) {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) {
    if (byte === 0x22) out += "\\\"";
    else if (byte === 0x5c) out += "\\\\";
    else if (byte === 10) out += "\\n";
    else if (byte < 32 || byte > 126) out += `\\${byte}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

const ENTRY = /\["((?:[^"\\]|\\.)*)"\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;

/** Every English key with its translation, for FR (the reference) or a block language. */
export function readTable(source, table) {
  const map = new Map();
  if (table === "FR") {
    const block = source.slice(source.indexOf("local FR = {"), source.indexOf("\n}", source.indexOf("local FR = {")));
    for (const m of block.matchAll(ENTRY)) map.set(luaDecode(m[1]), luaDecode(m[2]));
    for (const m of source.matchAll(/^FR\["((?:[^"\\]|\\.)*)"\]\s*=\s*"((?:[^"\\]|\\.)*)"/gm)) map.set(luaDecode(m[1]), luaDecode(m[2]));
    return map;
  }
  const { start, end } = blockRange(source, table);
  for (const m of source.slice(start, end).matchAll(ENTRY)) map.set(luaDecode(m[1]), luaDecode(m[2]));
  return map;
}

function blockRange(source, table) {
  const start = source.indexOf(`-- BEGIN ${table}`), end = source.indexOf(`-- END ${table}`);
  if (start < 0 || end < start) throw new Error(`Locale.lua has no "-- BEGIN ${table}" / "-- END ${table}" block.`);
  return { start, end };
}

/** Locale.lua with the language's block rewritten from these translations (English key -> text). */
export function writeBlock(source, table, translations) {
  const { start, end } = blockRange(source, table);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = [...translations].filter(([, text]) => text.trim()).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, text]) => `  ["${luaEncode(key)}"] = "${luaEncode(text)}",`);
  const block = [`-- BEGIN ${table} (written by npm run locale -- import; edit the CSV, not these lines)`, `local ${table} = {`, ...lines, "}", ""].join(eol);
  return source.slice(0, start) + block + source.slice(end);
}

export function toCsv(rows) {
  const cell = (value) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
  return "\uFEFF" + rows.map((row) => row.map((value) => cell(value ?? "")).join(",")).join("\r\n") + "\r\n";
}

export function fromCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "\"" && text[i + 1] === "\"") { cell += "\""; i++; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((value) => value !== ""));
}

function main([command, lang, file]) {
  const source = readFileSync(localePath, "utf8");
  const reference = readTable(source, "FR");
  if (command === "status") {
    console.log(`French: ${reference.size} strings (the reference list).`);
    for (const [code, table] of Object.entries(LANGUAGES)) console.log(`${code}: ${readTable(source, table).size} of ${reference.size}.`);
    return;
  }
  const table = LANGUAGES[lang];
  if (!table) throw new Error(`Use a language code: ${Object.keys(LANGUAGES).join(", ")}.`);
  if (command === "export") {
    const current = readTable(source, table);
    const out = file ?? join(repo, "dist", `locale-${lang}.csv`);
    writeFileSync(out, toCsv([["english", "french", lang], ...[...reference].map(([key, fr]) => [key, fr, current.get(key) ?? ""])]));
    console.log(`Wrote ${out}: ${reference.size} strings, ${current.size} already in ${lang}. Fill the "${lang}" column, keep %s / %d / |cff...|r codes as they are.`);
  } else if (command === "import") {
    if (!file) throw new Error("Give the CSV file to import.");
    const [header, ...rows] = fromCsv(readFileSync(file, "utf8"));
    const column = header.indexOf(lang);
    if (header[0] !== "english" || column < 0) throw new Error(`The CSV needs an "english" first column and a "${lang}" column.`);
    const translations = new Map(rows.map((row) => [row[0], row[column] ?? ""]));
    for (const [key, text] of translations) {
      const placeholders = (value) => (value.match(/%[sd%]|%\.\d+f|%-?\d*s/g) ?? []).join(" ");
      if (text.trim() && placeholders(key) !== placeholders(text)) throw new Error(`Placeholders differ for "${key}": "${text}". Keep %s / %d in the same order.`);
    }
    writeFileSync(localePath, writeBlock(source, table, translations));
    console.log(`Imported ${[...translations.values()].filter((t) => t.trim()).length} ${lang} strings. Now run npm run dungeons:sync and the tests.`);
  } else throw new Error("Use: status | export <lang> [file.csv] | import <lang> <file.csv>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
