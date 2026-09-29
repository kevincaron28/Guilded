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

// Do not forward credentials across redirects. Bound both headers and response-body reads.
export async function requestJson(url, options = {}, signal) {
  checkUrl(url);
  const response = await fetch(url, {
    ...options, redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)
  });
  let body;
  try { body = await response.json(); }
  catch (error) { if (response.ok) throw error; body = {}; }
  return { response, body };
}
