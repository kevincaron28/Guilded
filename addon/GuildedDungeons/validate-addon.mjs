/* eslint-disable no-control-regex */
// Static checks for Guilded Dungeons (7.0). Run on its own or from addon/Guilded/validate-addon.mjs.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { check as copiesMatch, tocFiles } from "../../scripts/build-dungeons-addon.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const toc = readFileSync(join(root, "GuildedDungeons.toc"), "utf8");
if (!toc.includes("## Interface: 16001") || !toc.includes("## SavedVariables: GuildedDungeonsDB")) throw new Error("GuildedDungeons.toc is missing interface or SavedVariables metadata");
if (/## (?:RequiredDeps|Dependencies):/i.test(toc)) throw new Error("GuildedDungeons must work without Guilded (no required dependency)");
if (!/## OptionalDeps: Guilded/.test(toc)) throw new Error("GuildedDungeons must load after Guilded (OptionalDeps) so it can stay quiet");
// One source: the shared files are exact copies of Guilded's.
copiesMatch();

const files = tocFiles();
if (files[0] !== "Shim.lua" || files.at(-1) !== "Main.lua") throw new Error("GuildedDungeons.toc must load Shim.lua first and Main.lua last");
for (const entry of readdirSync(root, { recursive: true })) {
  const file = String(entry).replaceAll("\\", "/");
  if (!/\.(lua|toc|md)$/.test(file)) continue;
  const text = readFileSync(join(root, file), "utf8");
  if (/[^\x00-\x7F]/.test(text)) throw new Error(`Non-ASCII content in GuildedDungeons/${file}`);
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) throw new Error(`Control characters in GuildedDungeons/${file}`);
  if (file.endsWith(".lua") && !files.includes(file)) throw new Error(`GuildedDungeons/${file} is not listed in GuildedDungeons.toc`);
}
let luaparse = null;
try { luaparse = (await import("luaparse")).default; } catch { console.warn("luaparse not installed; skipping the GuildedDungeons syntax check."); }
for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  if (/["']COMBAT_LOG_EVENT(?:_UNFILTERED)?["']/.test(source)) throw new Error(`GuildedDungeons/${file} registers a combat log event`);
  if (file !== "Shared/Util.lua" && /SendAddonMessage\(/.test(source)) throw new Error(`GuildedDungeons/${file} calls SendAddonMessage directly; use ns.comm.send`);
  // Its own data only: never write Guilded's SavedVariables.
  if (file === "Shim.lua" || file === "Main.lua") { if (/GuildedDB\b/.test(source)) throw new Error(`GuildedDungeons/${file} touches GuildedDB`); }
  if (luaparse) {
    try { luaparse.parse(source, { luaVersion: "5.1" }); } catch (error) { throw new Error(`GuildedDungeons/${file}: Lua syntax error: ${error.message}`, { cause: error }); }
  }
}
console.log("Guilded Dungeons addon static validation passed.");
