// Upload retry timing (9.4 T1.3). After a restart every companion failed at the same moment and retried on the same
// 5 s * 2^n schedule, a retry herd. The delay now carries +-30% jitter, honours the bot's Retry-After on a 429 or 503,
// and an upload that stalls fails after UPLOAD_TIMEOUT_MS (just under the website proxy's 20 s cut-off) instead of
// waiting for the proxy to cut it, so the retry starts sooner.

export const UPLOAD_TIMEOUT_MS = 18_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 300_000;
export const JITTER = 0.3;

/** Milliseconds a Retry-After header asks for (seconds or an HTTP date), or null. Capped at RETRY_MAX_MS. */
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  let ms = null;
  if (/^\d{1,6}$/.test(text)) ms = Number(text) * 1000;
  else {
    const at = Date.parse(text);
    if (Number.isFinite(at)) ms = at - now;
  }
  if (ms === null || !Number.isFinite(ms)) return null;
  return Math.min(RETRY_MAX_MS, Math.max(0, Math.round(ms)));
}

/** The Retry-After of a 429 or 503 answer, in milliseconds (null for any other answer or a missing header). */
export function retryAfterOf(response, now = Date.now()) {
  if (!response || (response.status !== 429 && response.status !== 503)) return null;
  return parseRetryAfter(response.headers?.get?.("retry-after"), now);
}

/**
 * The wait before retry number `failures` (0 for the first): min(300 s, 5 s * 2^n) with +-30% jitter, or the bot's Retry-After
 * (floored at one second) when it sent one. `random` is a 0..1 source, injectable for tests.
 */
/** @param {number} failures @param {{ retryAfterMs?: number | null, random?: () => number }} [options] */
export function retryDelay(failures, { retryAfterMs = null, random = Math.random } = {}) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs !== null && retryAfterMs >= 0) return Math.min(RETRY_MAX_MS, Math.max(1_000, Math.round(retryAfterMs)));
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(Math.max(0, failures), 6));
  const factor = 1 + JITTER * (2 * Math.min(1, Math.max(0, random())) - 1);
  return Math.max(1_000, Math.round(base * factor));
}
