// Sideloaded APK builds cannot update through a store. This checks the public GitHub releases for a
// newer `mobile-v*` APK and lets the app show a non-blocking banner. It never downloads or installs.
import { fetchBounded, readTextBounded } from "./api";

export const RELEASES_URL = "https://api.github.com/repos/kevincaron28/Guilded/releases?per_page=15";
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_PREFIX = "https://github.com/kevincaron28/Guilded/releases/download/";
const REPO_PREFIX = "https://github.com/kevincaron28/Guilded/";

export interface ApkRelease { version: string; url: string; page: string }
export interface ApkCache { checkedAt: number; latest: ApkRelease | null }

/** Parses `mobile-v0.2.1` or `mobile-v0.2.1-preview` into numeric parts; anything else is not a mobile release. */
export function versionFromTag(tag: unknown): number[] | null {
  if (typeof tag !== "string") return null;
  const match = /^mobile-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-[A-Za-z0-9.-]{1,30})?$/.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewer(candidate: number[], installed: number[]): boolean {
  for (let index = 0; index < 3; index++) {
    if (candidate[index] !== installed[index]) return candidate[index] > installed[index];
  }
  return false;
}

interface Asset { name: string; browser_download_url: string }
function isApkAsset(item: unknown): item is Asset {
  if (!item || typeof item !== "object") return false;
  const row = item as { name?: unknown; browser_download_url?: unknown };
  return typeof row.name === "string" && /\.apk$/i.test(row.name)
    && typeof row.browser_download_url === "string" && row.browser_download_url.startsWith(DOWNLOAD_PREFIX);
}

/** Picks the highest published `mobile-v*` release that has an APK asset hosted by this repository. */
export function latestApk(body: unknown): ApkRelease | null {
  if (!Array.isArray(body)) return null;
  let best: { parts: number[]; release: ApkRelease } | null = null;
  for (const entry of body) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { tag_name?: unknown; draft?: unknown; assets?: unknown; html_url?: unknown };
    const parts = versionFromTag(row.tag_name);
    if (!parts || row.draft === true || !Array.isArray(row.assets)) continue;
    const asset = row.assets.find(isApkAsset);
    if (!asset) continue;
    if (!best || isNewer(parts, best.parts)) {
      const page = typeof row.html_url === "string" && row.html_url.startsWith(REPO_PREFIX) ? row.html_url : asset.browser_download_url;
      best = { parts, release: { version: parts.join("."), url: asset.browser_download_url, page } };
    }
  }
  return best?.release ?? null;
}

export function parseCache(raw: string | null): ApkCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { checkedAt?: unknown; latest?: unknown };
    if (typeof value.checkedAt !== "number") return null;
    const latest = value.latest as ApkRelease | null;
    if (latest && (typeof latest.version !== "string" || typeof latest.url !== "string" || typeof latest.page !== "string"
      || !latest.url.startsWith(DOWNLOAD_PREFIX) || !parseVersion(latest.version))) return null;
    return { checkedAt: value.checkedAt, latest: latest ?? null };
  } catch { return null; }
}

export interface ApkCheckDeps {
  now: number;
  installedVersion: string | undefined;
  readCache: () => Promise<string | null>;
  writeCache: (value: string) => Promise<void>;
  fetchReleases?: () => Promise<unknown>;
}

async function fetchReleases(): Promise<unknown> {
  const response = await fetchBounded(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
  // Rate limits (403/429) and outages simply mean "no news"; the cache timestamp still backs off.
  if (!response.ok) throw new Error(`releases ${response.status}`);
  return JSON.parse(await readTextBounded(response));
}

/** Returns a newer release, or null. Never throws: offline, rate-limited or malformed answers mean no banner. */
export async function checkForNewApk(deps: ApkCheckDeps): Promise<ApkRelease | null> {
  const installed = parseVersion(deps.installedVersion);
  if (!installed) return null;
  const newerOf = (release: ApkRelease | null): ApkRelease | null => {
    const parts = release && parseVersion(release.version);
    return release && parts && isNewer(parts, installed) ? release : null;
  };
  let cache: ApkCache | null = null;
  try { cache = parseCache(await deps.readCache()); } catch { cache = null; }
  if (cache && deps.now - cache.checkedAt >= 0 && deps.now - cache.checkedAt < CHECK_INTERVAL_MS) return newerOf(cache.latest);
  let latest: ApkRelease | null = cache?.latest ?? null;
  try { latest = latestApk(await (deps.fetchReleases ?? fetchReleases)()); } catch { /* keep the last known release */ }
  try { await deps.writeCache(JSON.stringify({ checkedAt: deps.now, latest })); } catch { /* the next launch checks again */ }
  return newerOf(latest);
}
