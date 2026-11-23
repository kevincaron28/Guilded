#!/usr/bin/env node
// Builds addon/Guilded/Data/Reagents.lua (the reagents every recipe needs, shipped with the addon) from the one editable
// source in data/recipes/:
//
//   recipes.csv       what scripts/extract-recipes.mjs read from the game's tables (re-run it after a game update)
//   overrides.csv     your own lines, one per recipe: a line with the same key REPLACES the extracted one, a new key ADDS a
//                     recipe, and profession "-" REMOVES it. Lines starting with # are comments.
//   items.csv         reagent names (English, only a fallback: the addon asks the game for the player's language)
//   items-extra.csv   optional: names for reagents that only your overrides use
//
//   node scripts/build-reagents.mjs           write the Lua file
//   node scripts/build-reagents.mjs --check   exit 1 when the Lua file is not what the CSV files give (used by the tests)
//
// Columns of recipes.csv and overrides.csv: key,profession,spell,count,name,reagents,reagent_names
//   key         the item id the recipe makes; for an enchant, minus the spell id (the same key Recipes.lua stores)
//   reagents    "id:count;id:count" (1 to 8 reagents); reagent_names is only a reading aid and is ignored
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./extract-recipes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDir = join(root, "data", "recipes");
export const OUTPUT = join(root, "addon", "Guilded", "Data", "Reagents.lua");

function readCsv(file, { optional = false } = {}) {
  if (!existsSync(file)) {
    if (optional) return [];
    throw new Error(`missing ${file}`);
  }
  const text = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !line.startsWith("#")).join("\n");
  return parseCsv(text);
}

function parseRecipe(row, where) {
  const key = Number(row.key);
  if (!Number.isInteger(key) || key === 0) throw new Error(`${where}: key "${row.key}" is not a whole number (an item id, or minus a spell id)`);
  if (row.profession === "-") return { key, remove: true };
  const count = Number(row.count || 1);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error(`${where}: count "${row.count}" must be a whole number from 1`);
  const reagents = String(row.reagents || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const m = /^(\d+):(\d+)$/.exec(part);
    if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) throw new Error(`${where}: reagent "${part}" must look like itemId:count`);
    return [Number(m[1]), Number(m[2])];
  });
  if (reagents.length < 1 || reagents.length > 8) throw new Error(`${where}: a recipe has 1 to 8 reagents, found ${reagents.length}`);
  if (new Set(reagents.map((r) => r[0])).size !== reagents.length) throw new Error(`${where}: the same reagent is listed twice`);
  return { key, profession: row.profession, count, name: row.name || "", reagents };
}

// Lua string literal that is plain ASCII (accents become decimal escapes, as Locale.lua does).
export function luaString(text) {
  let out = "";
  for (const byte of Buffer.from(String(text), "utf8")) {
    if (byte === 0x22 || byte === 0x5c) out += "\\" + String.fromCharCode(byte);
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += "\\" + String(byte).padStart(3, "0");
  }
  return `"${out}"`;
}

export function buildReagents(dataDir = defaultDir) {
  const recipes = new Map();
  const meta = existsSync(join(dataDir, "SOURCE.txt")) ? readFileSync(join(dataDir, "SOURCE.txt"), "utf8").split("\n")[0] : "";
  readCsv(join(dataDir, "recipes.csv")).forEach((row, i) => {
    const recipe = parseRecipe(row, `recipes.csv line ${i + 2}`);
    if (recipes.has(recipe.key)) throw new Error(`recipes.csv line ${i + 2}: key ${recipe.key} appears twice`);
    recipes.set(recipe.key, recipe);
  });
  const seenOverride = new Set();
  let replaced = 0, added = 0, removed = 0;
  readCsv(join(dataDir, "overrides.csv"), { optional: true }).forEach((row, i) => {
    const recipe = parseRecipe(row, `overrides.csv line ${i + 1}`);
    if (seenOverride.has(recipe.key)) throw new Error(`overrides.csv: key ${recipe.key} appears twice`);
    seenOverride.add(recipe.key);
    if (recipe.remove) { if (recipes.delete(recipe.key)) removed++; return; }
    if (recipes.has(recipe.key)) replaced++; else added++;
    recipes.set(recipe.key, recipe);
  });
  const names = new Map();
  for (const file of ["items.csv", "items-extra.csv"]) {
    for (const row of readCsv(join(dataDir, file), { optional: file !== "items.csv" })) if (row.name) names.set(Number(row.id), row.name);
  }
  const keys = [...recipes.keys()].sort((a, b) => a - b);
  const used = new Set();
  const perProfession = {};
  for (const key of keys) {
    const r = recipes.get(key);
    for (const [id] of r.reagents) used.add(id);
    perProfession[r.profession] = (perProfession[r.profession] || 0) + 1;
  }
  const lines = [
    "-- GENERATED by scripts/build-reagents.mjs from data/recipes/*.csv: do not edit by hand (docs/RECIPE_REAGENTS.md).",
    `-- ${meta}`.trimEnd(),
    `-- ${keys.length} recipes (${Object.entries(perProfession).sort().map(([p, n]) => `${p} ${n}`).join(", ")}); ${replaced} replaced, ${added} added, ${removed} removed by overrides.csv.`,
    "-- recipes[key] = { producedCount, reagentId, count, reagentId, count, ... }; key is the item id the recipe makes,",
    "-- or minus the spell id for an enchant (the key Recipes.lua stores). names[id] is an English fallback only.",
    "local _, ns = ...",
    "ns = ns or {}",
    `ns.reagentData = { recipeCount = ${keys.length}, recipes = {`
  ];
  for (const key of keys) {
    const r = recipes.get(key);
    lines.push(`[${key}]={${r.count},${r.reagents.map(([id, n]) => `${id},${n}`).join(",")}},`);
  }
  lines.push("}, names = {");
  for (const id of [...used].sort((a, b) => a - b)) if (names.has(id)) lines.push(`[${id}]=${luaString(names.get(id))},`);
  lines.push("} }");
  return { text: lines.join("\n") + "\n", count: keys.length, perProfession, replaced, added, removed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const built = buildReagents();
    if (process.argv.includes("--check")) {
      const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : "";
      if (current !== built.text) { console.error("addon/Guilded/Data/Reagents.lua is out of date: run npm run reagents:build"); process.exit(1); }
      console.log(`Reagents.lua is current (${built.count} recipes).`);
    } else {
      writeFileSync(OUTPUT, built.text);
      console.log(`Wrote ${OUTPUT}: ${built.count} recipes`, built.perProfession, `(overrides: ${built.replaced} replaced, ${built.added} added, ${built.removed} removed)`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
