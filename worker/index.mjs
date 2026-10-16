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
    // The selected creator domain shares this Worker with the existing Guilded
    // website. DNS/custom-domain activation is a separate owner setup step.
    const creator = ["kcaron.top", "www.kcaron.top"].includes(url.hostname);
    if (creator && ["/support", "/support/"].includes(url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      return Response.redirect("https://ko-fi.com/wowguilded", 302);
    }
    const creatorAssets = { "/": "/creator/", "/robots.txt": "/creator/robots.txt", "/sitemap.xml": "/creator/sitemap.xml" };
    if (creator && Object.hasOwn(creatorAssets, url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return failure(405, "Method not allowed");
      return env.ASSETS.fetch(new Request(new URL(creatorAssets[url.pathname], url), { method: request.method }));
    }
    const companion = url.pathname === "/companion" || url.pathname.startsWith("/companion/");
    const api = apiMethods.has(url.pathname);
    const health = url.pathname === "/health";
    // Public guild pages, served by the bot (docs/GUILD_PAGES_DESIGN.md). Guilded host only.
    const guildPage = !creator && /^\/g\/[a-z0-9-]{1,40}\/?$/.test(url.pathname);
    if (!companion && !api && !health && !guildPage) {
      if (url.pathname.startsWith("/api/")) return failure(404, "Not found");
      return env.ASSETS.fetch(request);
    }
    const methods = api ? apiMethods.get(url.pathname) : ["GET", "HEAD"];
    if (!methods.includes(request.method)) return failure(405, "Method not allowed");
    const headers = new Headers();
    // content-encoding: compressed uploads; if-none-match: "nothing changed" standings answers.
    for (const name of api ? ["content-type", "content-encoding", "x-companion-credential", "authorization", "accept", "if-none-match"] : ["accept"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Build from the fixed origin and path, never a user-supplied destination.
    const target = new URL(origin);
    target.pathname = url.pathname;
    target.search = health || guildPage ? "" : url.search;
    try {
      const body = request.method === "POST" ? await limitedBody(request) : undefined;
      const upstream = await fetch(target.href, {
        method: request.method, headers, ...(body ? { body } : {}),
        redirect: "manual", signal: AbortSignal.timeout(20_000),
        // A guild page is the same for every visitor: Cloudflare keeps it briefly so visits rarely reach the bot.
        cf: guildPage ? { cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "301": 3600, "404": 60, "500-599": 0 } } : { cacheTtl: 0, cacheEverything: false }
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        // Never follow a redirect with credentials. Only the companion's and guild pages' local
        // canonical redirects may be returned to the browser.
        const location = upstream.headers.get("location");
        const redirect = location ? new URL(location, target) : null;
        const allowed = companion ? "/companion/" : guildPage ? "/g/" : null;
        if (!allowed || !redirect || redirect.origin !== origin || !redirect.pathname.startsWith(allowed)) {
          return failure(502, "Unexpected server redirect");
        }
        return new Response(null, { status: upstream.status, headers: {
          location: redirect.pathname + redirect.search, "cache-control": "no-store"
        } });
      }
      const responseHeaders = new Headers(upstream.headers);
      if (!guildPage) responseHeaders.set("cache-control", "no-store");
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
