// Verify the actual local release files and regenerate their publication checksums.
// No credentials, production writes, installer execution, or bot startup.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import { releaseMetadata } from "./release-metadata.mjs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const release = releaseMetadata();
for (const path of ["package-lock.json", "companion-app/package.json", "companion-app/package-lock.json"]) {
  assert.equal(JSON.parse(readFileSync(path, "utf8")).version, version, `${path}: version mismatch`);
}
const zipPath = `dist/Guilded-v${version}.zip`;
const dungeonsZipPath = `dist/GuildedDungeons-v${version}.zip`;
const installerPath = `dist/companion/Guilded Companion Setup ${version}.exe`;
const notesPath = `dist/Guilded-v${version}-Release-Notes.md`;
const files = unzipSync(readFileSync(zipPath));
const toc = Buffer.from(files["Guilded/Guilded.toc"]).toString("utf8");
assert.match(toc, new RegExp(`^## Version: ${version.replaceAll(".", "\\.")}$`, "m"));
assert.ok(files["Guilded/INSTALL.md"], "Missing member installation guide");
for (const path of Object.keys(files)) {
  assert.ok(path.startsWith("Guilded/") && !path.includes(".."), `Unsafe archive path: ${path}`);
  assert.ok(!/(?:^|\/)(?:\.env[^/]*|config\.json|SavedVariables|RaidTools\.lua)$/i.test(path), `Private or removed file: ${path}`);
}
for (const path of toc.split(/\r?\n/).map(line => line.trim()).filter(line => line.endsWith(".lua"))) {
  assert.ok(files[`Guilded/${path.replaceAll("\\", "/")}`], `Missing TOC file: ${path}`);
}
const standings = Buffer.from(files["Guilded/Standings.lua"]).toString("utf8");
assert.match(standings, /players = \{\}/);
assert.match(standings, /GuildedLedgerAccepted = \{\}/);
assert.doesNotMatch(standings, /credential|discordId|sourceRef|GuildedDB/i);
// Guilded Dungeons is part of the same release, not an optional unchecked ZIP.
const dungeonsFiles = unzipSync(readFileSync(dungeonsZipPath));
const dungeonsToc = Buffer.from(dungeonsFiles["GuildedDungeons/GuildedDungeons.toc"]).toString("utf8");
assert.match(dungeonsToc, new RegExp(`^## Version: ${version.replaceAll(".", "\\.")}$`, "m"));
assert.doesNotMatch(dungeonsToc, /^## (?:RequiredDeps|Dependencies):/mi);
for (const path of Object.keys(dungeonsFiles)) {
  assert.ok(/^GuildedDungeons\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes(".."), `Unsafe dungeon archive path: ${path}`);
  assert.ok(!/(?:^|\/)(?:\.env[^/]*|config\.json|SavedVariables)$/i.test(path), `Private dungeon file: ${path}`);
  assert.deepEqual(Buffer.from(dungeonsFiles[path]), readFileSync(join("addon", path)), `Stale dungeon artifact: ${path}`);
}
for (const path of dungeonsToc.split(/\r?\n/).map(line => line.trim()).filter(line => line.endsWith(".lua") && !line.startsWith("#"))) {
  assert.ok(dungeonsFiles[`GuildedDungeons/${path.replaceAll("\\", "/")}`], `Missing dungeon TOC file: ${path}`);
}
assert.ok(dungeonsFiles["GuildedDungeons/README.md"] && dungeonsFiles["GuildedDungeons/LICENSE.txt"], "Missing standalone instructions/license");
assert.equal(Buffer.from(dungeonsFiles["GuildedDungeons/Accepted.lua"]).toString("utf8").replaceAll("\r\n", "\n"),
  "-- Replaced by your paired companion. Keeps Guilded's list when both addons are installed.\nGuildedDungeonAccepted = GuildedDungeonAccepted or {}\n",
  "Standalone package contains personal accepted/public scores");
const require = createRequire(new URL("../companion-app/package.json", import.meta.url));
const { extractFile } = require("@electron/asar");
const asar = "dist/companion/win-unpacked/resources/app.asar";
assert.equal(JSON.parse(extractFile(asar, "package.json").toString()).version, version);
for (const path of ["main.cjs", "preload.cjs", "detect-wow.cjs", "update-check.cjs"]) {
  assert.deepEqual(extractFile(asar, path), readFileSync(join("companion-app", path)), `Stale packaged companion: ${path}`);
}
const companionPackage = JSON.parse(readFileSync("companion-app/package.json", "utf8"));
for (const resource of companionPackage.build.extraResources.filter(resource => resource.from === "../companion")) {
  for (const path of resource.filter) {
    assert.deepEqual(readFileSync(join("dist/companion/win-unpacked/resources", resource.to, path)),
      readFileSync(join("companion", path)), `Stale packaged engine: ${path}`);
  }
}
const installer = readFileSync(installerPath);
assert.equal(installer.subarray(0, 2).toString(), "MZ", "Installer is not a Windows executable");
writeFileSync(notesPath, release.notesText);
const artifacts = [zipPath, dungeonsZipPath, installerPath, notesPath].map(path => ({
  // GitHub normalizes spaces in uploaded asset names to periods.
  name: basename(path).replaceAll(" ", "."), localPath: path, bytes: readFileSync(path).length,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));
writeFileSync(`dist/Guilded-v${version}-SHA256SUMS.txt`, artifacts.map(file => `${file.sha256}  ${file.name}`).join("\n") + "\n");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim());
writeFileSync(`dist/Guilded-v${version}-Artifact-Verification.json`, JSON.stringify({
  version, channel: release.channel, acceptance: release.acceptance, sourceCommit, sourceDirty, verifiedAt: new Date().toISOString(),
  archiveFiles: Object.keys(files).length, dungeonsArchiveFiles: Object.keys(dungeonsFiles).length, artifacts,
  limitations: ["Unverified real-client follow-up is tracked separately", "Windows installer is unsigned", "Installer execution is not verified by this check"],
}, null, 2) + "\n");
console.log(`Verified ${version} ${release.channel} addons (${Object.keys(files).length} + ${Object.keys(dungeonsFiles).length} files), packaged companion source and installer; regenerated notes and SHA-256 sums. Source dirty: ${sourceDirty}.`);
