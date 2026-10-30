// Tells the desktop companion when a newer Guilded release is out. Two sources:
// the latest stable GitHub release. A backend version is not proof that matching
// stable clients are available. "Update now" (7.2) downloads the release's own
// installer, checks its SHA-256 against GitHub's digest and runs it; without a
// checked installer the companion only shows where to get the update.
const RELEASES_API = "https://api.github.com/repos/kevincaron28/Guilded/releases/latest";
const RELEASES_PAGE = "https://github.com/kevincaron28/Guilded/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/kevincaron28/Guilded/releases/download/";
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024;

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
function launchInstaller(target, spawn = require("node:child_process").spawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(target, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

module.exports = { parseVersion, isNewer, pickUpdate, fetchLatestRelease, installerFrom, downloadInstaller, launchInstaller, RELEASES_PAGE };
