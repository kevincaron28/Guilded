import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, unzipSync } from "fflate";
import { execFileSync } from "node:child_process";
const addonDir = "addon/Guilded";
const toc = readFileSync(join(addonDir, "Guilded.toc"), "utf8");
const version = toc.match(/^## Version:\s*(\S+)/m)?.[1];
if (!version) throw new Error("Missing addon version.");
const files = {};
function collect(dir, relative = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(join(dir, entry.name), child);
    else if (entry.isFile() && entry.name !== "validate-addon.mjs") files[`Guilded/${child}`] = new Uint8Array(readFileSync(join(dir, entry.name)));
  }
}
collect(addonDir);
// Ship the current member instructions with every addon download.
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const installGuide = readFileSync("docs/MEMBER_INSTALL.md", "utf8")
  .replace(/\]\((?!https?:|#)([^)]+)\)/g, "](" + `https://github.com/kevincaron28/Guilded/blob/${sourceCommit}/docs/$1)`);
files["Guilded/INSTALL.md"] = new TextEncoder().encode(installGuide);
// Never accidentally package an officer's locally generated data.
files["Guilded/Standings.lua"] = new TextEncoder().encode("-- Replaced by your paired companion. No guild data is shipped.\nGuildedStandings = { updatedAt = nil, baseGp = 0, players = {} }\nGuildedLedgerAccepted = {}\nGuildedItems = nil\nGuildedLoot = nil\nGuildedNextRaid = nil\nGuildedRaids = nil\nGuildedDungeonAccepted = {}\nGuildedDungeonBoard = nil\n");
const zip = zipSync(files, { level: 9 });
const unpacked = unzipSync(zip);
for (const line of toc.split(/\r?\n/).map((v) => v.trim()).filter((v) => v.endsWith(".lua"))) {
  if (!unpacked[`Guilded/${line.replace(/\\/g, "/")}`]) throw new Error(`Missing packaged file: ${line}`);
}
mkdirSync("dist", { recursive: true });
const preview = process.argv.includes("--preview");
if (preview) mkdirSync("dist/preview", { recursive: true });
const target = preview ? "dist/preview/Guilded-next-preview.zip" : `dist/Guilded-v${version}.zip`;
writeFileSync(target, zip);
console.log(`Built and verified ${target} (${Object.keys(unpacked).length} files).`);
