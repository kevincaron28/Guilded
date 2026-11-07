import { describe, expect, it, vi } from "vitest";
import { createNewsFeed, parseHeadlines } from "../src/services/news-feed.js";
import type { WebContext } from "../src/services/web-app.js";

const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Wowhead</title><ttl>30</ttl>
<item><title><![CDATA[WoW: Forever &amp; Friends]]></title><link>https://www.wowhead.com/news=1/forever</link><pubDate>Fri, 06 Nov 2026 22:18:40 -0600</pubDate><description>FULL ARTICLE TEXT</description></item>
<item><title>Offsite</title><link>https://evil.example/x</link></item>
<item><title>Plain http</title><link>http://www.wowhead.com/news=2</link></item>
<item><title>No date &lt;b&gt;bold&lt;/b&gt;</title><link>https://www.wowhead.com/news=3/x</link></item>
</channel></rss>`;
const ctx = (method = "GET", path = "/news/headlines.json") => ({ request: { method, path } }) as unknown as WebContext;
const kit = {} as never;

describe("news headlines", () => {
  it("keeps only title, link and date, and only https wowhead.com links", () => {
    const items = parseHeadlines(xml);
    expect(items).toEqual([
      { title: "WoW: Forever & Friends", url: "https://www.wowhead.com/news=1/forever", publishedAt: "2026-11-07T04:18:40.000Z" },
      { title: "No date bold", url: "https://www.wowhead.com/news=3/x", publishedAt: null }
    ]);
    expect(JSON.stringify(items)).not.toContain("ARTICLE");
  });

  it("fetches at most once per 30 minutes however many phones ask", async () => {
    let time = 1_000_000;
    const fetchFeed = vi.fn(async () => xml);
    const news = createNewsFeed({ enabled: () => true, fetchFeed, now: () => time });
    await Promise.all([news.headlines(), news.headlines(), news.headlines()]);
    time += 10 * 60 * 1000;
    await news.headlines();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    time += 25 * 60 * 1000;
    await news.headlines();
    expect(fetchFeed).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the last list when Wowhead fails, then goes empty after a day", async () => {
    let time = 0, fail = false;
    const news = createNewsFeed({ enabled: () => true, fetchFeed: async () => { if (fail) throw new Error("down"); return xml; }, now: () => time });
    expect((await news.headlines()).items).toHaveLength(2);
    fail = true; time += 40 * 60 * 1000;
    expect((await news.headlines()).items).toHaveLength(2);
    time += 25 * 3600 * 1000;
    expect((await news.headlines()).items).toEqual([]);
  });

  it("serves JSON with attribution, answers HEAD without a body, rejects POST and ignores other paths", async () => {
    const news = createNewsFeed({ enabled: () => true, fetchFeed: async () => xml });
    const ok = await news.route(ctx(), kit);
    expect(ok?.status).toBe(200);
    expect(JSON.parse(ok!.body)).toMatchObject({ source: "Wowhead", enabled: true, items: [{ title: "WoW: Forever & Friends" }, { title: "No date bold" }] });
    expect((await news.route(ctx("HEAD"), kit))?.body).toBe("");
    expect((await news.route(ctx("POST"), kit))?.status).toBe(405);
    expect(await news.route(ctx("GET", "/other"), kit)).toBeNull();
  });

  it("is empty and never fetches when switched off", async () => {
    const fetchFeed = vi.fn(async () => xml);
    const body = JSON.parse((await createNewsFeed({ enabled: () => false, fetchFeed }).route(ctx(), kit))!.body);
    expect(body).toMatchObject({ enabled: false, items: [] });
    expect(fetchFeed).not.toHaveBeenCalled();
  });
});
