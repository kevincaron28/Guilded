# Guilded download and setup website

A static landing page with CurseForge/releases links, an illustrated owner guide,
member installation and a link builder for each guild's own online companion.
The landing page has no login, credentials or database. Cookie-free Cloudflare Web
Analytics is off until a beacon token is set in `site/analytics.json` (see
`docs/SITE_RELIABILITY_2026-10-29.md`). Its companion
link now uses the same website address; see `docs/UNIFIED_SITE.md`.

## One section per WoW edition

Each edition has its own section: `/forever/`, `/classic-era/`, `/tbc/`, `/mists/` and
`/retail/` (list: `EDITION_SECTIONS` in `site/nav.mjs`). The section's hub page is built from
`site/editions.mjs` (`editionHubs`): its leaderboard first, then its download, guilds and
first steps. Its data pages (`/retail/leaderboards/...`, `/retail/recruitment/...`,
`/retail/players/...`) are the bot's pages: the Worker sends `/leaderboards/...?edition=retail`
to the bot. The header's "Playing: …" switcher opens the same kind of page in another edition.
The Worker remembers the last edition in a `guilded_edition` cookie (no personal data), so
`/leaderboards/` opens that edition (Forever by default), and it moves older `?edition=` links
into their section. The signed-in `/me/` page stays outside the sections. `/editions/<id>/`
keeps each edition's download and install steps.

## Build and preview

From the repository root, with Node 24 and dependencies installed:

```text
npm run site:build
npm run site:preview
```

Open http://127.0.0.1:8800. Output is `dist/site/`; the preview binds only to the
local PC. Edit guide Markdown in `docs/`, then rebuild. Do not edit generated HTML.
`npm run release:prepare` builds this site alongside the addon and companion.
The site build refuses missing relative guide/image targets.

## Publish

### Cloudflare Worker (website and companion routing)

`wrangler.jsonc` defines the `guilded-wow` Worker with `dist/site` as its public
asset directory. `worker/index.mjs` forwards companion and supported API requests
to the existing Oracle bot. Personal pairing and guild authorization stay there.
No bot token or database credentials are included. Static asset requests use
Cloudflare's asset hosting; proxied requests execute the Worker.

```text
npm run worker:build
```

This builds the site and runs Wrangler's **dry run**; it does not publish.
The manual deployment command is `npm run worker:deploy`. The existing Workers
Git integration uses build `npm run site:build`, deploy `npx wrangler deploy`,
and production branch `main`. Use Node 24. No bot
environment variables belong in the Worker.

Cloudflare browser access was restored on 5 October 2026. The public landing page
is now https://guilded-wow.kcaron.workers.dev/. Worker configuration
is now integrated with the companion/setup release branch for publication on main.
See `docs/WEB_COMPANION_ROLLOUT.md` for deployment and acceptance evidence.

Reference: https://developers.cloudflare.com/workers/static-assets/get-started/

### Other static hosts

Publish **only the contents of `dist/site/`** to a static HTTPS host. For GitHub
Pages, use a Pages artifact containing that directory, with build command
`npm ci && npm run site:build`. This is independent of the Oracle bot service.
Never upload the repository root, local environment files, backups or SSH keys.
No production host was configured or published during the local rehearsal.

Before public launch, confirm the intended release assets are actually available,
replace any beta status text when acceptance is complete, and check the download
links from a signed-out browser. All paths support hosting under a project subpath.
There are no made-up third-party addon links: add other addons only after their
exact project/download URLs are supplied and checked.

The Quebec Gold companion link is labelled for Quebec Gold members only. The
guild-address form makes a same-browser link and strips unrelated URL parameters;
it never requests or forwards pairing codes. Each other guild hosts its own bot.

Screenshots and provenance: `docs/images/owner-setup/README.md`. Screenshots of
vendor tutorial examples are labelled as such and must not be presented as a
completed real-account install test.

## Design refresh — 15 October 2026

The product homepage, feature guide and four French community pages share a
charcoal, warm gold and ivory palette, serif accents, a consistent navigation
and responsive layouts. Public guides inherit the same shell. Content remains
in `site/index.html`, `site/pages/*.md` and the existing guide Markdown sources.
The creator homepage retains its previous base styles in `site/creator/base.css`
so the shared product stylesheet does not change its appearance.

The previous homepage gave setup details and competing links similar weight,
introduced the community before explaining the toolkit, and relied on a logo
to show the product. The revised page leads with the addon, offers a keyboard
accessible feature tour, separates player/member/owner starting paths, and
explains optional synchronization in three steps. The tour describes features;
it does not display live guild data or pretend to be a product screenshot.

Official competitor websites reviewed on 15 October 2026:

| Reference | Useful pattern | Applied to Guilded |
| --- | --- | --- |
| [Raid-Helper](https://raid-helper.xyz/) | A visible product example and a direct getting-started action | Feature tour beside the primary addon action |
| [wowaudit](https://wowaudit.com/) | Specific workflows and product previews explain a broad toolkit | Distinct in-game, dungeon, companion and Discord sections |
| [That's My BIS](https://thatsmybis.com/) | A focused explanation of the player's problem | Benefit-led copy and clear player/member/owner paths |

These are presentation references, not claims of equivalent client support,
pricing, functionality or adoption. No testimonials, player statistics or
compatibility claims were invented. Published versions shown on the site come from
`site/releases.json` (7.3.1 GitHub, 7.3.0 CurseForge on 22 October 2026); update it with each upload.

The static preview does not proxy `/companion/` or call the live bot. Companion
links intentionally keep the existing production route for eventual hosting.
The guild-address form builds a link locally, requires HTTPS, rejects embedded
credentials, and discards unrelated query parameters. Do not pair an account
or upload game data as part of public website QA.

Verification for this refresh: `site:build`, TypeScript, ESLint and addon
validation passed; the full Vitest rerun passed 184 files / 1,548 tests with
`--testTimeout=30000` after the initial slow run. The static audit checked 16
HTML pages and 288 internal links/assets with no missing targets. Browser QA
covered the desktop homepage, phone layouts down to a 320px viewport, all
community pages, features and a setup guide, plus the tour's keyboard controls,
mobile navigation and companion link validation. The static preview made no
production pairing or upload requests. Local screenshots and detailed checks
are retained in `backups/site-polish-20261015/` (not public build assets).
