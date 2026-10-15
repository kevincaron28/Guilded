import { gzipSync } from "node:zlib";

export function credentialHeaders(config) {
  return { "x-companion-credential": config.companionCredential ?? "" };
}

export function checkUrl(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Do not put credentials in the bot address.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS for the bot address (HTTP is allowed only on this computer).");
  }
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
  checkUrl(url);
  const response = await fetch(url, {
    ...options, redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  if (response.status === 304) return { response, body: {} };
  let body;
  try { body = await response.json(); }
  catch (error) { if (response.ok) throw error; body = {}; }
  return { response, body };
}
