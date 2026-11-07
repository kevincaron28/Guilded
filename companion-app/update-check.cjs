// Tells the desktop companion when a newer Guilded release is out, using
// the latest stable GitHub release. A backend version is not proof that matching
// stable clients are available. "Update now" (7.2) downloads the release's own
// installer, checks its SHA-256 against GitHub's digest and runs it; without a
// checked installer the companion only shows where to get the update.
const RELEASES_API = "https://api.github.com/repos/kevincaron28/Guilded/releases/latest";
const RELEASES_PAGE = "https://github.com/kevincaron28/Guilded/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/kevincaron28/Guilded/releases/download/";
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024;
// The stable link members use: the newest release always carries a copy of the installer under this fixed name.
const DIRECT_DOWNLOAD_URL = "https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe";
// Silent updates (8.5): a check every few hours (well under GitHub's anonymous limit of 60 requests an hour),
// and at most this many failed installer runs before a downloaded update is dropped and fetched again.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_INSTALL_ATTEMPTS = 2;
const STAGED_NAME = /^Guilded\.Companion\.Setup\.\d+\.\d+\.\d+\.exe$/;

// "6.5.1" -> [6, 5, 1]; anything else (a "-beta" suffix, a typo) -> null.
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// The update to suggest, or null. `latest` is { version, url } from GitHub (or null).
function pickUpdate(current, latest) {
  let best = null;
  if (latest && isNewer(latest.version, current)) best = { version: parseVersion(latest.version).join("."), url: latest.url, ...(latest.installer ? { installer: latest.installer } : {}) };
  return best;
}

// The latest stable release, or null when GitHub is unreachable or answers oddly.
async function fetchLatestRelease(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Guilded-Companion" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.draft || body?.prerelease || !parseVersion(body?.tag_name)) return null;
    const url = typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/") ? body.html_url : RELEASES_PAGE;
    const version = parseVersion(body.tag_name).join(".");
    const installer = installerFrom(body.assets, version);
    return { version, url, ...(installer ? { installer } : {}) };
  } catch {
    return null;
  }
}

// The release's Windows installer, only with GitHub's SHA-256 digest and from this repository.
function installerFrom(assets, version) {
  if (!Array.isArray(assets)) return null;
  const name = `Guilded.Companion.Setup.${version}.exe`;
  const asset = assets.find((item) => item?.name === name);
  if (!asset || typeof asset.browser_download_url !== "string" || !asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)) return null;
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest ?? ""))?.[1];
  if (!sha256 || !Number.isInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_BYTES) return null;
  return { name, url: asset.browser_download_url, size: asset.size, sha256 };
}

// Downloads the installer to `target`, refusing a wrong size or checksum (the file is then removed).
async function downloadInstaller(installer, target, { fetchImpl = globalThis.fetch, fs = require("node:fs"), onProgress = () => {} } = {}) {
  const { createHash } = require("node:crypto");
  if (!installer?.url?.startsWith(DOWNLOAD_PREFIX)) throw new Error("This update has no checked installer.");
  const response = await fetchImpl(installer.url, { headers: { "user-agent": "Guilded-Companion" }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
  const hash = createHash("sha256");
  const partial = `${target}.part`;
  const file = await fs.promises.open(partial, "w");
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > installer.size) throw new Error("The download is larger than the release says.");
      hash.update(chunk);
      await file.write(chunk);
      onProgress(received / installer.size);
    }
    await file.close();
    if (received !== installer.size) throw new Error("The download was incomplete.");
    if (hash.digest("hex") !== installer.sha256) throw new Error("The download did not match the release checksum.");
    fs.renameSync(partial, target);
    return target;
  } catch (error) {
    await file.close().catch(() => {});
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

// spawn errors are asynchronous (ENOENT/EACCES); a surrounding try/catch alone
// cannot catch them. Only quit the app after Windows accepts the installer.
function launchInstaller(target, spawn = require("node:child_process").spawn, args = ["/S", "--updated", "--force-run"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(target, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

// The Microsoft Store (MSIX) package updates itself through the Store and must never replace itself.
function isStoreInstall({ windowsStore, execPath } = {}) {
  return windowsStore === true || /[\\/]WindowsApps[\\/]/i.test(String(execPath ?? ""));
}

// Whether the companion may fetch and install updates without being asked. Only the packaged
// direct-download (NSIS) build on Windows, and only while the member has not turned it off.
function decideAutoUpdate({ store, packaged, platform = "win32", enabled, current, latest, pending }) {
  if (store) return { action: "skip", reason: "store" };
  if (!packaged || platform !== "win32") return { action: "skip", reason: "unpackaged" };
  if (enabled === false) return { action: "skip", reason: "disabled" };
  const update = pickUpdate(current, latest);
  if (!update) return { action: "none" };
  if (!update.installer) return { action: "skip", reason: "no-checked-installer" };
  if (pending?.version === update.version && pending?.sha256 === update.installer.sha256) return { action: "staged", update };
  return { action: "download", update };
}

// SHA-256 of a file, read in chunks so a 120 MB installer is never held in memory (also works at quit).
function hashFileSync(file, fs = require("node:fs")) {
  const { createHash } = require("node:crypto");
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

// What to do with an installer downloaded earlier: "none" (nothing staged), "clear" (stale, damaged, tampered
// with or tried too often: forget it) or "install" (still newer than this build and matching its checksum).
function inspectPending({ pending, current, directory, fs = require("node:fs"), path = require("node:path") }) {
  if (!pending) return { action: "none" };
  const shape = typeof pending.version === "string" && typeof pending.file === "string" && /^[0-9a-f]{64}$/.test(String(pending.sha256));
  if (!shape) return { action: "clear", reason: "invalid" };
  if (!isNewer(pending.version, current)) return { action: "clear", reason: "installed" };
  const file = path.resolve(pending.file);
  if (path.dirname(file) !== path.resolve(directory) || !STAGED_NAME.test(path.basename(file))) return { action: "clear", reason: "location" };
  if ((pending.attempts ?? 0) >= MAX_INSTALL_ATTEMPTS) return { action: "clear", reason: "attempts" };
  try {
    if (hashFileSync(file, fs) !== pending.sha256) return { action: "clear", reason: "checksum" };
  } catch { return { action: "clear", reason: "missing" }; }
  return { action: "install", file, version: parseVersion(pending.version).join(".") };
}

// Used while the app is exiting: start the silent installer and return at once. It does not restart
// the companion (the member just quit it); the new version runs the next time it is opened.
function launchInstallerOnExit(target, spawn = require("node:child_process").spawn) {
  try {
    spawn(target, ["/S", "--updated"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch { return false; }
}

// The Microsoft Store listing itself (not the Store's general Downloads page): one click from the
// companion lands on Guilded Companion, where the Store shows Update when one is waiting.
const STORE_LISTING = "ms-windows-store://pdp/?ProductId=9N680XX3QFL9";

/**
 * The version panel (9.0.x, owner request 7 November): what is installed, what is out, and the one
 * thing to do. Pure, so every state is tested without Electron.
 * @param {{ current: string, latest?: { version: string } | null, pending?: { version: string } | null,
 *   pendingReady?: boolean, store?: boolean, storeUpdate?: { version?: string } | null,
 *   checkedAt?: string | null, checkFailed?: boolean, autoUpdate?: boolean, installing?: boolean }} input
 * @returns {{ installed: string, latest: string | null, status: string, action: string | null }}
 *   status: installing | update-ready | update-available | up-to-date | unknown |
 *           store-update | store-up-to-date | store-unknown
 *   action: install-now | update-now | check | open-store | null
 */
function versionStatus({ current, latest = null, pending = null, pendingReady = false, store = false, storeUpdate = null, checkedAt = null, checkFailed = false, autoUpdate = true, installing = false }) {
  const latestVersion = latest && parseVersion(latest.version) ? parseVersion(latest.version).join(".") : null;
  const base = { installed: String(current), latest: latestVersion, checkedAt: checkedAt || null, autoUpdate: autoUpdate !== false };
  if (store) {
    if (storeUpdate || (latestVersion && isNewer(latestVersion, current))) return { ...base, status: "store-update", action: "open-store" };
    if (latestVersion) return { ...base, status: "store-up-to-date", action: "open-store" };
    return { ...base, status: "store-unknown", action: "open-store" };
  }
  if (installing) return { ...base, status: "installing", action: null };
  // Downloaded and checked already: it installs at the next quit or start, or now with one click.
  if (pendingReady && pending && isNewer(pending.version, current)) return { ...base, latest: latestVersion || parseVersion(pending.version).join("."), status: "update-ready", action: "install-now" };
  if (latestVersion && isNewer(latestVersion, current)) return { ...base, status: "update-available", action: "update-now" };
  if (latestVersion) return { ...base, status: "up-to-date", action: null };
  return { ...base, status: "unknown", action: "check", ...(checkFailed ? { checkFailed: true } : {}) };
}

module.exports = { versionStatus, STORE_LISTING, parseVersion, isNewer, pickUpdate, fetchLatestRelease, installerFrom, downloadInstaller, launchInstaller, isStoreInstall, decideAutoUpdate, hashFileSync, inspectPending, launchInstallerOnExit, RELEASES_PAGE, DIRECT_DOWNLOAD_URL, CHECK_INTERVAL_MS };
