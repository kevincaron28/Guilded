// Tells the desktop companion when a newer Guilded release is out. Two sources:
// the latest stable GitHub release, and the version of the bot this companion
// talks to (a self-hosted bot that was updated is a reason to update too, even
// when GitHub cannot be reached). Nothing is downloaded or installed here: the
// companion only shows where to get the update.
const RELEASES_API = "https://api.github.com/repos/kevincaron28/Guilded/releases/latest";
const RELEASES_PAGE = "https://github.com/kevincaron28/Guilded/releases/latest";

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
function pickUpdate(current, latest, botVersion) {
  let best = null;
  if (latest && isNewer(latest.version, current)) best = { version: parseVersion(latest.version).join("."), url: latest.url };
  if (isNewer(botVersion, current) && (!best || isNewer(botVersion, best.version))) best = { version: parseVersion(botVersion).join("."), url: RELEASES_PAGE };
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
    if (!parseVersion(body?.tag_name)) return null;
    const url = typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/") ? body.html_url : RELEASES_PAGE;
    return { version: parseVersion(body.tag_name).join("."), url };
  } catch {
    return null;
  }
}

module.exports = { parseVersion, isNewer, pickUpdate, fetchLatestRelease, RELEASES_PAGE };
