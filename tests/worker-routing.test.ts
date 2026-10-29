import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";

afterEach(() => vi.unstubAllGlobals());
const base = "https://guilded-wow.kcaron.workers.dev";
const env = { ASSETS: { fetch: vi.fn(async () => new Response("website")) } };

describe("unified website and companion", () => {
  it("sets the private origin credential exclusively from Worker configuration", async () => {
    const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    const request = () => new Request(base + "/api/v1/companion/sign-in", { method: "POST", headers: { "x-guilded-origin": "caller-controlled", "x-guilded-edition": "retail" } });
    await worker.fetch(request(), { ...env, GUILDED_ORIGIN_TOKEN: "proxy-configured" });
    let headers = upstream.mock.calls.at(-1)![1].headers as Headers;
    expect(headers.get("x-guilded-origin")).toBe("proxy-configured");
    expect(headers.get("x-guilded-edition")).toBe("retail");
    await worker.fetch(request(), env);
    headers = upstream.mock.calls.at(-1)![1].headers as Headers;
    expect(headers.has("x-guilded-origin")).toBe(false);
  });
  it("proxies score-card PNG bytes and headers without the HTML rewrite", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "no-store" } }));
    vi.stubGlobal("fetch", upstream);
    for (const path of ["/leaderboards/character/K%C3%A9vin-Forever/card.png?lang=fr", "/leaderboards/run/r1/card.png"]) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${path}`), env);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(upstream.mock.calls.at(-1)?.[0]).toBe(`https://guildedqc.duckdns.org${path}`);
    }
  });
  it("serves the creator page only at the selected creator domain root", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    for (const hostname of ["kcaron.top", "www.kcaron.top"]) {
      const asset = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("creator"));
      const response = await worker.fetch(new Request(`https://${hostname}/`, { headers: { authorization: "Bearer private" } }), { ASSETS: { fetch: asset } });
      expect(await response.text()).toBe("creator");
      const request = asset.mock.calls[0]![0] as Request;
      expect(request.url).toBe(`https://${hostname}/creator/`);
      expect(request.headers.get("authorization")).toBeNull();
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("keeps the Guilded homepage on the existing address and Guilded subdomain", async () => {
    for (const hostname of ["guilded-wow.kcaron.workers.dev", "guilded.kcaron.top"]) {
      const asset = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("guilded"));
      const request = new Request(`https://${hostname}/`);
      expect(await (await worker.fetch(request, { ASSETS: { fetch: asset } })).text()).toBe("guilded");
      expect(asset).toHaveBeenCalledWith(request);
    }
  });

  it("keeps each site's robots and sitemap on the matching hostname", async () => {
    const creatorAsset = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("creator index"));
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      await worker.fetch(new Request(`https://kcaron.top${path}`), { ASSETS: { fetch: creatorAsset } });
      expect(creatorAsset.mock.calls.at(-1)![0].url).toBe(`https://kcaron.top/creator${path}`);
      const guildAsset = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("guilded index"));
      const request = new Request(`https://guilded.kcaron.top${path}`);
      await worker.fetch(request, { ASSETS: { fetch: guildAsset } });
      expect(guildAsset).toHaveBeenCalledWith(request);
    }
  });

  it("serves Google's exact verification URL on both hosts without a clean-URL redirect", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    for (const hostname of ["kcaron.top", "guilded.kcaron.top"]) {
      for (const method of ["GET", "HEAD"]) {
        const asset = vi.fn(async (request: Request) => {
          if (new URL(request.url).pathname.endsWith(".html")) {
            return new Response(null, { status: 307, headers: { location: "/googlefc463a9e1454c920" } });
          }
          return new Response(request.method === "HEAD" ? null : "google-site-verification: googlefc463a9e1454c920.html");
        });
        const response = await worker.fetch(new Request(`https://${hostname}/googlefc463a9e1454c920.html`, {
          method, headers: { authorization: "Bearer private", cookie: "private=1" }
        }), { ASSETS: { fetch: asset } });
        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();
        expect(await response.text()).toBe(method === "HEAD" ? "" : "google-site-verification: googlefc463a9e1454c920.html");
        expect(asset.mock.calls[0]![0].headers.get("authorization")).toBeNull();
        expect(asset.mock.calls[0]![0].headers.get("cookie")).toBeNull();
      }
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects writes to Google verification files before accessing assets", async () => {
    const asset = vi.fn();
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await worker.fetch(new Request("https://kcaron.top/googlefc463a9e1454c920.html", { method }), {
        ASSETS: { fetch: asset }
      })).status).toBe(405);
    }
    expect(asset).not.toHaveBeenCalled();
  });

  it("keeps creator HEAD requests bodyless and rejects writes before serving assets", async () => {
    const asset = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null));
    await worker.fetch(new Request("https://kcaron.top/", { method: "HEAD" }), { ASSETS: { fetch: asset } });
    expect((asset.mock.calls[0]![0] as Request).method).toBe("HEAD");
    asset.mockClear();
    expect((await worker.fetch(new Request("https://kcaron.top/", { method: "POST" }), { ASSETS: { fetch: asset } })).status).toBe(405);
    expect(asset).not.toHaveBeenCalled();
  });

  it("redirects the creator support address to the verified Ko-fi page without query data", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const asset = vi.fn();
    const response = await worker.fetch(new Request("https://kcaron.top/support?private=example", { headers: { authorization: "Bearer private" } }), { ASSETS: { fetch: asset } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://ko-fi.com/wowguilded");
    expect(upstream).not.toHaveBeenCalled();
    expect(asset).not.toHaveBeenCalled();
  });

  it("serves the website locally without forwarding credentials", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(base + "/docs/QUICK_START", { headers: { authorization: "Bearer private" } }), env);
    expect(await response.text()).toBe("website");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards POST body, credential and guild query only to the fixed bot, never caches private responses", async () => {
    const upstream = vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "public", "set-cookie": "unexpected=1" } }));
    vi.stubGlobal("fetch", upstream);
    const body = JSON.stringify({ guildDiscordId: "123", export: {} });
    const response = await worker.fetch(new Request(base + "/api/v1/addon-imports?guild=123", {
      method: "POST", body, headers: { "content-type": "application/json", "x-companion-credential": "personal", cookie: "private=1", "x-forwarded-for": "spoofed" }
    }), env);
    const [url, options] = upstream.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://guildedqc.duckdns.org/api/v1/addon-imports?guild=123");
    expect(new TextDecoder().decode(options.body as Uint8Array)).toBe(body);
    expect(new Headers(options.headers).get("x-companion-credential")).toBe("personal");
    expect(new Headers(options.headers).get("cookie")).toBeNull();
    expect(new Headers(options.headers).get("x-forwarded-for")).toBeNull();
    expect(options.redirect).toBe("manual");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("passes Guilded's own headers through but never proxy or address headers", async () => {
    const upstream = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", upstream);
    await worker.fetch(new Request(base + "/api/v1/standings?guild=123", { headers: {
      "x-guilded-protocol": "2", "x-companion-version": "6.2.0", "x-forwarded-for": "spoofed", "x-real-ip": "spoofed",
      "x-guilded-long": "y".repeat(600)
    } }), env);
    const sent = new Headers((upstream.mock.calls[0]! as unknown as [string, RequestInit])[1].headers);
    expect(sent.get("x-guilded-protocol")).toBe("2");
    expect(sent.get("x-companion-version")).toBe("6.2.0");
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(sent.get("x-real-ip")).toBeNull();
    expect(sent.get("x-guilded-long")).toBeNull();
    // Website pages never forward them.
    upstream.mockClear();
    await worker.fetch(new Request(base + "/companion/", { headers: { "x-guilded-protocol": "2" } }), env);
    expect(new Headers((upstream.mock.calls[0]! as unknown as [string, RequestInit])[1].headers).get("x-guilded-protocol")).toBeNull();
  });

  it("blocks unknown API paths, disallowed methods and oversized bodies before reaching the bot", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(base + "/api/v1/admin"), env)).status).toBe(404);
    expect((await worker.fetch(new Request(base + "/api/v1/standings", { method: "DELETE" }), env)).status).toBe(405);
    expect((await worker.fetch(new Request(base + "/api/v1/addon-imports", { method: "POST", body: "x".repeat(1_000_001) }), env)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not forward pairing credentials on redirects", async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.example/" } }));
    vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(base + "/api/v1/standings?guild=123", { headers: { "x-companion-credential": "personal" } }), env)).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("keeps the companion canonical redirect on the public address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://guildedqc.duckdns.org/companion/?guild=123" } })));
    const response = await worker.fetch(new Request(base + "/companion?guild=123"), env);
    expect(response.headers.get("location")).toBe("/companion/?guild=123");
  });

  it("adds a website link to the proxied companion while retaining its security headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<nav aria-label="Main navigation"><button>Overview</button></nav>', {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'", "content-length": "72" }
    })));
    const response = await worker.fetch(new Request(base + "/companion/"), env);
    expect(await response.text()).toContain('href="/">Website &amp; guides</a>');
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("reports backend downtime without leaking upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream detail"); }));
    const response = await worker.fetch(new Request(base + "/health?ignored=1"), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private upstream detail");
  });
  it("forwards guild pages without query or credentials and lets Cloudflare cache them briefly", async () => {
    const upstream = vi.fn(async () => new Response("<h1>Quebec Gold</h1>", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/g/quebec-gold/?utm=x", { headers: { authorization: "Bearer private", cookie: "a=1" } }), env);
    const [url, options] = upstream.mock.calls[0]! as unknown as [string, RequestInit & { cf: { cacheEverything: boolean } }];
    expect(url).toBe("https://guildedqc.duckdns.org/g/quebec-gold/");
    expect(new Headers(options.headers).get("authorization")).toBeNull();
    expect(new Headers(options.headers).get("cookie")).toBeNull();
    expect(options.cf.cacheEverything).toBe(true);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.text()).toContain("Quebec Gold");
  });

  it("keeps guild pages on the Guilded host, read-only and within /g/", async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://guildedqc.duckdns.org/g/quebec-gold/" } }));
    vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(base + "/g/quebec-gold"), env)).headers.get("location")).toBe("/g/quebec-gold/");
    expect((await worker.fetch(new Request(base + "/g/quebec-gold/", { method: "POST", body: "x" }), env)).status).toBe(405);
    const asset = vi.fn(async () => new Response("website"));
    for (const path of ["https://kcaron.top/g/quebec-gold/", base + "/g/quebec-gold/admin", base + "/g/Quebec_Gold/"]) {
      await worker.fetch(new Request(path), { ASSETS: { fetch: asset } });
    }
    expect(asset).toHaveBeenCalledTimes(3);
    upstream.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "https://guildedqc.duckdns.org/companion/" } }));
    expect((await worker.fetch(new Request(base + "/g/quebec-gold/"), env)).status).toBe(502);
  });
  it("sends Quebec Gold's retired WoW pages to its live guild page", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    for (const path of ["/quebec-gold/cores/", "/quebec-gold/wow", "/quebec-gold/wow/"]) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${path}`), env);
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe("/g/quebec-gold/");
    }
    const asset = vi.fn(async () => new Response("community"));
    await worker.fetch(new Request("https://guilded.kcaron.top/quebec-gold/poe2/"), { ASSETS: { fetch: asset } });
    expect(asset).toHaveBeenCalledTimes(1);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("signed-in website pages (7.0)", () => {
  const site = "https://guilded.kcaron.top";
  const session = "__Host-guilded_session=abc.sig; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax";

  it("forwards the session cookie, Origin and the form, and returns only Guilded's own cookies", async () => {
    const upstream = vi.fn(async () => {
      const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
      headers.append("set-cookie", session);
      headers.append("set-cookie", "tracker=1; Path=/");
      headers.append("set-cookie", "__Host-guilded_session=x; Domain=evil.example; Path=/");
      return new Response("<h1>ok</h1>", { headers });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(site + "/me/card", {
      method: "POST", body: "csrf=t&character=Kev",
      headers: { cookie: "__Host-guilded_session=abc.sig", origin: site, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "spoofed", authorization: "Bearer x" }
    }), env);
    const [url, options] = upstream.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://guildedqc.duckdns.org/me/card");
    const sent = new Headers(options.headers);
    expect(sent.get("cookie")).toBe("__Host-guilded_session=abc.sig");
    expect(sent.get("origin")).toBe(site);
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(new TextDecoder().decode(options.body as Uint8Array)).toBe("csrf=t&character=Kev");
    expect(response.headers.getSetCookie()).toEqual([session]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets only /auth/login send the browser to Discord's sign-in page", async () => {
    const discord = "https://discord.com/oauth2/authorize?client_id=1&scope=identify";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: discord } })));
    const login = await worker.fetch(new Request(site + "/auth/login?return=/recruitment/"), env);
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe(discord);
    expect((await worker.fetch(new Request(site + "/recruitment/"), env)).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/oauth2/authorize" } })));
    expect((await worker.fetch(new Request(site + "/auth/login"), env)).status).toBe(502);
  });

  it("returns local redirects with the new session cookie, and keeps other paths static", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { const headers = new Headers({ location: "/recruitment/" }); headers.append("set-cookie", session); return new Response(null, { status: 302, headers }); }));
    const callback = await worker.fetch(new Request(site + "/auth/callback?code=a&state=b"), env);
    expect(callback.headers.get("location")).toBe("/recruitment/");
    expect(callback.headers.getSetCookie()).toEqual([session]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "/companion/" } })));
    expect((await worker.fetch(new Request(site + "/me/"), env)).status).toBe(502);
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(site + "/recruitment/", { method: "DELETE" }), env)).status).toBe(405);
    expect((await worker.fetch(new Request(site + "/auth/other"), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://kcaron.top/recruitment/"), env)).status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("public dungeon run uploads (7.0)", () => {
  it("proxies public player pages and the authenticated visibility form through the website boundary", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>(async () => new Response("profile")); vi.stubGlobal("fetch", upstream);
    const result = await worker.fetch(new Request("https://guilded.kcaron.top/players/c111111111111111111111111?lang=fr"), env);
    expect(await result.text()).toBe("profile");
    expect(upstream.mock.calls[0]![0]).toBe("https://guildedqc.duckdns.org/players/c111111111111111111111111?lang=fr");
    const post = await worker.fetch(new Request("https://guilded.kcaron.top/me/profile", { method: "POST", headers: { origin: "https://guilded.kcaron.top", "content-type": "application/x-www-form-urlencoded" }, body: "public=false" }), env);
    expect(post.status).toBe(200);
  });
  it("forwards the personal companion's upload with its credential, POST only", async () => {
    const upstream = vi.fn(async () => Response.json({ accepted: [] })); vi.stubGlobal("fetch", upstream);
    await worker.fetch(new Request("https://guilded.kcaron.top/api/v1/public-runs", { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-companion-credential": "personal", cookie: "a=1" } }), env);
    const [url, options] = upstream.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://guildedqc.duckdns.org/api/v1/public-runs");
    const sent = new Headers(options.headers);
    expect(sent.get("x-companion-credential")).toBe("personal");
    expect(sent.get("cookie")).toBeNull();
    expect((await worker.fetch(new Request("https://guilded.kcaron.top/api/v1/public-runs"), env)).status).toBe(405);
  });
});

// 29 October 2026: Cloudflare failed to look up the DuckDNS origin on 9 of 20 visits (error 1016,
// status 530). The Worker retries, can use an owner-managed hostname first, and shows a real page.
describe("unreachable bot origin", () => {
  const dnsError = () => new Response("error code: 1016", { status: 530 });
  it("retries a failed origin lookup and returns the page once the bot answers", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(dnsError()).mockResolvedValueOnce(new Response("leaderboards", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/leaderboards/?lang=fr", { headers: { accept: "text/html" } }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("leaderboards");
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("tries the configured hostname first and keeps DuckDNS as the fallback", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>().mockResolvedValueOnce(dnsError()).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    await worker.fetch(new Request("https://guilded.kcaron.top/players/?class=Mage"), { ...env, GUILDED_ORIGIN_URL: "https://bot.kcaron.top" });
    expect(upstream.mock.calls.map(call => call[0])).toEqual(["https://bot.kcaron.top/players/?class=Mage", "https://guildedqc.duckdns.org/players/?class=Mage"]);
    for (const invalid of ["http://bot.kcaron.top", "https://user:pass@bot.kcaron.top", "https://bot.kcaron.top/path", "not a url"]) {
      upstream.mockClear(); upstream.mockResolvedValue(new Response("ok"));
      await worker.fetch(new Request("https://guilded.kcaron.top/players/"), { ...env, GUILDED_ORIGIN_URL: invalid });
      expect(upstream.mock.calls[0]![0]).toBe("https://guildedqc.duckdns.org/players/");
    }
  });
  it("accepts the bot's canonical redirect from either address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://guildedqc.duckdns.org/g/quebec-gold/" } })));
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/g/quebec-gold"), { ...env, GUILDED_ORIGIN_URL: "https://bot.kcaron.top" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/g/quebec-gold/");
  });
  it("shows a branded, self-retrying page to visitors and JSON to API callers after three failures", async () => {
    const upstream = vi.fn(async () => dnsError()); vi.stubGlobal("fetch", upstream);
    const page = await worker.fetch(new Request("https://guilded.kcaron.top/recruitment/guilds/?lang=fr", { headers: { accept: "text/html,application/xhtml+xml" } }), env);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(page.status).toBe(503);
    expect(page.headers.get("retry-after")).toBe("20");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("De retour dans un instant");
    expect(html).toContain('<meta http-equiv="refresh" content="20">');
    expect(html).toContain('href="/recruitment/guilds/?lang=fr"');
    expect(html).not.toContain("1016");
    const api = await worker.fetch(new Request("https://guilded.kcaron.top/api/v1/standings"), env);
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "The guild bot is temporarily unavailable. Try again shortly." });
  });
  it("resends a POST only when Cloudflare never reached the bot", async () => {
    const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockResolvedValueOnce(dnsError()).mockResolvedValueOnce(Response.json({ accepted: [] }));
    vi.stubGlobal("fetch", upstream);
    const sent = await worker.fetch(new Request("https://guilded.kcaron.top/api/v1/public-runs", { method: "POST", body: "{\"runs\":[]}", headers: { "content-type": "application/json" } }), env);
    expect(sent.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(upstream.mock.calls[1]![1].body as Uint8Array)).toBe("{\"runs\":[]}");
    const failing = vi.fn(async () => { throw new TypeError("network connection lost"); }); vi.stubGlobal("fetch", failing);
    const lost = await worker.fetch(new Request("https://guilded.kcaron.top/api/v1/public-runs", { method: "POST", body: "{}" }), env);
    expect(lost.status).toBe(502);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
