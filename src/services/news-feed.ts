// GET /news/headlines.json (phone app News tab, docs/plans/APP_REDESIGN.md). Headlines and links only,
// from Wowhead's public RSS feed: title, link and date, never article text, images or summaries. The bot
// fetches the feed at most once per 30 minutes (the feed's own ttl) no matter how many phones ask, serves the
// last good list for up to a day if Wowhead is unreachable, and can be switched off with NEWS_FEED_ENABLED=false.
// Wowhead's terms are silent on feed reuse; see the plan for the open question to the owner.

import type { WebContext, WebResponse, WebRoute } from "./web-app.js";

export const NEWS_FEED_URL = "https://www.wowhead.com/news/rss/all";
export interface Headline { title: string; url: string; publishedAt: string | null }

const MAX_ITEMS = 20, REFRESH_MS = 30 * 60 * 1000, STALE_MS = 24 * 3600 * 1000;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const plain = (value: string) => value
  .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()]!;
    const point = code[1]!.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
  })
  .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1];

/** Title, link and date of each item. Only https links on wowhead.com are kept; everything else in the feed is ignored. */
export function parseHeadlines(xml: string): Headline[] {
  const out: Headline[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const title = plain(tag(match[1]!, "title") ?? "").slice(0, 200);
    const link = plain(tag(match[1]!, "link") ?? "");
    let url = "";
    try { const parsed = new URL(link); if (parsed.protocol === "https:" && /(^|\.)wowhead\.com$/.test(parsed.hostname)) url = parsed.href; } catch { /* not a URL */ }
    const date = Date.parse(plain(tag(match[1]!, "pubDate") ?? ""));
    if (title && url) out.push({ title, url, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export interface NewsDeps { enabled: () => boolean; fetchFeed: () => Promise<string>; now?: () => number }

export function createNewsFeed(deps: NewsDeps) {
  let cached: { at: number; items: Headline[] } | null = null;
  let nextTry = 0;
  let inflight: Promise<void> | null = null;
  const now = deps.now ?? Date.now;

  async function refresh(): Promise<void> {
    try { cached = { at: now(), items: parseHeadlines(await deps.fetchFeed()) }; nextTry = now() + REFRESH_MS; }
    catch { nextTry = now() + 5 * 60 * 1000; } // keep the old list and retry in 5 minutes
  }

  async function headlines(): Promise<{ items: Headline[]; fetchedAt: string | null }> {
    if (!deps.enabled()) return { items: [], fetchedAt: null };
    if (now() >= nextTry) { inflight ??= refresh().finally(() => { inflight = null; }); await inflight; }
    if (!cached || now() - cached.at > STALE_MS) return { items: [], fetchedAt: null };
    return { items: cached.items, fetchedAt: new Date(cached.at).toISOString() };
  }

  const route: WebRoute = async (ctx: WebContext): Promise<WebResponse | null> => {
    if (ctx.request.path !== "/news/headlines.json") return null;
    if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return { status: 405, headers: { allow: "GET, HEAD" }, body: "" };
    const { items, fetchedAt } = await headlines();
    const body = JSON.stringify({ source: "Wowhead", sourceUrl: "https://www.wowhead.com/news", enabled: deps.enabled(), fetchedAt, items });
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : body };
  };
  return { route, headlines };
}

/** The production wiring: the real feed, with a short timeout and no cookies. */
export function liveNewsFeed() {
  return createNewsFeed({
    enabled: () => process.env["NEWS_FEED_ENABLED"] !== "false",
    async fetchFeed() {
      const response = await fetch(NEWS_FEED_URL, { headers: { accept: "application/rss+xml, application/xml;q=0.9", "user-agent": "GuildedBot/9 (headline links only; contact via guilded.kcaron.top)" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`News feed answered ${response.status}`);
      return (await response.text()).slice(0, 2_000_000);
    }
  });
}
