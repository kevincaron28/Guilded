import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";
import { GAME_EDITIONS, editionFromInterface } from "../companion/game-edition.mjs";

// Run before uploading edition zips to CurseForge (or any host): every zip must really be the
// edition its file name and upload slot say. A build for another edition installed in a game
// folder is skipped by the client without any message, so this is checked at the source.
//   node scripts/verify-edition-zips.mjs [folder-or-zip ...]     (default: dist/editions)
// The edition comes from the name, Guilded[Dungeons]-vX.Y.Z-<edition>.zip, which is also what
// CurseForge's game-version/flavor choice for each upload should match:
export const CURSEFORGE_FLAVORS = { forever: "Forever", "classic-era": "Classic", "classic-tbc": "Classic TBC", "classic-mists": "MoP Classic", retail: "Retail" };

export function verifyEditionZip(file) {
  const name = basename(file);
  const match = /^(Guilded|GuildedDungeons)-v(\d+\.\d+\.\d+)-([a-z-]+)\.zip$/.exec(name);
  if (!match || !GAME_EDITIONS.includes(match[3])) return [`${name}: not an edition package name`];
  const [, addon, version, edition] = match;
  const problems = [];
  const files = unzipSync(new Uint8Array(readFileSync(file)));
  const text = (path) => (files[path] ? new TextDecoder().decode(files[path]) : null);
  const toc = text(`${addon}/${addon}.toc`);
  if (toc === null) return [`${name}: ${addon}.toc is missing`];
  const interfaces = (/^## Interface:\s*(.+)$/m.exec(toc)?.[1] ?? "").split(",").map((part) => Number(part.trim()));
  if (interfaces.length !== 1 || editionFromInterface(interfaces[0]) !== edition) problems.push(`${name}: ## Interface ${interfaces.join(", ")} is not a single ${edition} interface`);
  const stated = /^## X-Guilded-Edition:\s*(\S+)/m.exec(toc)?.[1];
  if (stated !== edition) problems.push(`${name}: X-Guilded-Edition is ${stated ?? "missing"}, expected ${edition}`);
  const stamp = text(`${addon}/EDITION.txt`);
  if (stamp === null) problems.push(`${name}: EDITION.txt is missing`);
  else {
    if (!stamp.includes(`Edition: ${edition}\n`)) problems.push(`${name}: EDITION.txt does not say Edition: ${edition}`);
    if (!stamp.startsWith(`Guilded ${version}\n`)) problems.push(`${name}: EDITION.txt version differs from ${version}`);
  }
  if (!new RegExp(`^## Version:\\s*${version.replaceAll(".", "\\.")}\\s*$`, "m").test(toc)) problems.push(`${name}: TOC version differs from ${version}`);
  const others = Object.keys(files).filter((path) => !path.startsWith(`${addon}/`));
  if (others.length) problems.push(`${name}: files outside ${addon}/ (${others[0]})`);
  return problems;
}

export function verifyEditionZips(targets) {
  const zips = targets.flatMap((target) => (target.endsWith(".zip") ? [target] : readdirSync(target).filter((n) => n.endsWith(".zip")).map((n) => join(target, n))));
  if (zips.length === 0) return { zips, problems: ["No zip files found."] };
  return { zips, problems: zips.flatMap(verifyEditionZip) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { zips, problems } = verifyEditionZips(process.argv.slice(2).length ? process.argv.slice(2) : ["dist/editions"]);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  for (const zip of zips) {
    const edition = /-v[\d.]+-([a-z-]+)\.zip$/.exec(zip)?.[1];
    console.log(`${basename(zip)} OK (CurseForge flavor: ${CURSEFORGE_FLAVORS[edition]})`);
  }
}
