import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";

// 20 Nov 2026: about 70 bot-backed pages answered 502 and one the 503 "back in a moment" page, then recovered.
// The Worker now retries the bot once or twice on 502/503/504 and keeps a copy of good anonymous pages.
const env = { ASSETS: { fetch: vi.fn(async () => new Response("asset")) } };
const html = { "content-type": "text/html; charset=utf-8" };
const page = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://guildedwow.com${path}`, { headers: { accept: "text/html", ...headers } });

function fakeCaches() {
  const store = new Map<string, Response>();
  return {
    store,
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); }
    }
  };
}
const ctx = () => { const pending: Promise<unknown>[] = []; return { pending, waitUntil: (p: Promise<unknown>) => { pending.push(p); } }; };

let cache: ReturnType<typeof fakeCaches>;
beforeEach(() => { cache = fakeCaches(); vi.stubGlobal("caches", cache); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bot-backed page resilience", () => {
  it("retries the bot after a 502 and serves the good answer", async () => {
    const upstream = vi.fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("<html>board</html>", { headers: html }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(page("/forever/leaderboards/dungeons/"), env, ctx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("board");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("serves the stored copy when the bot keeps failing, and the 503 page only without one", async () => {
    const c = ctx();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>board v1</html>", { headers: html })));
    expect((await worker.fetch(page("/forever/leaderboards/dungeons/"), env, c)).status).toBe(200);
    await Promise.all(c.pending);
    expect(cache.store.size).toBe(1);
    // Stored copy is older than the fresh window: the bot is asked, fails, the copy is served.
    const key = [...cache.store.keys()][0]!;
    const old = cache.store.get(key)!;
    const headers = new Headers(old.headers);
    headers.set("x-guilded-stored-at", String(Date.now() - 3600_000));
    cache.store.set(key, new Response(await old.text(), { headers }));
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", down);
    const stale = await worker.fetch(page("/forever/leaderboards/dungeons/"), env, ctx());
    expect(stale.status).toBe(200);
    expect(stale.headers.get("x-guilded-cache")).toBe("stale");
    expect(await stale.text()).toContain("board v1");
    expect(down).toHaveBeenCalledTimes(3);
    const none = await worker.fetch(page("/forever/players/abc"), env, ctx());
    expect(none.status).toBe(503);
    expect(none.headers.get("retry-after")).toBe("20");
  });

  it("serves a fresh copy without asking the bot, and a network error falls back to a stale copy", async () => {
    const c = ctx();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>one</html>", { headers: html })));
    await worker.fetch(page("/forever/leaderboards/guild/x"), env, c);
    await Promise.all(c.pending);
    const again = vi.fn(async () => { throw new TypeError("network"); });
    vi.stubGlobal("fetch", again);
    const hit = await worker.fetch(page("/forever/leaderboards/guild/x"), env, ctx());
    expect(hit.headers.get("x-guilded-cache")).toBe("fresh");
    expect(again).not.toHaveBeenCalled();
  });

  it("passes the bot's own 5xx through for API calls and /health, after the retries", async () => {
    const down = vi.fn(async () => new Response(JSON.stringify({ error: "CompanionUnavailable" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "30" } }));
    vi.stubGlobal("fetch", down);
    const api = await worker.fetch(new Request("https://guildedwow.com/api/v1/standings", { headers: { accept: "application/json" } }), env, ctx());
    expect(api.status).toBe(503);
    expect(api.headers.get("retry-after")).toBe("30");
    expect(await api.json()).toEqual({ error: "CompanionUnavailable" });
    expect(down).toHaveBeenCalledTimes(3);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("db down", { status: 503, headers: { "content-type": "text/plain" } })));
    const health = await worker.fetch(new Request("https://guildedwow.com/health"), env, ctx());
    expect(health.status).toBe(503);
    expect(await health.text()).toBe("db down");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const gone = await worker.fetch(new Request("https://guildedwow.com/api/v1/standings", { headers: { accept: "application/json" } }), env, ctx());
    expect(gone.status).toBe(502);
  });

  it("never stores or serves copies for signed-in visitors, cookies set by the bot, non-GET or non-page routes", async () => {
    const c = ctx();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>mine</html>", { headers: html })));
    await worker.fetch(page("/forever/players/abc", { cookie: "__Host-guilded_session=secret" }), env, c);
    await worker.fetch(page("/forever/leaderboards/", { accept: "application/json" }), env, c);
    await worker.fetch(new Request("https://guildedwow.com/forever/leaderboards/", { method: "POST", headers: { accept: "text/html", origin: "https://guildedwow.com" } }), env, c);
    await worker.fetch(page("/recruitment/"), env, c);
    await worker.fetch(page("/me/"), env, c);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>cookie</html>", { headers: { ...html, "set-cookie": "a=b; Secure" } })));
    await worker.fetch(page("/forever/leaderboards/duels/"), env, c);
    await Promise.all(c.pending);
    expect(cache.store.size).toBe(0);
  });

  it("keeps English and French copies apart", async () => {
    const c = ctx();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>x</html>", { headers: html })));
    await worker.fetch(page("/forever/leaderboards/dungeons/"), env, c);
    await worker.fetch(page("/forever/leaderboards/dungeons/", { "accept-language": "fr-CA,fr;q=0.9" }), env, c);
    await Promise.all(c.pending);
    expect(cache.store.size).toBe(2);
  });
});
