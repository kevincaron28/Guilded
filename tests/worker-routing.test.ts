import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";

afterEach(() => vi.unstubAllGlobals());
const base = "https://guilded-wow.kcaron.workers.dev";
const env = { ASSETS: { fetch: vi.fn(async () => new Response("website")) } };

describe("unified website and companion", () => {
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
});
