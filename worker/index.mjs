// One public address; personal pairing and guild authorization remain on the bot.
const origin = "https://guildedqc.duckdns.org";
const apiMethods = new Map([
  ["/api/v1/addon-imports", ["POST"]],
  ["/api/v1/addon-pairings", ["POST"]],
  ["/api/v1/standings", ["GET"]],
  ["/api/v1/poe/visits", ["GET", "POST"]],
  ["/api/v1/poe/status", ["GET"]],
  ["/api/v1/companion/logout", ["POST"]],
  ["/api/v1/manage", ["GET", "POST"]]
]);
const failure = (status, error) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new Error("body-limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const companion = url.pathname === "/companion" || url.pathname.startsWith("/companion/");
    const api = apiMethods.has(url.pathname);
    const health = url.pathname === "/health";
    if (!companion && !api && !health) {
      if (url.pathname.startsWith("/api/")) return failure(404, "Not found");
      return env.ASSETS.fetch(request);
    }
    const methods = api ? apiMethods.get(url.pathname) : ["GET", "HEAD"];
    if (!methods.includes(request.method)) return failure(405, "Method not allowed");
    const headers = new Headers();
    for (const name of api ? ["content-type", "x-companion-credential", "authorization", "accept"] : ["accept"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Build from the fixed origin and path, never a user-supplied destination.
    const target = new URL(origin);
    target.pathname = url.pathname;
    target.search = health ? "" : url.search;
    try {
      const body = request.method === "POST" ? await limitedBody(request) : undefined;
      const upstream = await fetch(target.href, {
        method: request.method, headers, ...(body ? { body } : {}),
        redirect: "manual", signal: AbortSignal.timeout(20_000),
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        // Never follow a redirect with credentials. Only the companion's local
        // canonical redirect may be returned to the browser.
        const location = upstream.headers.get("location");
        const redirect = location ? new URL(location, target) : null;
        if (!companion || !redirect || redirect.origin !== origin || !redirect.pathname.startsWith("/companion/")) {
          return failure(502, "Unexpected server redirect");
        }
        return new Response(null, { status: upstream.status, headers: {
          location: redirect.pathname + redirect.search, "cache-control": "no-store"
        } });
      }
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("cache-control", "no-store");
      responseHeaders.delete("set-cookie");
      if (companion && request.method === "GET" && upstream.status === 200
        && upstream.headers.get("content-type")?.startsWith("text/html")) {
        const html = (await upstream.text()).replace('<nav aria-label="Main navigation">',
          '<nav aria-label="Main navigation"><a class="nav" href="/">Website &amp; guides</a>');
        responseHeaders.delete("content-length");
        responseHeaders.delete("content-encoding");
        return new Response(html, { status: upstream.status, headers: responseHeaders });
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return error.message === "body-limit" ? failure(413, "Request body is too large")
        : failure(502, "The guild bot is temporarily unavailable. Try again shortly.");
    }
  }
};
