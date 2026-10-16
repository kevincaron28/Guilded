import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";

afterEach(() => vi.unstubAllGlobals());
const base = "https://guilded-wow.kcaron.workers.dev";
const env = { ASSETS: { fetch: vi.fn(async () => new Response("website")) } };

describe("unified website and companion", () => {
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
