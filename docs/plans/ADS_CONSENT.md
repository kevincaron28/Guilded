# Consent-gated Google AdSense (prepared 12 November 2026, switched off)

Publisher `pub-6948243189424271`. Ads run on guildedwow.com and the creator page kcaron.top. Nothing changes for
visitors until the switch is turned on; only `ads.txt` is live at once (it is inert).

## Switch names

| Name | Where | What it does |
|---|---|---|
| `GUILDED_ADS=on` | Cloudflare → Workers & Pages → `guilded-wow` → Settings → Variables (the Worker answers static **and** bot-rendered pages, so this one switch covers both; `keep_vars` keeps it across deploys) | Turns on the banner, `/consent.js` and the wider CSP on the allowed pages. Anything but `on` = off. |
| `LOAD_AFTER_DECLINE` in `worker/consent-script.mjs` | one line in code | `true` (default, owner decision 12 Nov): Decline loads AdSense in non-personalised mode (`requestNonPersonalizedAds = 1` set first). `false`: Decline loads nothing. |

**Since 12 November 2026 the switch lives in `wrangler.jsonc` (`vars`), not the dashboard; rollback = revert that PR** (or set `GUILDED_ADS` to anything but `on`). Dashboard variables not named in `vars` are kept (`keep_vars`); `vars` wins for the names it sets.

Original rollback note: delete the variable. Pages go back to the strict policy at once (HTML is not cached).

## How it works

- `worker/ads.mjs`: `adPage()` is the allow-list; `withAds()` adds `<script src="/consent.js" defer>` to allowed HTML
  page views and widens the response's own Content-Security-Policy with Google's ad hosts only there (strict
  `default-src 'none'` bot pages and the static `site/_headers` policy are both handled, no other directive loosened).
  The bot's `web-layout.ts` and `site/_headers` stay strict and untouched, so every other page keeps its policy.
- `worker/consent-script.mjs`: English/French banner, Accept and Decline equally prominent, choice in
  `localStorage` (try/catch), footer button "Cookie choices / Choix de témoins". No Google script before a choice.
  Accept loads `adsbygoogle.js?client=ca-pub-6948243189424271` (async, crossorigin anonymous), personalised; Decline loads the same loader non-personalised. Auto ads are switched on
  in AdSense; there are no manual ad units.
- Allowed: home (`/`, `/fr/`), `/leaderboards/**` and `/players/**` (also inside `/forever/`), `/g/<slug>/`, the
  guides hub and the dungeons, EPGP, Discord bot and link-character guides, and the kcaron.top creator page.
  Never: download, companion, install, start, self-host, officers, sign-in, `/me`, owner, `/api`, `/downloads`,
  `releases.json`, any `.json/.xml/.png` file. Hall of Fame has no web page yet, so nothing to allow.
- `wrangler.jsonc`: `/guide/*`, `/fr/*`, `/ads.txt`, `/consent.js` run the Worker first, so static guide pages can get the banner.
- `ads.txt` is answered by the Worker on every host (including `guilded.kcaron.top` after the canonical redirect is on:
  it is excluded from that redirect).
- Privacy page: "Advertising and cookies" / "Publicité et témoins" sections in `docs/PRIVACY.md`, naming Kevin Caron as the
  person responsible (contact through the page's existing private request route; no email published). They say plainly
  that non-personalised ads still let Google set cookies for measurement and fraud prevention.

## Before switching on (owner)

1. Confirm `/docs/PRIVACY` shows the new section live.
2. In AdSense, add `guildedwow.com` and `kcaron.top`, wait for `ads.txt` to be seen, enable Auto ads, exclude ad
   categories you do not want, and set the Google consent options for Canada.
3. Set `GUILDED_ADS=on`; check a guide page, the leaderboards and the creator page in a private window (banner
   first, no `googlesyndication` request until a choice).

## Only verifiable live

Whether AdSense approves the sites and fills Auto ads, Google's actual cookies and requests after Accept, that
Google's CSP host list is complete for every ad format (the browser console will name any blocked host), banner
layout on the real site themes and phones, and the Cloudflare behaviour of `run_worker_first` for `/guide/*` and `/fr/*`.
