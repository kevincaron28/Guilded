# Website reliability and refresh — 29 October 2026

The owner asked for a website review and these items of its update plan: 1 (outage), 2 (plain
wording), 3 (lighter images), 4 (one header), 5 (five-entry menu), 6 (homepage paths and live
strip), 7 (empty states), 9 (Forever page), 10 (link previews and sitemap), 11 (officer page) and
the free part of 14 (analytics). The plan had no item 16.

## The outage: Cloudflare error 1016

On 29 October 2026, 9 of 20 requests to `https://guilded.kcaron.top/leaderboards/` returned
Cloudflare's bare `error code: 1016` (HTTP 530). Every page the Worker forwards to the bot was
affected: leaderboards, guilds, recruitment, players, guild pages, My Guilded and the companion.
Error 1016 means Cloudflare could not look up the origin's address; the Worker reaches the bot at
the free `guildedqc.duckdns.org` name. Static pages (home, download, guides) were not affected.

The uptime workflow did not show it: its retries hid the flapping pages, and its direct
`guildedqc.duckdns.org/health` check had failed on every run since 28 October because origin
protection now answers only the Worker. That false alarm is removed.

### What this change does (no owner action needed)

- `worker/index.mjs` retries a 530 up to three times. A 530 means the request never reached the
  bot, so even a POST is safe to resend; other network failures are retried for reads only.
- A visitor who still cannot reach the bot gets a branded, bilingual "Back in a moment" page that
  retries by itself after 20 seconds (HTTP 503, `Retry-After: 20`). API callers get JSON.
- The Worker reads an optional `GUILDED_ORIGIN_URL` variable (an `https://host` address) and tries
  it first, keeping DuckDNS as the fallback.
- `deploy/Caddyfile` moves the bot's routes into a `guilded_site` snippet and imports any extra
  addresses from `/etc/caddy/guilded-sites/*.caddy`. `deploy/update.sh` still finds exactly one
  site and never edits those files.
- `.github/workflows/uptime.yml` also checks the leaderboards and guild directory, and makes ten
  quick visits to the leaderboards: more than one failure is reported as an outage.

### Owner steps for the full fix (about 10 minutes, after the next bot deployment)

1. **Cloudflare DNS** for `kcaron.top`: add an **A** record, name `bot`, IPv4 `168.138.70.194`,
   proxy status **DNS only** (grey cloud), so Caddy can get its own certificate.
2. **On the Oracle server**, once the deployment has installed the new Caddyfile:

   ```bash
   sudo mkdir -p /etc/caddy/guilded-sites
   printf 'bot.kcaron.top {\n\timport guilded_site\n}\n' | sudo tee /etc/caddy/guilded-sites/bot.caddy
   sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```

3. **Cloudflare → Workers & Pages → guilded-wow → Settings → Variables and secrets**: add the
   plain-text variable `GUILDED_ORIGIN_URL` = `https://bot.kcaron.top`. `wrangler.jsonc` has
   `keep_vars: true`, so later deployments keep it.
4. **Check**: 20 visits to `https://guilded.kcaron.top/leaderboards/` should all return 200.
   A direct visit to `https://bot.kcaron.top/health` returns "Not found": origin protection answers
   only the Worker.

The retries help on their own; the hostname in your own zone is what removes the DuckDNS lookup.

## Website refresh

| Item | Change |
| --- | --- |
| 2 Plain wording | Homepage, edition pages, leaderboard intro and quick start lose release-process wording. The full scoring rules stay one click away under "How scores work". |
| 3 Lighter images | Header logo 324 KB → 3 KB (`logo-88.webp`), `logo.png` 324 → 90 KB, homepage screenshots about 300 → 35 KB each (WebP; the PNGs stay as the enlarge links). New favicon and Apple touch icon. |
| 4 One header | Bot-served pages use the website's header: logo, caption, drop-downs, EN/FR switch and a phone menu, all without scripts (`src/services/site-header.ts`). |
| 5 Menu | Download · Features · Community ▾ (Leaderboards, Find a guild, Recruitment, Players) · Help ▾ (Guides, For officers, WoW Forever launch, Ask on Discord) · Companion (`site/nav.mjs`). |
| 6 Homepage | Three paths (players, officers, looking for a guild) and a "This week on Guilded" strip fed by `/leaderboards/summary.json` (counts and top runs; no player names). The strip stays hidden until the bot answers. |
| 7 Empty states | Leaderboards, recruitment and the guild directory say what to do next instead of only "no results". |
| 9 Forever page | `/forever/`: key dates, a launch-week checklist for players and a pre-raid checklist for officers. |
| 10 Previews and search | 1200 × 630 link-preview card for static pages, bot pages and guild pages. The sitemap lists the public data pages; `robots.txt` names a bot-served sitemap of published guild pages whose officers allow indexing (player profiles are left out). |
| 11 Officer page | `/officers/`: addon-only vs bot, Lite vs full access, how approval works, five setup steps, Raid-Helper. |
| 14 Analytics | Cookie-free Cloudflare Web Analytics, off by default (see below). A short domain costs money and was not done. |

### Turning on analytics (optional)

Cloudflare dashboard → **Analytics & Logs → Web Analytics → Add a site** → `guilded.kcaron.top`
→ choose the JavaScript snippet (not automatic setup) and copy its token (32 hexadecimal
characters). Put it in `site/analytics.json` as `cloudflareBeaconToken` and merge. The build then
adds the beacon to the static pages and allows Cloudflare's script in the security policy. Bot pages
never load it. The privacy notice already describes it.

## What goes live when

- **Merge to main**: the static site and the Worker (Cloudflare's build deploys both): menu, homepage,
  new pages, images, cards, sitemap, analytics switch, retries and the error page.
- **Next bot deployment**: the header on bot-served pages, leaderboard intro and empty states,
  `/leaderboards/summary.json`, the guild-page sitemap, recruitment and directory hints, guild-page
  preview card and the Caddy snippet. Until then the homepage strip stays hidden and the second
  sitemap returns 404, which is harmless. No version bump was made.

## Verification

TypeScript, ESLint, the addon validator and the full test suite ran locally (see the pull request).
The static build was checked in a local preview at 1280 px and 375 px in English and French:
the drop-downs open and close (click elsewhere, Escape, one at a time), the phone menu works on
static and bot pages, and the pages have no horizontal scroll. A bot page header was rendered
locally with the real layout code.

Not verified: the deployed site, the Cloudflare DNS record, Caddy on the server, the analytics
beacon, screen readers and measured page speed.
