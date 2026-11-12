import { afterEach, describe, expect, it, vi } from "vitest";
// Turns the Forever-only focus switches on for this file (see tests/helpers/focus-switches.ts).
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
    const response = await worker.fetch(new Request(base + "/docs/PRIVACY", { headers: { authorization: "Bearer private" } }), env);
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
  });

  it("blocks unknown API paths, disallowed methods and oversized bodies before reaching the bot", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(base + "/api/v1/admin"), env)).status).toBe(404);
    expect((await worker.fetch(new Request(base + "/api/v1/standings", { method: "DELETE" }), env)).status).toBe(405);
    expect((await worker.fetch(new Request(base + "/api/v1/addon-imports", { method: "POST", body: "x".repeat(1_000_001) }), env)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards the statistics CSV feed (GET only) with its query and returns the CSV untouched", async () => {
    const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response("day\r\n", { headers: { "content-type": "text/csv; charset=utf-8" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(base + "/api/v1/stats-feed?guild=g1&key=abc"), env);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toBe("day\r\n");
    expect(upstream.mock.calls[0]![0]).toContain("/api/v1/stats-feed?guild=g1&key=abc");
    expect((await worker.fetch(new Request(base + "/api/v1/stats-feed", { method: "POST" }), env)).status).toBe(405);
  });

  it("does not forward pairing credentials on redirects", async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.example/" } }));
    vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(new Request(base + "/api/v1/standings?guild=123", { headers: { "x-companion-credential": "personal" } }), env)).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("passes the standings 304 (nothing changed) through instead of calling it a redirect", async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"abc"', "set-cookie": "x=1" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(base + "/api/v1/standings?guild=123&since=%22abc%22&wait=15", { headers: { "x-companion-credential": "personal" } }), env);
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("serves the companion download page statically and redirects the removed browser companion", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const asset = vi.fn(async () => new Response("download page"));
    const page = await worker.fetch(new Request(base + "/companion/"), { ASSETS: { fetch: asset } });
    expect(await page.text()).toBe("download page");
    for (const [path, target] of [["/companion", "/companion/"], ["/companion/app.js", "/companion/"], ["/companion/index.html?tab=pricing", "/companion/"], ["/companion/?lang=fr", null], ["/companion/web-bundle.js?lang=fr", "/companion/?lang=fr"]] as const) {
      const response = await worker.fetch(new Request(base + path), { ASSETS: { fetch: asset } });
      if (target) { expect(response.status).toBe(301); expect(response.headers.get("location")).toBe(target); }
      else expect(response.status).toBe(200);
    }
    expect(upstream).not.toHaveBeenCalled();
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
    for (const path of ["/quebec-gold/poe2/", "/quebec-gold/poe2", "/quebec-gold/diablo/?lang=fr"]) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${path}`), { ASSETS: { fetch: asset } });
      expect(response.status, path).toBe(301);
      expect(response.headers.get("location"), path).toBe(`/quebec-gold/${path.includes("lang=fr") ? "?lang=fr" : ""}`);
    }
    expect(asset).not.toHaveBeenCalled();
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
    expect((await worker.fetch(new Request(site + "/forever/recruitment/"), env)).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/oauth2/authorize" } })));
    expect((await worker.fetch(new Request(site + "/auth/login"), env)).status).toBe(502);
  });

  it("permits only the Battle.net start POST to redirect to Blizzard authorization", async () => {
    let destination = "https://oauth.battle.net/authorize?client_id=1&state=random";
    const upstream = vi.fn(async () => new Response(null, { status: 303, headers: { location: destination } }));
    vi.stubGlobal("fetch", upstream);
    const start = () => worker.fetch(new Request(site + "/me/battlenet/start", { method: "POST", body: "csrf=private", headers: { origin: site, "content-type": "application/x-www-form-urlencoded" } }), env);
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).toHaveBeenCalledOnce(); // The proxy never follows with cookies/body.
    expect((await worker.fetch(new Request(site + "/me/battlenet/start"), env)).status).toBe(502);
    expect((await worker.fetch(new Request(site + "/me/battlenet/callback"), env)).status).toBe(502);
    destination = "https://evil.example/authorize";
    expect((await start()).status).toBe(502);
    destination = "https://oauth.battle.net/token";
    expect((await start()).status).toBe(502);
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
    const result = await worker.fetch(new Request("https://guilded.kcaron.top/forever/players/c111111111111111111111111?lang=fr"), env);
    expect(await result.text()).toBe("profile");
    expect(upstream.mock.calls[0]![0]).toBe("https://guildedqc.duckdns.org/players/c111111111111111111111111?lang=fr&edition=forever");
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
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/forever/leaderboards/?lang=fr", { headers: { accept: "text/html" } }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("leaderboards");
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("tries the configured hostname first and keeps DuckDNS as the fallback", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>().mockResolvedValueOnce(dnsError()).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    await worker.fetch(new Request("https://guilded.kcaron.top/forever/players/?class=Mage"), { ...env, GUILDED_ORIGIN_URL: "https://bot.kcaron.top" });
    expect(upstream.mock.calls.map(call => call[0])).toEqual(["https://bot.kcaron.top/players/?class=Mage&edition=forever", "https://guildedqc.duckdns.org/players/?class=Mage&edition=forever"]);
    for (const invalid of ["http://bot.kcaron.top", "https://user:pass@bot.kcaron.top", "https://bot.kcaron.top/path", "not a url"]) {
      upstream.mockClear(); upstream.mockResolvedValue(new Response("ok"));
      await worker.fetch(new Request("https://guilded.kcaron.top/forever/players/"), { ...env, GUILDED_ORIGIN_URL: invalid });
      expect(upstream.mock.calls[0]![0]).toBe("https://guildedqc.duckdns.org/players/?edition=forever");
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
    const page = await worker.fetch(new Request("https://guilded.kcaron.top/forever/recruitment/guilds/?lang=fr", { headers: { accept: "text/html,application/xhtml+xml" } }), env);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(page.status).toBe(503);
    expect(page.headers.get("retry-after")).toBe("20");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("De retour dans un instant");
    expect(html).toContain('<meta http-equiv="refresh" content="20">');
    expect(html).toContain('href="/forever/recruitment/guilds/?lang=fr"');
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

// WoW Forever's section (/forever/). Guilded supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md): the removed
// editions' old sections (/classic-era/, /tbc/, /mists/, /retail/) and download pages redirect permanently to Forever.
describe("WoW Forever section", () => {
  const site = "https://guilded.kcaron.top";
  const page = (path: string, headers: Record<string, string> = {}) => worker.fetch(new Request(site + path, { headers: { accept: "text/html", ...headers } }), env);
  it("serves the hub page and remembers the section for the next visit", async () => {
    const hub = await page("/forever/");
    expect(hub.status).toBe(200);
    expect(await hub.text()).toBe("website");
    expect(hub.headers.get("set-cookie")).toBe("guilded_edition=forever; Max-Age=31536000; Path=/; Secure; SameSite=Lax");
    const bare = await page("/forever?lang=fr");
    expect(bare.status).toBe(301);
    expect(bare.headers.get("location")).toBe("/forever/?lang=fr");
    expect((await worker.fetch(new Request("https://kcaron.top/forever/"), env)).headers.get("set-cookie")).toBeNull();
  });
  it("redirects the removed editions' old addresses permanently to the WoW Forever equivalent", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    for (const [from, to] of [["/retail/", "/forever/"], ["/tbc/leaderboards/guilds/?lang=fr", "/forever/leaderboards/guilds/?lang=fr"],
      ["/mists/players/abc", "/forever/players/abc"], ["/classic-era/recruitment/", "/forever/recruitment/"], ["/editions/retail/", "/editions/forever/"],
      ["/editions/classic-tbc/?lang=fr", "/editions/forever/?lang=fr"]] as const) {
      const moved = await page(from);
      expect(moved.status, from).toBe(301);
      expect(moved.headers.get("location"), from).toBe(to);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("sends the section's data pages to the bot as WoW Forever", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>(async () => new Response("board", { headers: { "content-type": "text/html" } })); vi.stubGlobal("fetch", upstream);
    const board = await page("/forever/leaderboards/guilds/?lang=fr");
    expect(await board.text()).toBe("board");
    expect(upstream.mock.calls[0]![0]).toBe("https://guildedqc.duckdns.org/leaderboards/guilds/?lang=fr&edition=forever");
    expect(board.headers.get("set-cookie")).toContain("guilded_edition=forever");
    await worker.fetch(new Request(site + "/forever/leaderboards/summary.json"), env);
    expect(upstream.mock.calls[1]![0]).toBe("https://guildedqc.duckdns.org/leaderboards/summary.json?edition=forever");
    upstream.mockClear();
    // Only the public data pages exist in the section; the signed-in pages stay at /me/ and /auth/.
    expect(await (await page("/forever/me/")).text()).toBe("website");
    expect(await (await page("/forever/auth/login")).text()).toBe("website");
    expect(upstream).not.toHaveBeenCalled();
  });
  it("moves older ?edition= links (any edition) and the filter forms into the WoW Forever section", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const old = await page("/leaderboards/?edition=classic-tbc&season=s1&lang=fr");
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe("/forever/leaderboards/?season=s1&lang=fr");
    const form = await page("/forever/recruitment/guilds/?q=gold&edition=retail");
    expect(form.headers.get("location")).toBe("/forever/recruitment/guilds/?q=gold");
    expect(upstream).not.toHaveBeenCalled();
  });
  it("opens unsectioned pages in the WoW Forever section, whatever an old cookie remembered", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await page("/leaderboards/")).headers.get("location")).toBe("/forever/leaderboards/");
    expect((await page("/players/?class=Mage", { cookie: "a=1; guilded_edition=mists" })).headers.get("location")).toBe("/forever/players/?class=Mage");
    expect((await page("/recruitment/", { cookie: "guilded_edition=unknown" })).headers.get("location")).toBe("/forever/recruitment/");
  });
  it("leaves files, form posts and the bot's sectioned redirects alone; an old section's form post is served as Forever", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>(async () => new Response("ok")); vi.stubGlobal("fetch", upstream);
    await worker.fetch(new Request(site + "/leaderboards/summary.json?edition=forever"), env);
    await worker.fetch(new Request(site + "/recruitment/guilds/sitemap.xml"), env);
    const post = await worker.fetch(new Request(site + "/recruitment/", { method: "POST", headers: { origin: site, "content-type": "application/x-www-form-urlencoded" }, body: "edition=forever" }), env);
    expect(post.status).toBe(200);
    await worker.fetch(new Request(site + "/retail/recruitment/", { method: "POST", headers: { origin: site }, body: "" }), env);
    expect(upstream.mock.calls.map(call => call[0])).toEqual(["https://guildedqc.duckdns.org/leaderboards/summary.json?edition=forever", "https://guildedqc.duckdns.org/recruitment/guilds/sitemap.xml", "https://guildedqc.duckdns.org/recruitment/", "https://guildedqc.duckdns.org/recruitment/?edition=forever"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 303, headers: { location: "/forever/recruitment/?saved=1" } })));
    const saved = await worker.fetch(new Request(site + "/forever/recruitment/", { method: "POST", headers: { origin: site }, body: "" }), env);
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/forever/recruitment/?saved=1");
  });
});

describe("phone app routes", () => {
  it("forwards the companion hub the phone and the Windows app both call", async () => {
    const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ guild: { name: "Northwind" } }));
    vi.stubGlobal("fetch", upstream);
    const get = await worker.fetch(new Request(base + "/api/v1/hub?guild=123", { headers: { "x-companion-credential": "secret" } }), env);
    expect(get.status).toBe(200);
    const [getUrl, getInit] = upstream.mock.calls[0] as [string, RequestInit];
    expect(getUrl).toBe("https://guildedqc.duckdns.org/api/v1/hub?guild=123");
    expect(new Headers(getInit.headers).get("x-companion-credential")).toBe("secret");
    const post = await worker.fetch(new Request(base + "/api/v1/hub", {
      method: "POST", body: "{}", headers: { "content-type": "application/json", "x-companion-credential": "secret" }
    }), env);
    expect(post.status).toBe(200);
    expect(upstream.mock.calls[1]?.[0]).toBe("https://guildedqc.duckdns.org/api/v1/hub");
  });

  it("lets Expo web on this computer read the API and the public summary, and no other site", async () => {
    const upstream = vi.fn(async () => Response.json({ season: "Beta" }));
    vi.stubGlobal("fetch", upstream);
    const preflight = await worker.fetch(new Request(base + "/api/v1/hub?guild=123", {
      method: "OPTIONS", headers: { origin: "http://localhost:8081", "access-control-request-headers": "x-companion-credential" }
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
    expect(upstream).not.toHaveBeenCalled();
    const summary = await worker.fetch(new Request("https://guilded.kcaron.top/leaderboards/summary.json", { headers: { origin: "http://127.0.0.1:8081" } }), env);
    expect(summary.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8081");
    const stranger = await worker.fetch(new Request(base + "/api/v1/hub?guild=123", { headers: { origin: "https://evil.example" } }), env);
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
    const page = await worker.fetch(new Request(base + "/", { headers: { origin: "http://localhost:8081" } }), env);
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("canonical host (guildedwow.com move)", () => {
  const on = { ...env, GUILDED_CANONICAL_HOST: "guildedwow.com" };
  it("does nothing until the variable is set", async () => {
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/features/"), env);
    expect(response.headers.get("location") ?? "").not.toContain("guildedwow.com");
  });
  it("sends browser page views on the old host and www to the canonical host", async () => {
    const old = await worker.fetch(new Request("https://guilded.kcaron.top/leaderboards/?lang=fr"), on);
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("https://guildedwow.com/leaderboards/?lang=fr");
    const www = await worker.fetch(new Request("https://www.guildedwow.com/api/v1/standings"), on);
    expect(www.status).toBe(301);
    expect(www.headers.get("location")).toBe("https://guildedwow.com/api/v1/standings");
  });
  it("never moves what programs call on the old host", async () => {
    const upstream = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    for (const [method, path] of [["POST", "/api/v1/addon-imports"], ["GET", "/api/v1/standings"], ["GET", "/health"], ["GET", "/releases.json"], ["GET", "/leaderboards/summary.json"], ["HEAD", "/downloads/Guilded.Companion.Setup.exe"], ["POST", "/me/settings"]] as const) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${path}`, method === "POST" ? { method, body: "{}" } : { method }), on);
      expect(response.status, `${method} ${path}`).not.toBe(301);
    }
  });
  it("serves the canonical host itself and leaves the creator domain alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    expect((await worker.fetch(new Request("https://guildedwow.com/health"), on)).status).toBe(200);
    expect((await worker.fetch(new Request("https://kcaron.top/"), on)).status).not.toBe(301);
  });
});
