// What went wrong, for the support summary (8.5, second-PC test: the summary held no error details).
// One small record per failed upload or standings fetch, kept in the engine's state (last 5):
// time, operation, endpoint host, HTTP status, the network cause's code/name and the duration.
// Never the message text (it can quote a server's answer), a token, an ID or a path.

export const MAX_RECENT_ERRORS = 5;
const OPERATIONS = new Set(["upload", "standings"]);

/** The host of the bot address (no path, query or credentials), or null. */
export function endpointHost(uploadUrl) {
  try {
    const host = new URL(uploadUrl).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) || /^\[[0-9a-f:]+\]$/.test(host) ? host : null;
  } catch { return null; }
}

/**
 * @param {"upload" | "standings"} operation
 * @param {any} error
 * @param {{ startedAt?: number, uploadUrl?: string, now?: number }} [options]
 */
export function errorDetail(operation, error, { startedAt, uploadUrl, now = Date.now() } = {}) {
  const message = typeof error?.message === "string" ? error.message : "";
  const status = Number(error?.status ?? /\((\d{3})\)/.exec(message)?.[1]);
  const cause = error?.cause && typeof error.cause === "object" ? error.cause : null;
  const code = cause?.code ?? error?.code;
  const name = error?.name && error.name !== "Error" ? error.name : cause?.name && cause.name !== "Error" ? cause.name : null;
  return {
    at: new Date(now).toISOString(),
    operation: OPERATIONS.has(operation) ? operation : "upload",
    host: endpointHost(uploadUrl),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    code: typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : null,
    name: typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{1,40}$/.test(name) ? name : null,
    timedOut: isTimeout(error),
    durationMs: Number.isFinite(startedAt) ? Math.max(0, Math.round(now - /** @type {number} */ (startedAt))) : null
  };
}

/** Keeps the newest records only. */
export function rememberError(list, detail) {
  return [...(Array.isArray(list) ? list : []), detail].slice(-MAX_RECENT_ERRORS);
}

const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);
/** True when the request ran out of time (the server was slow), not when it could not connect. */
export function isTimeout(error) {
  const cause = error?.cause;
  return error?.name === "TimeoutError" || cause?.name === "TimeoutError" || TIMEOUT_CODES.has(cause?.code) || TIMEOUT_CODES.has(error?.code)
    || /operation was aborted due to timeout|timed out/i.test(String(error?.message ?? ""));
}
