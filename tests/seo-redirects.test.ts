import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../worker/index.mjs";

// SEO4 (docs/AI_HANDOFF.md): permanent redirects in one hop, a sitemap of real, indexable 200 pages with real
// lastmod dates, and a robots.txt that keeps the account and API paths out.
afterEach(() => vi.unstubAllGlobals());
const HOST = "https://guilded.kcaron.top";
// The asset store answers like production: html_handling "auto-trailing-slash" is a 307 (clean .html, add the slash).
const assets = vi.fn(async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname === "/docs/PRIVACY.html") return new Response(null, { status: 307, headers: { location: "/docs/PRIVACY" } });
  if (url.pathname === "/guide/start") return new Response(null, { status: 307, headers: { location: `/guide/start/${url.search}` } });
  return new Response("asset", { headers: { "content-type": "text/html" } });
});
const env = { ASSETS: { fetch: assets } };
const visit = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${HOST}${path}`, { redirect: "manual", headers: { accept: "text/html" }, ...init }), env);
const botOk = () => vi.stubGlobal("fetch", vi.fn(async () => new Response("bot", { headers: { "content-type": "text/html" } })));

describe("one permanent hop for the data pages", () => {
  it("moves /leaderboards, /recruitment and /players into /forever/ with 301 and a long cache", async () => {
    botOk();
    for (const [from, to] of [
      ["/leaderboards/", "/forever/leaderboards/"], ["/leaderboards", "/forever/leaderboards/"],
      ["/recruitment/", "/forever/recruitment/"], ["/recruitment/guilds", "/forever/recruitment/guilds/"],
      ["/players/", "/forever/players/"], ["/players", "/forever/players/"],
      ["/leaderboards/guilds/?season=s1", "/forever/leaderboards/guilds/?season=s1"],
      ["/leaderboards/?edition=forever", "/forever/leaderboards/"],
      ["/leaderboards/?lang=en&bracket=60", "/forever/leaderboards/?bracket=60"]
    ] as const) {
      const response = await visit(from);
      expect([response.status, response.headers.get("location")], from).toEqual([301, to]);
      expect(response.headers.get("cache-control"), from).toBe("public, max-age=86400");
    }
  });
  it("adds the trailing slash inside the section directly, with no ?edition= in between", async () => {
    botOk();
    const response = await visit("/forever/leaderboards");
    expect([response.status, response.headers.get("location")]).toEqual([301, "/forever/leaderboards/"]);
    expect((await visit("/forever/leaderboards/guilds?lang=fr")).headers.get("location")).toBe("/forever/leaderboards/guilds/?lang=fr");
  });
  it("leaves the final addresses, leaf pages, files and POSTs alone", async () => {
    botOk();
    for (const path of ["/forever/leaderboards/", "/forever/leaderboards/?lang=fr", "/forever/leaderboards/character/Kev-Doomhowl", "/forever/leaderboards/summary.json", "/forever/leaderboards/run/abc/card.png"]) {
      expect((await visit(path)).status, path).toBe(200);
    }
    expect((await visit("/leaderboards/", { method: "POST" })).status).not.toBe(301);
  });
  it("still sends retired edition sections permanently", async () => {
    botOk();
    expect((await visit("/retail/leaderboards/")).status).toBe(301);
  });
});

describe("clean-URL moves from the asset store are permanent", () => {
  it("answers the 307 of .html and trailing-slash cleanup with a 301 to the same place", async () => {
    const html = await visit("/docs/PRIVACY.html");
    expect([html.status, html.headers.get("location")]).toEqual([301, "/docs/PRIVACY"]);
    expect(html.headers.get("cache-control")).toBe("public, max-age=86400");
    const slash = await visit("/guide/start?x=1");
    expect([slash.status, slash.headers.get("location")]).toEqual([301, "/guide/start/?x=1"]);
  });
  it("redirects the old guide addresses in one hop to the final page", async () => {
    for (const [from, to] of [["/start", "/guide/start/"], ["/start/", "/guide/start/"], ["/docs/QUICK_START.html", "/guide/start/"], ["/privacy", "/docs/PRIVACY"]] as const) {
      const response = await visit(from);
      expect([response.status, response.headers.get("location")], from).toEqual([301, to]);
    }
  });
  it("lists the redirecting addresses in run_worker_first, so the asset store's own 307 never answers them", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(["/start", "/start/", "/guides", "/guides/*", "/docs/*", "/guide/*", "/forever/*"]));
  });
});

describe("robots.txt and sitemaps", () => {
  const robots = () => readFileSync("dist/site/robots.txt", "utf8");
  const sitemap = (file: string) => readFileSync(file, "utf8");
  const entries = (xml: string) => [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1]!, lastmod: m[2] }));
  it("blocks the account, auth, API, health and owner paths and allows the public pages", () => {
    const text = robots();
    for (const line of ["Allow: /", "Disallow: /me", "Disallow: /me/", "Disallow: /auth/", "Disallow: /api/", "Disallow: /health", "Disallow: /owner", "Disallow: /owner/"]) expect(text.split("\n")).toContain(line);
    expect(text).toContain("Sitemap: https://guildedwow.com/sitemap.xml");
    expect(text).toContain("Sitemap: https://guildedwow.com/recruitment/guilds/sitemap.xml");
    expect(text).not.toMatch(/Disallow: \/(?:forever|leaderboards|guide)/);
  });
  it("gives every sitemap entry (both sites) a real lastmod that is not in the future", () => {
    for (const file of ["dist/site/sitemap.xml", "dist/site/creator/sitemap.xml"]) {
      const list = entries(sitemap(file));
      expect(list.length, file).toBeGreaterThan(0);
      for (const { loc, lastmod } of list) {
        expect(lastmod, loc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(lastmod! <= new Date().toISOString().slice(0, 10), loc).toBe(true);
      }
    }
  });
  it("keeps /status/ (noindex) and held pages out of the sitemap, and lists the bot pages' French alternates once", () => {
    const urls = entries(sitemap("dist/site/sitemap.xml")).map((e) => e.loc);
    expect(urls.some((u) => /\/status\//.test(u))).toBe(false);
    expect(readFileSync("dist/site/status/index.html", "utf8")).toContain('name="robots" content="noindex,follow"');
    expect(urls.some((u) => /poe2|diablo/i.test(u))).toBe(false);
    expect(urls).toContain("https://guildedwow.com/fr/forever/leaderboards/");
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).not.toMatch(/\?/);
  });
});
