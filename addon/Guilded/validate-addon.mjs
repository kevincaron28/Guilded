/* eslint-disable no-control-regex */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = new URL(".", import.meta.url);
const rootPath = fileURLToPath(root);
const toc = readFileSync(new URL("Guilded.toc", root), "utf8");
// 16001 is WoW Forever's interface number (from /dump select(4, GetBuildInfo())).
if (!toc.includes("## Interface: 16001") || !toc.includes("## SavedVariables:")) {
  throw new Error("TOC is missing interface or SavedVariables metadata");
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

for (const file of walk(rootPath)) {
  if (file.endsWith(".lua") || file.endsWith(".toc") || file.endsWith(".md")) {
    const text = readFileSync(file, "utf8");
    if (/[^\x00-\x7F]/.test(text)) throw new Error(`Non-ASCII content in ${file}`);
  }
}

const core = readFileSync(new URL("Core.lua", root), "utf8");
for (const required of ["PLAYER_LOGIN", "GUILD_ROSTER_UPDATE", "CHAT_MSG_LOOT", "SlashCmdList"]) {
  if (!core.includes(required)) throw new Error(`Missing ${required} in Core.lua`);
}
// Every addon message goes through Util.lua's paced queue (ns.comm); a module calling the
// game's send function directly would bypass the throttle and be dropped in a burst.
const utilSource = readFileSync(new URL("Util.lua", root), "utf8");
if (!utilSource.includes("SendAddonMessage")) throw new Error("Util.lua must send addon messages (ns.comm)");
// Since patch 12.0.0 (inherited by WoW Forever) addons cannot register the
// combat log event; attempting it triggers a "blocked from an action only
// available to the Blizzard UI" popup on load.
for (const file of ["Core.lua", "Modules/Games.lua"]) {
  const source = readFileSync(new URL(file, root), "utf8");
  if (/RegisterEvent\(\s*"COMBAT_LOG_EVENT/.test(source)) {
    throw new Error(`${file} registers a combat log event, which addons are blocked from doing`);
  }
}
if (!core.includes("GuildedDB")) {
  throw new Error("Core.lua does not reference its SavedVariables database");
}

const games = readFileSync(new URL("Modules/Games.lua", root), "utf8");
if (!games.includes("commandHandlers")) {
  throw new Error("Games.lua does not register into Core.lua's command extension point");
}
if (/GuildedCasino|debt|ledger|wager/i.test(games.replace(/no ledger|no wagers|nothing owed/gi, ""))) {
  throw new Error("Games.lua must stay free of gold, wagers and ledgers");
}

// Every Lua file the .toc loads (so a new module is checked without editing this list).
const addonFiles = toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua") && !line.startsWith("#")).map((line) => line.replace(/\\/g, "/"));
if (addonFiles.length < 20) throw new Error("Guilded.toc lists too few Lua files; is it complete?");
for (const file of addonFiles) {
  const source = readFileSync(new URL(file, root), "utf8");
  if (/RegisterEvent\(\s*"COMBAT_LOG_EVENT/.test(source)) {
    throw new Error(`${file} registers a combat log event, which addons are blocked from doing`);
  }
}
for (const file of addonFiles) {
  if (file === "Util.lua") continue;
  const source = readFileSync(new URL(file, root), "utf8");
  if (/SendAddonMessage\(/.test(source)) throw new Error(`${file} calls SendAddonMessage directly; use ns.comm.send (Util.lua)`);
}
// Addon message prefixes are limited to 16 characters.
for (const file of addonFiles) {
  const source = readFileSync(new URL(file, root), "utf8");
  for (const match of source.matchAll(/PREFIX = "([^"]+)"/g)) {
    if (match[1].length > 16) throw new Error(`${file}: addon message prefix "${match[1]}" is over 16 characters`);
  }
}

for (const file of addonFiles) {
  const name = file.replace("/", "\\");
  if (!toc.includes(name)) throw new Error(`${file} is not listed in Guilded.toc, so the game would never load it`);
}

// Lua syntax: one broken file stops the whole addon from loading in game.
// luaparse comes with the bot's dependencies (the companion uses it).
let luaparse = null;
try {
  luaparse = (await import("luaparse")).default;
} catch {
  console.warn("luaparse not installed (run npm install in the bot folder); skipping the Lua syntax check.");
}
if (luaparse) {
  for (const file of addonFiles) {
    try {
      luaparse.parse(readFileSync(new URL(file, root), "utf8"), { luaVersion: "5.1" });
    } catch (error) {
      throw new Error(`${file}: Lua syntax error: ${error.message}`);
    }
  }
}

console.log("Guilded addon static validation passed.");
