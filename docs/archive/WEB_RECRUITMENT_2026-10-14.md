# Quebec Gold recruitment website — published 14 October 2026

Published with the owner's explicit approval after mobile checks. Cloudflare Worker
version `2c75efc1-0966-4680-bdf6-649649394f9c`; prior version for rollback
`a3d239de-038b-4892-816c-552cc5bbb393`. Website assets only changed; Worker proxy
source is unchanged. No bot or addon deployment, Git commit, push or branch switch.

## Publication follow-up

Later verification at 16:32 UTC, after the onboarding/dungeon main deployments,
confirmed the unified `/health` returned ok=true, 6.1.2 / protocol 2. This
finalization independently read the same healthy endpoint again. The DNS error
below records the earlier incident; it is no longer evidence of a current outage.

- Mobile layouts checked at 320 and 390 CSS pixels; no horizontal page overflow.
  Navigation touch targets increased to 44px. Core cards, rules table and feature
  page inspected visually; live core page verified in browser after deployment.
- 174 test files / 1,445 tests, TypeScript, ESLint, addon validator, Worker dry run,
  site build and links/assets across 15 HTML pages passed.
- All six landing/content pages, sitemap and robots return 200; unknown URL returns 404.
- Owner requested useful Discord information: read-only queries scoped to Quebec
  Gold retrieved schedules and effective rules; the two schedule fields were then
  checked against the actual Discord roster message embeds. No roster/character
  names or individual balances were exported. Public invite returned 200 and the
  expected Quebec Gold guild name.
- `/quebec-gold/cores/` now publishes those dated schedules and EPGP rules. It links
  to existing protected companion tabs and explains `/epgp leaderboard` with the
  correct core. It does not implement a live public standings table or automatic
  schedule refresh. Refresh this snapshot when officers change schedules/rules.
- Existing incident, observed before AND after website deployment: Workers
  `/companion/` and `/health` return 530 / error 1016 (origin DNS), while the root
  website works. Direct `https://guildedqc.duckdns.org/health` and companion app.js
  return 200; app.js confirms support for `?tab=` links. Added a direct companion
  fallback with a warning that pairing at another origin replaces the previous
  companion link. DNS/Oracle configuration was not changed by the website chat.
  The later checks above supersede this incident's unresolved-health status.

The sections below retain the initial preparation context where applicable.

## Owner-confirmed public facts

The owner supplied these details in this website chat on 14 October:

- Quebec Gold; French-speaking; Montreal time (America/Toronto).
- WoW Forever, PvP realm, Horde; currently recruiting raid cores.
- PoE2: owner said "standard every new league". Public copy says each new league;
  exact permanent Standard versus seasonal/softcore wording needs clarification.
- Public Discord invite: https://discord.gg/PCs8BeE8bg (owner supplied;
  external web reader could not verify invite availability).

Initial owner reply supplied no raid days/times. Later live Discord verification:
Les Pulliticiens — Hyjal Summit, 20 players, first raid 9 December 2026 at 20:00;
Wednesday 20:00, Tuesday/end time unconfirmed. Les Aggros Anonyme — Barrow Deeps,
10 players, first raid 10 December 2026; Monday/Thursday 20:00–22:00 Montreal.
No class vacancies, progression, minimum level or exact current PoE2 league inferred.

## Review

Run `npm run site:build`, then `npm run site:preview`.

- http://127.0.0.1:8800/ — Guilded product remains the homepage.
- http://127.0.0.1:8800/features/ — existing addon, companion and Discord capabilities.
- http://127.0.0.1:8800/quebec-gold/ — French community homepage.
- http://127.0.0.1:8800/quebec-gold/wow/ — WoW raid recruitment.
- http://127.0.0.1:8800/quebec-gold/poe2/ — PoE2 community/contact.

Content is in `site/pages/`, with titles/descriptions/language in `site/pages.json`.
The builder emits static HTML, canonical URLs, social metadata and a sitemap.
Setting `draft: true` adds noindex and excludes that page from the sitemap.
The current canonical host is the existing public Workers domain. Update it in
the builder and homepage if the owner chooses another domain before publication.

Public pages contain no roster/member IDs or character details, make no database
requests and collect no applications. Companion links retain existing personal
pairing/authorization. The feature guide exposes existing functionality through
instructions, not new APIs. The standalone addon remains usable without Discord.

## Google guidance researched for this change

- [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide):
  useful original content, readable titles, descriptive URLs and real crawlable links.
  Applied with separate game pages and factual recruitment copy, without keyword stuffing.
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap):
  sitemap uses absolute preferred URLs. No fabricated last-modified timestamps.

After owner approval and deployment: check signed-out desktop/mobile pages, test
the invite, verify canonical URLs and actual 404 behavior, verify ownership in
Google Search Console, submit `/sitemap.xml`, and inspect the three recruitment
URLs. Monitor indexing and relevant search queries. Indexing/ranking is not guaranteed.
No Search Console property or search submission was made in this task.

## Validation

- Site build passed; all local links/assets resolve across 14 generated HTML pages.
- HTTP 200 verified for homepage, four new pages, robots.txt and sitemap.xml.
- TypeScript, ESLint and addon static validation passed on the shared checkout.
- Browser checks: desktop and mobile inspected; live core page left open for review.
- Full Vitest: 174 files, 1,445 tests passed.

Other chat owns Minimap.lua, Locale.lua, window.test.ts and the core standings
note. Do not stage or publish those as part of this website work. Website publication
was approved and performed; those unrelated changes remain untouched.
