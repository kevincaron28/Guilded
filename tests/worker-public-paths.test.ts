import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";

// The public addresses that must keep answering after a website or Worker change (7 November 2026: a
// probe of the creator domain was mistaken for a Guilded outage). guilded.kcaron.top is the Guilded
// website; kcaron.top is the creator domain, which serves only its own page and static files, so Guilded's
// data pages are 404 there by design. The asset store answers like production: unknown files are 404.
const ASSET_FILES = new Set(["/", "/forever/", "/editions/", "/editions/forever/", "/companion/", "/creator/"]);
const env = { ASSETS: { fetch: vi.fn(async (request: Request) => {
  const path = new URL(request.url).pathname.replace(/index\.html$/, "");
  return ASSET_FILES.has(path) ? new Response(`asset ${path}`) : new Response("", { status: 404 });
}) } };
afterEach(() => vi.unstubAllGlobals());

const visit = (host: string, path: string) => worker.fetch(new Request(`https://${host}${path}`, { headers: { accept: "text/html" } }), env);

describe("public addresses keep answering", () => {
  it("serves the Guilded website on guilded.kcaron.top: pages, data pages and the old-address redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bot", { headers: { "content-type": "text/html" } })));
    const expected: [string, number, string | null][] = [
      ["/", 200, null], ["/forever/", 200, null], ["/forever/leaderboards/", 200, null],
      ["/leaderboards/", 302, "/forever/leaderboards/"], ["/players/", 302, "/forever/players/"],
      ["/g/quebec-gold/", 200, null], ["/editions/", 200, null], ["/editions/forever/", 200, null],
      ["/retail/", 301, "/forever/"], ["/tbc/leaderboards/", 301, "/forever/leaderboards/"],
      ["/editions/retail/", 301, "/editions/forever/"], ["/companion/x", 301, "/companion/"], ["/health", 200, null]
    ];
    for (const [path, status, location] of expected) {
      const response = await visit("guilded.kcaron.top", path);
      expect(response.status, path).toBe(status);
      expect(response.headers.get("location"), path).toBe(location);
    }
  });

  it("keeps the creator domain (kcaron.top) to its own page: Guilded's data pages are 404 there by design", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bot")));
    expect((await visit("kcaron.top", "/")).status).toBe(200);
    for (const path of ["/forever/leaderboards/", "/leaderboards/", "/players/", "/g/quebec-gold/", "/retail/", "/companion/x"]) {
      expect((await visit("kcaron.top", path)).status, path).toBe(404);
    }
  });
});
