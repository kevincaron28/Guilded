import { gzipSync } from "node:zlib";
import { noteBotClock } from "./group-relay.mjs";

// Compatibility (docs/COMPAT_POLICY.md): the app sets its release once, every API request names it, and the bot
// counts versions and can tell this companion it is below the support window. Older bots ignore the header.
let companionVersion = null;
let addonVersion = null;
const CLEAN_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export function setCompanionVersion(value) { companionVersion = typeof value === "string" && CLEAN_VERSION.test(value) ? value : null; }
/** The addon release that wrote the saved file this companion last read (sent as x-companion-addon-version). */
export function setAddonVersion(value) { addonVersion = typeof value === "string" && CLEAN_VERSION.test(value) ? value : null; }
export function versionHeaders() {
  return { ...(companionVersion ? { "x-companion-version": companionVersion } : {}), ...(addonVersion ? { "x-companion-addon-version": addonVersion } : {}) };
}

export function credentialHeaders(config) {
  return { "x-companion-credential": config.companionCredential ?? "", ...versionHeaders() };
}

export function checkUrl(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Do not put credentials in the bot address.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS for the bot address (HTTP is allowed only on this computer).");
  }
  // Migrate only our retired hosted address, before attaching credentials.
  // Other guilds' independent hosts are preserved exactly.
  if (url.origin === "https://guildedqc.duckdns.org") url.hostname = "guilded.kcaron.top";
  return url;
}

// The bot accepts at most this much as sent, compressed or not.
export const MAX_UPLOAD_BYTES = 1_000_000;

// A JSON request body, gzip-compressed when the bot can read that (JSON shrinks several times).
export function jsonBody(value, { gzip = false } = {}) {
  const text = JSON.stringify(value);
  if (!gzip) return { body: text, bytes: Buffer.byteLength(text), headers: { "content-type": "application/json" } };
  const body = gzipSync(text);
  return { body, bytes: body.byteLength, headers: { "content-type": "application/json", "content-encoding": "gzip" } };
}

// Do not forward credentials across redirects. Bound both headers and response-body reads.
export async function requestJson(url, options = {}, signal, timeoutMs = 20_000) {
  const target = checkUrl(url);
  const response = await fetch(target, {
    ...options, redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  noteBotClock(response.headers?.get?.("date"));
  if (response.status === 304) return { response, body: {} };
  let body;
  try { body = await response.json(); }
  catch (error) { if (response.ok) throw error; body = {}; }
  return { response, body };
}

// Sync protocols this companion can speak (docs/COMPAT_POLICY.md). The bot advertises protocolVersion (its newest)
// and minProtocol (its oldest, defaulting to protocolVersion for bots from before ranges): usable when the ranges overlap.
export const MIN_KNOWN_PROTOCOL = 2;
export const MAX_KNOWN_PROTOCOL = 2;
export function protocolSupported(body) {
  const newest = body?.protocolVersion;
  if (!Number.isInteger(newest)) return false;
  const oldest = Number.isInteger(body.minProtocol) ? body.minProtocol : newest;
  return newest >= MIN_KNOWN_PROTOCOL && oldest <= MAX_KNOWN_PROTOCOL;
}
