#!/usr/bin/env node
/* global FormData, Blob */
// Uploads release zips to CurseForge through the official upload API, without the authors website.
//
//   node scripts/curseforge-upload.mjs --dry-run                 (checks token, versions, files; uploads nothing)
//   node scripts/curseforge-upload.mjs                           (uploads both Forever zips for package.json's version)
//   node scripts/curseforge-upload.mjs --dir <folder> --game-version 1.60.1 --type release
//
// Token: CURSEFORGE_API_TOKEN in .env.local (create it at https://legacy.curseforge.com/account/api-tokens).
// The token is sent only in the X-Api-Token header to wow.curseforge.com and is never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const dryRun = args.includes("--dry-run");

function readEnvToken() {
  if (process.env.CURSEFORGE_API_TOKEN) return process.env.CURSEFORGE_API_TOKEN.trim();
  if (!existsSync(".env.local")) return "";
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*CURSEFORGE_API_TOKEN\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) return m[1].trim();
  }
  return "";
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const dir = flag("dir", path.join(process.env.USERPROFILE ?? "", "Desktop", `guilded-release-${version}`));
const gameVersionName = flag("game-version", "1.60.1");
const releaseType = flag("type", "release");
const API = "https://wow.curseforge.com/api";

const notesFile = `docs/V${version.replaceAll(".", "_")}_RELEASE_NOTES.md`;
const changelog = existsSync(notesFile) ? readFileSync(notesFile, "utf8") : `Guilded ${version}`;

const uploads = [
  { projectId: 1712677, file: `Guilded-v${version}-forever.zip`, displayName: `Guilded ${version} (WoW Forever)` },
  { projectId: 1754138, file: `GuildedDungeons-v${version}-forever.zip`, displayName: undefined },
];

const token = readEnvToken();
if (!token) {
  console.error("CURSEFORGE_API_TOKEN is missing. Create one at https://legacy.curseforge.com/account/api-tokens and add it to .env.local.");
  process.exit(1);
}
const headers = { "X-Api-Token": token };

const versionsRes = await fetch(`${API}/game/versions`, { headers });
if (!versionsRes.ok) {
  console.error(`Game versions request failed: HTTP ${versionsRes.status}. Check the token.`);
  process.exit(1);
}
const versions = await versionsRes.json();
const matches = versions.filter(v => v.name === gameVersionName);
if (matches.length !== 1) {
  console.error(`Expected exactly one game version named ${gameVersionName}, found ${matches.length}:`, matches.map(v => `${v.id} (type ${v.gameVersionTypeID})`).join(", "));
  process.exit(1);
}
const gameVersionId = matches[0].id;
console.log(`Guilded ${version}: game version ${gameVersionName} = id ${gameVersionId}, type ${releaseType}, changelog from ${existsSync(notesFile) ? notesFile : "fallback text"}`);

for (const u of uploads) {
  const full = path.join(dir, u.file);
  if (!existsSync(full)) {
    console.error(`Missing ${full}`);
    process.exit(1);
  }
  const bytes = readFileSync(full);
  console.log(`${u.file}: ${bytes.length} bytes -> project ${u.projectId}${u.displayName ? ` as "${u.displayName}"` : ""}`);
  if (dryRun) continue;

  const metadata = { changelog, changelogType: "markdown", gameVersions: [gameVersionId], releaseType };
  if (u.displayName) metadata.displayName = u.displayName;
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("file", new Blob([bytes], { type: "application/zip" }), u.file);
  const res = await fetch(`${API}/projects/${u.projectId}/upload-file`, { method: "POST", headers, body: form });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Upload failed for ${u.file}: HTTP ${res.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`Uploaded ${u.file}: ${body}`);
}
console.log(dryRun ? "Dry run only: nothing uploaded." : "Done. CurseForge reviews new files before they appear publicly.");
