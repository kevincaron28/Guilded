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

const RELEASE_DOWNLOADS = "https://github.com/kevincaron28/Guilded/releases/download/";
const MAX_ZIP_BYTES = 20 * 1024 * 1024; // the 8.4.7 zip is 0.6 MB
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const ADDON = "Guilded";
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
function releaseAssets(version) {
  const parts = versionParts(version);
  if (!parts) return null;
  const tag = parts.join(".");
  return { version: tag, zipName: `Guilded-v${tag}-forever.zip`, zip: `${RELEASE_DOWNLOADS}v${tag}/Guilded-v${tag}-forever.zip`, sums: `${RELEASE_DOWNLOADS}v${tag}/SHA256SUMS-v${tag}.txt` };
}

/**
 * What the companion offers for the addon in the watched game folder.
 * `addon` is companion/addon-install.mjs's checkInstalledAddon result.
 * @returns {{ action: "install" | "update" | "none", reason: string, blocked?: "wow-running" }}
 */
function decideAddonInstall({ addon, companionVersion, wowRunning = false, wowEnabled = true } = {}) {
  if (!wowEnabled) return { action: "none", reason: "wow-off" };
  if (!addon || !addon.folder) return { action: "none", reason: "unchecked" };
  // Only the Forever build is published as its own zip (docs/FOREVER_ONLY_FOCUS.md).
  if (addon.expected !== "forever") return { action: "none", reason: "not-forever" };
  if (!releaseAssets(companionVersion)) return { action: "none", reason: "no-release" };
  let decision;
  if (addon.status === "not-installed") decision = { action: "install", reason: "missing" };
  else if (addon.status === "wrong-edition") decision = { action: "update", reason: "wrong-edition" };
  else if (addon.status === "ok" && addon.version && newer(companionVersion, addon.version)) decision = { action: "update", reason: "older" };
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
function safeEntryName(name) {
  const clean = String(name).replace(/\\/g, "/");
  if (clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) return null;
  const parts = clean.split("/");
  if (parts[0] !== ADDON || parts.some((part) => part === ".." || part === ".")) return null;
  return parts.filter(Boolean).join("/");
}

/**
 * Reads a zip (stored or deflated entries, no encryption, no zip64) from its central directory.
 * Every entry must sit inside Guilded/. Returns files only: [{ name, data }].
 */
function readZip(buffer) {
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
    if (rawName.endsWith("/")) { if (!safeEntryName(rawName.slice(0, -1))) throw new Error(`The addon zip holds an unexpected path: ${rawName}`); continue; }
    const name = safeEntryName(rawName);
    if (!name || name === ADDON) throw new Error(`The addon zip holds an unexpected path: ${rawName}`);
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
  if (!files.some((file) => file.name === `${ADDON}/${ADDON}.toc`)) throw new Error("The addon zip has no Guilded.toc.");
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
function installAddonFiles({ addOnsFolder, files, fs = require("node:fs"), path = nodePath, now = new Date() }) {
  const target = path.join(addOnsFolder, ADDON);
  const interfaceFolder = path.dirname(addOnsFolder);
  const staging = path.join(interfaceFolder, "Guilded-installing");
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of files) {
    const destination = path.join(staging, ...file.name.split("/").slice(1));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.data);
  }
  fs.mkdirSync(addOnsFolder, { recursive: true });
  let backup = null;
  if (fs.existsSync(target)) {
    backup = path.join(interfaceFolder, BACKUPS, `${ADDON}-${stamp(now)}`);
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

/**
 * The whole flow: release files for `companionVersion`, checksum, zip, install.
 * `addon` is the checkInstalledAddon result (its `folder` is …\Interface\AddOns\Guilded).
 */
async function installAddon({ addon, companionVersion, wowRunning = false, fetchImpl = globalThis.fetch, fs = require("node:fs"), now = new Date() }) {
  const decision = decideAddonInstall({ addon, companionVersion, wowRunning });
  if (decision.action === "none") throw new Error("The Guilded addon is already installed and up to date.");
  if (decision.blocked === "wow-running") throw new Error("Exit World of Warcraft first: WoW is running.");
  const assets = releaseAssets(companionVersion);
  const sums = (await fetchBuffer(assets.sums, fetchImpl, 1024 * 1024)).toString("utf8");
  const expected = checksumFor(sums, assets.zipName);
  const zip = await fetchBuffer(assets.zip, fetchImpl, MAX_ZIP_BYTES);
  verifyChecksum(zip, expected);
  const files = readZip(zip);
  const result = installAddonFiles({ addOnsFolder: nodePath.dirname(addon.folder), files, fs, now });
  return { ...result, action: decision.action, version: assets.version };
}

module.exports = { releaseAssets, decideAddonInstall, checksumFor, verifyChecksum, readZip, installAddonFiles, installAddon, MAX_ZIP_BYTES };
