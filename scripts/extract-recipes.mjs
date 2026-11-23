#!/usr/bin/env node
// Writes data/recipes/recipes.csv: every crafting recipe of the WoW Forever client with its reagents, read from the
// game's own tables (the DB2 exports wago.tools serves for each build, for example product "wowf" 1.60.1.71037).
//
//   node scripts/extract-recipes.mjs                         latest wowf build
//   node scripts/extract-recipes.mjs --build 1.60.1.71037    a named build
//   node scripts/extract-recipes.mjs --dir C:\csv            tables already downloaded (SkillLineAbility.csv, ...)
//
// Run it again after a WoW Forever update, review `git diff data/recipes/recipes.csv`, then `npm run reagents:build`.
// Hand edits belong in data/recipes/overrides.csv (they survive a re-run); docs/RECIPE_REAGENTS.md explains both files.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

// Skill lines that have a profession window (SkillLine.db2). Engraving (runes) and the gathering skills are not recipes.
export const PROFESSIONS = { 171: "Alchemy", 164: "Blacksmithing", 333: "Enchanting", 202: "Engineering", 165: "Leatherworking",
  197: "Tailoring", 185: "Cooking", 129: "First Aid", 40: "Poisons", 186: "Mining" };
// SpellEffect.Effect values that make an item (key = item id) or enchant one (key = minus the spell id, like Recipes.lua).
const MAKES_ITEM = new Set([24, 157, 59]);
const ENCHANTS = new Set([53, 54, 92]);

// Minimal CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function table(name, build, dir) {
  const file = join(dir, `${name}.csv`);
  if (!existsSync(file)) {
    const res = await fetch(`https://wago.tools/db2/${name}/csv?build=${build}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return parseCsv(readFileSync(file, "utf8"));
}

async function latestBuild() {
  const res = await fetch("https://wago.tools/api/builds");
  if (!res.ok) throw new Error(`builds: HTTP ${res.status}`);
  const builds = (await res.json()).wowf;
  if (!Array.isArray(builds) || !builds.length) throw new Error("no wowf build listed");
  return builds[0].version;
}

const csvField = (value) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

async function main() {
  const build = opt("build") || (opt("dir") ? "local" : await latestBuild());
  const dir = opt("dir") || join(tmpdir(), `guilded-recipes-${build}`);
  mkdirSync(dir, { recursive: true });
  console.log(`Build ${build}, tables in ${dir}`);
  const [abilities, effects, reagents, spellNames, items] = await Promise.all(
    ["SkillLineAbility", "SpellEffect", "SpellReagents", "SpellName", "ItemSparse"].map((t) => table(t, build, dir)));
  const spellName = new Map(spellNames.map((r) => [r.ID, r.Name_lang]));
  const itemName = new Map(items.map((r) => [r.ID, r.Display_lang]));
  const effectsBySpell = new Map();
  for (const e of effects) { if (!effectsBySpell.has(e.SpellID)) effectsBySpell.set(e.SpellID, []); effectsBySpell.get(e.SpellID).push(e); }
  const reagentsBySpell = new Map(reagents.map((r) => [r.SpellID, r]));

  const out = new Map(); // key -> row
  let noReagents = 0, noEffect = 0;
  for (const a of abilities) {
    const profession = PROFESSIONS[a.SkillLine];
    if (!profession) continue;
    const spell = a.Spell;
    const made = (effectsBySpell.get(spell) || []).find((e) => MAKES_ITEM.has(Number(e.Effect)) && Number(e.EffectItemType) > 0);
    const enchant = (effectsBySpell.get(spell) || []).find((e) => ENCHANTS.has(Number(e.Effect)));
    if (!made && !enchant) { noEffect++; continue; }
    const key = made ? Number(made.EffectItemType) : -Number(spell);
    const count = made ? Math.max(1, Math.round(Number(made.EffectBasePointsF) || 1)) : 1;
    const r = reagentsBySpell.get(spell);
    const list = [];
    for (let i = 0; i < 8; i++) {
      const id = Number(r?.[`Reagent_${i}`] || 0), n = Number(r?.[`ReagentCount_${i}`] || 0);
      if (id > 0 && n > 0) list.push([id, n]);
    }
    if (!list.length) { noReagents++; continue; }
    const row = {
      key, profession, spell: Number(spell), count,
      name: made ? (itemName.get(String(key)) || spellName.get(spell) || "") : (spellName.get(spell) || ""),
      reagents: list.map(([id, n]) => `${id}:${n}`).join(";"),
      reagentNames: list.map(([id, n]) => `${itemName.get(String(id)) || `item ${id}`} x${n}`).join("; ")
    };
    const old = out.get(key);
    if (!old || row.spell < old.spell) out.set(key, row); // two spells for one item: keep the older spell
  }
  const rows = [...out.values()].sort((x, y) => x.profession.localeCompare(y.profession) || x.name.localeCompare(y.name) || x.key - y.key);
  const lines = ["key,profession,spell,count,name,reagents,reagent_names"];
  for (const r of rows) lines.push([r.key, r.profession, r.spell, r.count, csvField(r.name), r.reagents, csvField(r.reagentNames)].join(","));
  const reagentIds = [...new Set(rows.flatMap((r) => r.reagents.split(";").map((p) => Number(p.split(":")[0]))))].sort((x, y) => x - y);
  mkdirSync(join(root, "data", "recipes"), { recursive: true });
  writeFileSync(join(root, "data", "recipes", "items.csv"),
    ["id,name", ...reagentIds.map((id) => `${id},${csvField(itemName.get(String(id)) || "")}`)].join("\n") + "\n");
  const file = join(root, "data", "recipes", "recipes.csv");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join("\n") + "\n");
  writeFileSync(join(root, "data", "recipes", "SOURCE.txt"),
    `Extracted by scripts/extract-recipes.mjs from the WoW Forever tables (wago.tools DB2 export, product wowf, build ${build}).\n` +
    `Tables: SkillLineAbility, SpellEffect, SpellReagents, SpellName, ItemSparse. ${rows.length} recipes; ${noReagents} abilities without reagents and ${noEffect} without an item or enchant effect were skipped.\n`);
  const per = {};
  for (const r of rows) per[r.profession] = (per[r.profession] || 0) + 1;
  console.log(`${rows.length} recipes`, per, `skipped: ${noReagents} no reagents, ${noEffect} no item/enchant effect`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
