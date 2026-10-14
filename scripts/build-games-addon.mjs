import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { zipSync, unzipSync } from "fflate";
import luaparse from "luaparse";
const root = "addon/GuildedGames";
const toc = readFileSync(`${root}/GuildedGames.toc`, "utf8");
const version = toc.match(/^## Version:\s*(\S+)/m)?.[1];
if (!version || /## (?:RequiredDeps|Dependencies):/i.test(toc)) throw new Error("Games must have a version and no required addon dependency.");
const luaFiles = toc.split(/\r?\n/).map(s => s.trim()).filter(s => s.endsWith(".lua"));
const files = {};
for (const file of ["GuildedGames.toc", ...luaFiles, "README.md", "LICENSE.txt"]) {
  const source = readFileSync(`${root}/${file}`, "utf8");
  if (file.endsWith(".lua")) luaparse.parse(source, { luaVersion: "5.1" });
  files[`GuildedGames/${file}`] = new TextEncoder().encode(source);
}
files["GuildedGames/Media/Logo.tga"] = new Uint8Array(readFileSync(`${root}/Media/Logo.tga`));
const zip = zipSync(files, { level: 9 });
const unpacked = unzipSync(zip);
for (const file of luaFiles) if (!unpacked[`GuildedGames/${file}`]) throw new Error(`Missing ${file}`);
const alpha = process.argv.includes("--alpha");
const directory = alpha ? "dist/guilded-games" : "dist/preview";
mkdirSync(directory, { recursive: true });
const target = `${directory}/GuildedGames-v${version}-${alpha ? "alpha" : "preview"}.zip`;
writeFileSync(target, zip);
console.log(`Built and verified ${target}. Real-client acceptance pending.`);
