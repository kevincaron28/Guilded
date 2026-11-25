# Worker request budget (25 November 2026)

The website's Worker (`guilded-wow`: guilded.kcaron.top, guildedwow.com, www.guildedwow.com) used about 89,600
requests in a day, against the free plan's 100,000. Every request that is not a static asset runs the Worker,
even when the Worker answers from its cache, so only fewer requests (or static assets) bring the count down.

## Where they came from (24 November 2026, last 24 hours, Cloudflare security analytics)

Workers Observability is off for `guilded-wow`, so the split comes from each zone's request analytics and their
sampled logs (100 rows each).

| Source | Requests/day | What |
| --- | ---: | --- |
| guilded.kcaron.top | ~61,900 | 99 of 100 sampled rows were `GET /api/v1/standings`: companion live long polls. Five addresses made 50k of them (one made 20k). |
| guildedwow.com | ~29,600 | Crawlers on leaderboard, run and character pages (Google, Bing, Apple, Amazon, Tencent and others). One address alone made 16,600. `/consent.js` was 10 of 100 sampled rows. |

The long poll: each live connection (one per server profile) asked for standings again 2 seconds after every
answer, and the bot holds a request at most 12 seconds, so a connection running day and night is about 6,000 to
7,200 requests a day. The ~60,000 are roughly eight or nine such connections.

## What changed

1. **Companion: quiet backoff for live standings** (`companion/engine.mjs`, `quietPollGapMs`). After a "nothing new"
   answer the next poll waits 15 s, then 30 s, 60 s, 2 min, 4 min, then every 5 min. A changed answer goes back to
   the 2-second gap; an upload (a save of the WoW file, parked runs sent) ends the wait at once, so run receipts still
   arrive within seconds. The addon reads these files only at login or `/reload`, so members see no difference.
   A quiet connection drops from ~7,000 to ~280 requests a day. **Needs a companion release** (no bot or Worker
   change; older companions keep long-polling until they update, and the bot is unchanged, so nothing breaks).
2. **`/consent.js` is a static asset** (`scripts/build-site.mjs`, `wrangler.jsonc` `run_worker_first`). Each ad page
   view loaded it through the Worker; static assets do not count. Pages still name it only while `GUILDED_ADS` is on.
3. **`Crawl-delay: 10` in robots.txt.** Bing, Yandex and most AI crawlers honour it (at most 8,640 pages a day each);
   Google ignores it.

## Expected daily total

| Step | Estimate |
| --- | ---: |
| Before | ~89,600 |
| This PR merged (site only: consent.js, Crawl-delay) | ~80,000 to 85,000 |
| Companions on the release with the backoff | ~25,000 to 30,000 (standings ~3,000 to 5,000, the rest crawlers and visitors) |

## For the owner (dashboard, not code)

- Until companions update, a single crawler address can still push the day over 100,000. A WAF rule on
  guildedwow.com (Security → Security rules: block or rate-limit that address, or turn on AI Crawl Control's
  block for AI crawlers) runs before the Worker, so blocked requests do not count.
- Turning on Workers Observability (free: 200,000 events a day) would give an exact split by path next time.
