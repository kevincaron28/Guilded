"use strict";
// Installs or updates the Guilded addon for the member (8.5, track F3). On a fresh PC the
// AddOns folder is empty and finding _forever_\Interface\AddOns was the stumbling point, but the
// companion already knows the WoW folder. The addon and the companion share one version, and
// every GitHub release carries Guilded-v<version>-forever.zip plus SHA256SUMS-v<version>.txt:
// download that zip, check it against the release's checksum, refuse while WoW runs, back up an
// existing Guilded folder and put the new one in place.
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const nodePath = require("node:path");

// Website first, GitHub second (8 November 2026: GitHub release downloads timed out for hours): the
// website serves the release's zips under /downloads/ and lists their SHA-256 in releases.json
// (guilded.addonZips). GitHub's SHA256SUMS and zip stay the fallback.
const { fetchSiteReleases, SITE_DOWNLOADS } = require("./update-check.cjs");
const RELEASE_DOWNLOADS = "https://github.com/kevincaron28/Guilded/releases/download/";
const MAX_ZIP_BYTES = 20 * 1024 * 1024; // the 8.4.7 zip is 0.6 MB
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const ADDON = "Guilded";
// (9.1.3) Installed next to Guilded, updated with it: an older GuildedDungeons left behind made the two disagree.
const EXTRA_ADDONS = ["GuildedDungeons"];
const BACKUPS = "Guilded backups"; // next to AddOns, so WoW never sees a second copy

const VERSION = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})/;
function versionParts(value) {
  const match = VERSION.exec(String(value ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}
function newer(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}

/** The release files for this companion version, or null when the version cannot name a release. */
function releaseAssets(version, addon = ADDON) {
  const parts = versionParts(version);
  if (!parts) return null;
  const tag = parts.join(".");
  const zipName = `${addon}-v${tag}-forever.zip`;
  return { version: tag, zipName, siteZip: `${SITE_DOWNLOADS}${zipName}`, zip: `${RELEASE_DOWNLOADS}v${tag}/${zipName}`, sums: `${RELEASE_DOWNLOADS}v${tag}/SHA256SUMS-v${tag}.txt` };
}

/** The SHA-256 the website's releases.json lists for `name` (guilded.addonZips), or null. */
function siteChecksumFor(guilded, name) {
  const value = guilded?.addonZips?.[name];
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/**
 * What the companion offers for the addon in the watched game folder.
 * `addon` is companion/addon-install.mjs's checkInstalledAddon result.
 * @returns {{ action: "install" | "update" | "none", reason: string, blocked?: "wow-running" }}
 */
function decideAddonInstall({ addon, companionVersion, wowRunning = false, wowEnabled = true, force = false } = {}) {
  if (!wowEnabled) return { action: "none", reason: "wow-off" };
  if (!addon || !addon.folder) return { action: "none", reason: "unchecked" };
  // Only the Forever build is published as its own zip (docs/FOREVER_ONLY_FOCUS.md).
  if (addon.expected !== "forever") return { action: "none", reason: "not-forever" };
  if (!releaseAssets(companionVersion)) return { action: "none", reason: "no-release" };
  // (9.1.3) Installed Guilded addons (GuildedDungeons) older than this companion.
  const staleExtras = (Array.isArray(addon.extras) ? addon.extras : []).filter((extra) => EXTRA_ADDONS.includes(extra?.name) && (!extra.version || newer(companionVersion, extra.version))).map((extra) => extra.name);
  let decision;
  if (addon.status === "not-installed") decision = { action: "install", reason: "missing" };
  else if (addon.status === "wrong-edition") decision = { action: "update", reason: "wrong-edition" };
  else if (addon.status === "ok" && addon.version && newer(companionVersion, addon.version)) decision = { action: "update", reason: "older" };
  // (9.0) No version line: it cannot be shown to match this companion, so offer the update.
  else if (addon.status === "ok" && !addon.version) decision = { action: "update", reason: "unknown-version" };
  // Reinstall addon: the same version again (files damaged or changed by hand).
  else if (force && addon.status === "ok") decision = { action: "update", reason: "reinstall" };
  else if (addon.status === "ok" && staleExtras.length) decision = { action: "update", reason: "older", only: "extras", stale: staleExtras };
  else return { action: "none", reason: addon.status === "ok" ? "up-to-date" : String(addon.status) };
  // WoW reads addon files only when it starts, and Windows may hold them open: never while it runs.
  return wowRunning ? { ...decision, blocked: "wow-running" } : decision;
}

/** The hash SHA256SUMS lists for `name` ("<hex>  <name>" or "<hex> *<name>"), or null. */
function checksumFor(sums, name) {
  for (const line of String(sums ?? "").split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

/** Throws unless `buffer` hashes to `expected` (lowercase hex SHA-256). */
function verifyChecksum(buffer, expected) {
  if (!/^[0-9a-f]{64}$/.test(String(expected ?? ""))) throw new Error("The release has no checksum for the addon.");
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual !== expected) throw new Error("The addon download did not match the release checksum.");
  return true;
}

// A safe path inside the Guilded folder: no drive, no root, no "..", nothing outside Guilded/.
function safeEntryName(name, root = ADDON) {
  const clean = String(name).replace(/\\/g, "/");
  if (clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) return null;
  const parts = clean.split("/");
  if (parts[0] !== root || parts.some((part) => part === ".." || part === ".")) return null;
  return parts.filter(Boolean).join("/");
}

/**
 * Reads a zip (stored or deflated entries, no encryption, no zip64) from its central directory.
 * Every entry must sit inside Guilded/. Returns files only: [{ name, data }].
 */
function readZip(buffer, addon = ADDON) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("The addon download is not a zip file.");
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 0xffff); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error("The addon download is not a zip file.");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new Error("The addon zip has too many files.");
  const files = [];
  let unpacked = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("The addon zip is damaged.");
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const rawName = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (rawName.endsWith("/")) { if (!safeEntryName(rawName.slice(0, -1), addon)) throw new Error(`The addon zip holds an unexpected path: ${rawName}`); continue; }
    const name = safeEntryName(rawName, addon);
    if (!name || name === addon) throw new Error(`The addon zip holds an unexpected path: ${rawName}`);
    if (flags & 1) throw new Error("The addon zip is encrypted.");
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("The addon zip is damaged.");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + packed);
    if (raw.length !== packed) throw new Error("The addon zip is damaged.");
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error("The addon zip is larger than expected.");
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new Error("The addon zip uses an unsupported compression.");
    if (data.length !== size) throw new Error("The addon zip is damaged.");
    files.push({ name, data });
  }
  if (!files.some((file) => file.name === `${addon}/${addon}.toc`)) throw new Error(`The addon zip has no ${addon}.toc.`);
  return files;
}

const stamp = (now) => now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");

/**
 * Puts the zip's Guilded folder into `addOnsFolder` (…\_forever_\Interface\AddOns). The files are
 * written to a temporary folder first; an existing Guilded folder moves to
 * Interface\Guilded backups\Guilded-<time> (outside AddOns) before the new one takes its place,
 * and comes back if the swap fails.
 * @returns {{ folder: string, backup: string | null, files: number }}
 */
function installAddonFiles({ addOnsFolder, files, fs = require("node:fs"), path = nodePath, now = new Date(), addon = ADDON }) {
  const target = path.join(addOnsFolder, addon);
  const interfaceFolder = path.dirname(addOnsFolder);
  const staging = path.join(interfaceFolder, `${addon}-installing`);
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of files) {
    const destination = path.join(staging, ...file.name.split("/").slice(1));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.data);
  }
  fs.mkdirSync(addOnsFolder, { recursive: true });
  let backup = null;
  if (fs.existsSync(target)) {
    backup = path.join(interfaceFolder, BACKUPS, `${addon}-${stamp(now)}`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.renameSync(target, backup);
  }
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    if (backup) try { fs.renameSync(backup, target); backup = null; } catch { /* the backup stays where it is */ }
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { folder: target, backup, files: files.length };
}

async function fetchBuffer(url, fetchImpl, limit) {
  const response = await fetchImpl(url, { headers: { "user-agent": "Guilded-Companion" }, signal: AbortSignal.timeout(2 * 60_000) });
  if (!response.ok) throw new Error(`The addon download failed (HTTP ${response.status}).`);
  const declared = Number(response.headers?.get?.("content-length") ?? 0);
  if (declared > limit) throw new Error("The addon download is larger than expected.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error("The addon download is larger than expected.");
  return buffer;
}

/** The version line of an installed addon's .toc, or null. */
function installedVersion(addOnsFolder, name, fs = require("node:fs")) {
  try {
    const toc = fs.readFileSync(nodePath.join(addOnsFolder, name, `${name}.toc`), "utf8");
    return /^##\s*Version:\s*(\d{1,3}\.\d{1,3}\.\d{1,3})\s*$/m.exec(toc)?.[1] ?? null;
  } catch { return null; }
}

/**
 * The whole flow: release files for `companionVersion`, checksum, zip, install.
 * `addon` is the checkInstalledAddon result (its `folder` is …InterfaceAddOnsGuilded).
 * (9.1.3) Every installed Guilded addon follows: GuildedDungeons is updated too, with its own zip.
 * A failing extra never undoes Guilded's own update (it is reported in `failed`).
 */
async function installAddon({ addon, companionVersion, wowRunning = false, force = false, fetchImpl = globalThis.fetch, fs = require("node:fs"), now = new Date() }) {
  const decision = decideAddonInstall({ addon, companionVersion, wowRunning, force });
  if (decision.action === "none") throw new Error("The Guilded addon is already installed and up to date.");
  if (decision.blocked === "wow-running") throw new Error("Exit World of Warcraft first: WoW is running.");
  const addOnsFolder = nodePath.dirname(addon.folder);
  const wanted = [];
  if (decision.only !== "extras") wanted.push(ADDON);
  for (const extra of Array.isArray(addon.extras) ? addon.extras : []) {
    if (!EXTRA_ADDONS.includes(extra?.name)) continue;
    if (decision.only === "extras" ? (decision.stale ?? []).includes(extra.name) : (force || !extra.version || newer(companionVersion, extra.version))) wanted.push(extra.name);
  }
  const siteReleases = await fetchSiteReleases(fetchImpl);
  const installOne = async (name) => {
    const assets = releaseAssets(companionVersion, name);
    // The checksum: the website's releases.json when it lists this zip, otherwise the release's SHA256SUMS.
    let expected = siteChecksumFor(siteReleases, assets.zipName);
    if (!expected) {
      const sums = (await fetchBuffer(assets.sums, fetchImpl, 1024 * 1024)).toString("utf8");
      expected = checksumFor(sums, assets.zipName);
    }
    if (!/^[0-9a-f]{64}$/.test(String(expected ?? ""))) throw new Error("The release has no checksum for the addon.");
    // The zip: the website's copy, then GitHub's; either must match the one checksum.
    let zip = null, failure = null;
    for (const url of [assets.siteZip, assets.zip]) {
      try {
        const candidate = await fetchBuffer(url, fetchImpl, MAX_ZIP_BYTES);
        verifyChecksum(candidate, expected);
        zip = candidate;
        break;
      } catch (error) { failure = error; }
    }
    if (!zip) throw failure;
    const files = readZip(zip, name);
    return { name, version: assets.version, ...installAddonFiles({ addOnsFolder, files, fs, now, addon: name }) };
  };
  const done = [], failed = [];
  for (const name of wanted) {
    try { done.push(await installOne(name)); }
    catch (error) {
      if (name === ADDON) throw error;
      if (done.length === 0 && wanted.length === 1) throw error;
      failed.push({ name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const main = done.find((entry) => entry.name === ADDON) ?? done[0];
  return { folder: main.folder, backup: main.backup, files: main.files, action: decision.action, version: main.version, updated: done.map((entry) => ({ name: entry.name, folder: entry.folder, backup: entry.backup })), failed };
}

module.exports = { EXTRA_ADDONS, installedVersion, releaseAssets, siteChecksumFor, decideAddonInstall, checksumFor, verifyChecksum, readZip, installAddonFiles, installAddon, MAX_ZIP_BYTES };
