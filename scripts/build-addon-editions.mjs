import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { zipSync, unzipSync } from "fflate";
import luaparse from "luaparse";
import { GAME_EDITIONS, editionFromInterface } from "../companion/game-edition.mjs";
import { check } from "./build-dungeons-addon.mjs";
import { releaseMetadata } from "./release-metadata.mjs";
import { releaseSource } from "./release-source.mjs";

// Packaging baselines, not client acceptance. Release operators can supply the
// observed GetBuildInfo() interface with --interface=classic-era:11508.
export const EDITION_INTERFACES = { forever: 16001, "classic-era": 11500, "classic-tbc": 20506, "classic-mists": 50500, retail: 120105 };
const EMPTY = "-- No guild data is shipped. Your paired companion supplies this file.\nGuildedStandings = { updatedAt = nil, baseGp = 0, players = {} }\nGuildedLedgerAccepted = {}\nGuildedItems = nil\nGuildedLoot = nil\nGuildedNextRaid = nil\nGuildedRaids = nil\nGuildedDungeonAccepted = {}\nGuildedDungeonBoard = nil\n";

export function packageEdition(addon, edition, api = EDITION_INTERFACES[edition]) {
  if (!GAME_EDITIONS.includes(edition) || editionFromInterface(api) !== edition) throw new Error("Interface does not belong to the selected edition.");
  const source = join("addon", addon), files = {};
  function collect(dir, prefix = "") {
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) collect(join(dir,entry.name), relative + "/");
      else if (!entry.name.endsWith(".mjs")) files[`${addon}/${relative}`] = new Uint8Array(readFileSync(join(dir,entry.name)));
    }
  }
  collect(source);
  const tocPath = `${addon}/${addon}.toc`;
  let toc = new TextDecoder().decode(files[tocPath]);
  const version = /^## Version:\s*(\S+)/m.exec(toc)?.[1];
  if (!version) throw new Error("Missing version");
  toc = toc.replace(/^## Interface:.*$/m, `## Interface: ${api}\n## X-Guilded-Edition: ${edition}`).replaceAll("WoW Forever", edition);
  files[tocPath] = new TextEncoder().encode(toc);
  if (addon === "Guilded") files[`${addon}/Standings.lua`] = new TextEncoder().encode(EMPTY);
  const release = releaseMetadata();
  files[`${addon}/EDITION.txt`] = new TextEncoder().encode(`Guilded ${version}\nEdition: ${edition}\nInterface: ${api}\nChannel: ${release.channel}\nReal-client and two-PC checks remain pending; provisional benchmarks require in-game calibration.\nInstall this folder into this edition's Interface/AddOns. Pair a separate companion connection for each in-game guild.\n`);
  for (const [file,data] of Object.entries(files)) if(file.endsWith(".lua")) luaparse.parse(new TextDecoder().decode(data),{luaVersion:"5.1"});
  const packed = zipSync(files,{level:9}), unpacked=unzipSync(packed);
  for(const line of toc.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.endsWith(".lua")&&!s.startsWith("#"))) {
    if(!unpacked[`${addon}/${line.replaceAll("\\","/")}`]) throw new Error(`Missing ${line}`);
  }
  return {filename:`${addon}-v${version}-${edition}.zip`,packed,version,edition,interface:api,sha256:createHash("sha256").update(packed).digest("hex")};
}

export function buildEditionPackages(args=process.argv.slice(2)) {
  check();
  const apis={...EDITION_INTERFACES};
  for(const arg of args) {
    const match=/^--interface=([a-z-]+):(\d+)$/.exec(arg);
    if(!match || !GAME_EDITIONS.includes(match[1])) throw new Error(`Unknown argument: ${arg}`);
    apis[match[1]]=Number(match[2]);
  }
  const dir="dist/editions"; mkdirSync(dir,{recursive:true});
  const sourceState=releaseSource();
  if(process.env.CI && sourceState.sourceDirty) throw new Error(`CI packaging changed source: ${[...sourceState.changedPaths,...sourceState.untrackedPaths].join(", ")}`);
  const manifest={sourceCommit:sourceState.sourceCommit,dirty:sourceState.sourceDirty,clientAcceptance:"pending",packages:[]};
  for(const edition of GAME_EDITIONS) for(const addon of ["Guilded","GuildedDungeons"]) {
    const {packed,...record}=packageEdition(addon,edition,apis[edition]);
    writeFileSync(join(dir,record.filename),packed); manifest.packages.push(record);
  }
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
  console.log(`Built and verified ${manifest.packages.length} edition packages in ${dir}. Client acceptance remains pending.`);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) buildEditionPackages();
