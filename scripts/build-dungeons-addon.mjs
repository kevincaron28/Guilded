// GuildedDungeons (7.0): the standalone dungeon addon, built from Guilded's own dungeon files so
// there is one source. `node scripts/build-dungeons-addon.mjs` copies them into
// addon/GuildedDungeons/Shared/; `--check` fails if a copy differs from its source (the addon
// validator runs it); `--zip` also builds dist/GuildedDungeons-v<version>.zip. Never publishes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync } from "fflate";
import luaparse from "luaparse";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repo, "addon", "Guilded");
const target = join(repo, "addon", "GuildedDungeons");
// Load order matters: Util and Compat first, then the modules (same order as Guilded.toc).
export const SHARED = ["Util.lua", "Compat.lua", "Locale.lua", "DungeonRoutes.lua", "Modules/Dungeon.lua", "Modules/RunResults.lua", "Modules/Scores.lua"];
const header = (file) => `-- Copied from addon/Guilded/${file} by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.\n`;

export function expectedCopy(file) {
  return header(file) + readFileSync(join(source, file), "utf8").replace(/\r\n/g, "\n");
}
export const copyPath = (file) => join(target, "Shared", file.replace(/^Modules\//, ""));

export function sync() {
  mkdirSync(join(target, "Shared"), { recursive: true });
  for (const file of SHARED) writeFileSync(copyPath(file), expectedCopy(file));
}

export function check() {
  const stale = SHARED.filter((file) => !existsSync(copyPath(file)) || readFileSync(copyPath(file), "utf8").replace(/\r\n/g, "\n") !== expectedCopy(file));
  if (stale.length) throw new Error(`GuildedDungeons copies differ from Guilded: ${stale.join(", ")}. Run npm run dungeons:sync.`);
}

export function tocFiles() {
  const toc = readFileSync(join(target, "GuildedDungeons.toc"), "utf8");
  return toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua") && !line.startsWith("#")).map((line) => line.replace(/\\/g, "/"));
}

function zip() {
  const toc = readFileSync(join(target, "GuildedDungeons.toc"), "utf8");
  const version = toc.match(/^## Version:\s*(\S+)/m)?.[1];
  if (!version) throw new Error("GuildedDungeons.toc has no version.");
  if (/## (?:RequiredDeps|Dependencies):/i.test(toc)) throw new Error("GuildedDungeons must not require Guilded.");
  const files = {};
  for (const file of ["GuildedDungeons.toc", ...tocFiles(), "README.md", "LICENSE.txt"]) {
    const text = readFileSync(join(target, file), "utf8");
    if (file.endsWith(".lua")) luaparse.parse(text, { luaVersion: "5.1" });
    files[`GuildedDungeons/${file}`] = new TextEncoder().encode(text);
  }
  const packed = zipSync(files, { level: 9 });
  const unpacked = unzipSync(packed);
  for (const file of tocFiles()) if (!unpacked[`GuildedDungeons/${file}`]) throw new Error(`Missing ${file}`);
  mkdirSync(join(repo, "dist"), { recursive: true });
  const out = join(repo, "dist", `GuildedDungeons-v${version}.zip`);
  writeFileSync(out, packed);
  console.log(`Built and verified dist/GuildedDungeons-v${version}.zip (${Object.keys(unpacked).length} files). Real-client acceptance pending.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) { check(); console.log("GuildedDungeons copies match Guilded."); }
  else {
    sync();
    console.log(`Copied ${SHARED.length} files into addon/GuildedDungeons/Shared/.`);
    if (process.argv.includes("--zip")) { check(); zip(); }
  }
}
