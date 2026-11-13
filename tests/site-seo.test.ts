import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import worker from "../worker/index.mjs";
import { GUIDE_REDIRECTS } from "../site/static-redirects.mjs";

const env = { GUILDED_CANONICAL_HOST: "guildedwow.com", ASSETS: { fetch: vi.fn(async () => new Response("asset")) } };
const get = (url: string) => worker.fetch(new Request(url, { redirect: "manual" }), env);

describe("search-engine fixes in the Worker", () => {
  it("moves /index.html paths to the directory URL on every host and drops lang under /fr/", async () => {
    for (const [from, to] of [
      ["https://guildedwow.com/fr/index.html", "/fr/"],
      ["https://guildedwow.com/fr/index.html?lang=fr", "/fr/"],
      ["https://guildedwow.com/index.html", "/"],
      ["https://guildedwow.com/guide/start/index.html", "/guide/start/"],
    ] as const) {
      const response = await get(from);
      expect(response.status, from).toBe(301);
      expect(response.headers.get("location"), from).toBe(to);
    }
    expect((await get("https://www.guildedwow.com/fr/index.html")).status).toBe(301);
  });
  it("moves the old host's sitemap to guildedwow.com", async () => {
    const response = await get("https://guilded.kcaron.top/sitemap.xml");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://guildedwow.com/sitemap.xml");
  });
  it("does not move the API, downloads, health, feed, ads.txt or other .xml files on the old host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    for (const path of ["/api/v1/ping", "/downloads/Guilded.Companion.Setup.exe", "/health", "/releases.json", "/ads.txt", "/recruitment/guilds/sitemap.xml"]) {
      const response = await get(`https://guilded.kcaron.top${path}`);
      expect(response.headers.get("location")?.startsWith("https://guildedwow.com") ?? false, path).toBe(false);
    }
    vi.unstubAllGlobals();
  });
});

describe("built site", () => {
  beforeAll(() => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }), 60000);
  const out = "dist/site";
  const locs = () => [...readFileSync(`${out}/sitemap.xml`, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  it("lists only https://guildedwow.com URLs and no redirecting page", () => {
    const urls = locs();
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      expect(url.startsWith("https://guildedwow.com/"), url).toBe(true);
      const path = new URL(url).pathname.replace(/^\/fr(?=\/)/, "");
      expect(Object.hasOwn(GUIDE_REDIRECTS, path), url).toBe(false);
      expect(url).not.toContain("index.html");
    }
  });
  it("declares en, fr and x-default alternates with one self canonical", () => {
    const html = readFileSync(`${out}/guide/start/index.html`, "utf8");
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('rel="canonical" href="https://guildedwow.com/guide/start/"');
    expect(html).toContain('hreflang="en" href="https://guildedwow.com/guide/start/"');
    expect(html).toContain('hreflang="fr" href="https://guildedwow.com/fr/guide/start/"');
    expect(html).toContain('hreflang="x-default" href="https://guildedwow.com/guide/start/"');
    expect(html).not.toContain("/fr/fr/");
  });
  it("references the guild sitemap from robots.txt", () => {
    expect(readFileSync(`${out}/robots.txt`, "utf8")).toContain("Sitemap: https://guildedwow.com/recruitment/guilds/sitemap.xml");
  });
});
