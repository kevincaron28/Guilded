# AI handoff: ideas → research → ready for Claude

One shared document between Kevin (owner), Grok Bot (research, analysis, design, website/worker, marketing, security, testing) and Claude Code (main coder for the addon, companion apps, mobile app and bot).

**How it works**
1. Kevin drops an idea in **Inbox** (one line is enough).
2. Grok Bot researches and analyses it, then moves it to **Researched** with a recommendation (value, effort, risks, open questions).
3. Once Kevin approves, Grok Bot writes it up in **Ready for Claude** with a spec and acceptance checks. Claude works only from this section.
4. Claude moves the item to **In progress** with the PR link, then to **Done** with the PR and the release it shipped in.

**Rules**
- Claude: pick items from **Ready for Claude**, top first. One PR per item, each with a test. Don't change behaviour beyond the spec. If a spec is unclear, write the question under the item and skip it until it's answered.
- Website/worker items marked `Owner: Grok Bot` are done by Grok Bot, not Claude.
- Nothing merges, deploys or publishes without Kevin's OK. Deploy only after a backup.
- Keep each item short. Detailed design notes go in `docs/` and get linked from the item.
- `ROADMAP.md` stays the release and status record. This file is the work queue.

---

## Inbox (Kevin's raw ideas)

_Empty. Add one line per idea: date, idea._

## Researched (waiting for Kevin's decision)

### Phase 1. New site structure (R1.1–R1.7)
- **Status:** Awaiting Kevin's go-ahead. Not in Ready for Claude.
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md §10 Phase 1.
- **Summary:** R1.1 Download hub (`/download/`). R1.2 Navigation cut to 6 items. R1.3 Guide consolidation (each fact once, §6 redirects). R1.4 Quick reference v2. R1.5 Leaderboards v2. R1.6 Bilingual URLs. R1.7 Cloudflare Web Analytics on (decision (d) approves analytics; the `site/analytics.json` token still comes from Kevin). Write each item in this file's Goal / Files / Acceptance format only when it moves to Ready.
- **Decisions that apply:** (b) drop `/forever/` from leaderboard and community URLs (Guilded is Forever-only now), with 301s from the old URLs. (c) French pages move to a `/fr/` folder, replacing `?lang=fr` long term, with 301s. Translated vs same-name FR slugs stays open (decision (f)).
- **Recommendation:** Leave this phase here until Kevin says go. The plan says not to ship the new URLs without SEO1–SEO4.

### Phase 2. Polish and growth (R2.1–R2.7)
- **Status:** Awaiting Kevin's go-ahead. Not in Ready for Claude.
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md §10 Phase 2.
- **Summary:** R2.1 Community hub. R2.2 Home rebuild. R2.3 Shared component CSS. R2.4 Docs search. R2.5 Player and guild pages. R2.6 Mobile app page. R2.7 Visual regression in CI. The plan says each follows the same Goal / Files / Acceptance format when it moves into this file.
- **Decisions that apply:** (b) and (c), same as Phase 1: drop `/forever/` from leaderboard and community URLs, with 301s from the old URLs, and move French pages to a `/fr/` folder (replacing `?lang=fr` long term, with 301s).
- **Recommendation:** Leave this phase here until Kevin says go, after Phase 1.

## Ready for Claude

Priority order. Source: Grok Bot's read-only security review of main@8b073f5d, 10 Nov 2026 (`docs/security/SECURITY_REVIEW_2026-11-10.md` once added; summary below).

### S1. Real client IP for bot rate limits (High)
- **Problem:** the bot reads the client IP from Caddy's `X-Forwarded-For`, but every request arrives through the Cloudflare Worker, so all users share one IP. About 10 bad credentials lock the whole companion API for everyone for 10 minutes (`src/companion-api.ts` around L154 and L739), and the device registration and upload limits (`companion-device.ts` L27-35) become global caps.
- **Spec:** `src/companion-api.ts` `clientAddress()`: when the peer is loopback AND header `x-guilded-origin` equals the configured origin token (`timingSafeEqual`), use header `x-guilded-client-ip`; otherwise keep the current logic. Only call `recordFailure` when a secret or code was present and well-formed.
- **Acceptance:** a test shows two different client IPs don't share `isLockedOut`, `deviceRegistrations` or `deviceUploadsPerIp`.
- **Order:** ship this bot side first (it falls back safely). Then W1 below (Grok Bot) makes the Worker set the header.

### S2. Device-only runs off the public boards (High, Kevin approved 10 Nov 2026; partly reverses #726)
- **Problem:** with no Discord account, anyone can register a device key, claim any guild name (matched only by declared name, `companion-device.ts` L194) and post fake runs to the public Season 1 boards. Two keys make a run "witnessed".
- **Spec:** `src/services/public-runs.ts`: exclude `trust: "device"` and `trust: "witnessed"` from public leaderboards in every season (keep them on the guild board, badged unverified) unless the run is `anchored`. `src/services/run-trust.ts` `independent()`: a witness counts only if at least one of the two devices is claimed by a member, or the devices differ in registration IP (after S1) and are more than 24 h old. Device-only runs can never hold rank 1 or the top 3.
- **Acceptance:** tests for each rule above.

### S3. Record plausibility (Medium)
- **Spec:** `public-runs.ts`: per-instance minimum clear time (start from the observed 5th percentile, fall back to 45 s per boss). A run that beats the current #1 by more than 10% stays pending until a second party member uploads it or an officer reviews it.

### S4. Global mention safety (Medium)
- **Spec:** `src/main.ts`: `new Client({ ..., allowedMentions: { parse: ["users"], repliedUser: false } })`. Call sites that need a role ping pass explicit `roles: [id]`; grep raid call-outs and signups and opt them in.
- **Acceptance:** a test that the Client option is set.

### S5. Self-roles can't grant Guilded authority (Medium)
- **Spec:** `src/services/selfrole.ts` `selfRoleProblem`: also return a problem if `isPermissionRole(p, role)` is true for any `Permission` key (EN/FR names, Class Leader variants, scoped role IDs).
- **Acceptance:** tests with "Raid Leader" and "Chef de classe (Guerrier)" roles that have no Discord permissions.

### S6. Don't show raw errors (Low)
- **Spec:** `src/commands/context.ts` L63: use `error.message` only when `isMemberAnswer(error)`; otherwise show the generic text.

### S7. Mobile dependencies (Low)
- **Spec:** bump the Expo SDK and toolchain in `mobile/` to clear the glob/minimatch advisories (`npm audit` in `mobile/`).

### S8. Caddy log redaction (Low)
- **Spec:** `deploy/Caddyfile` log filter: also redact the `key` query parameter in `request>uri`.

### Website / Worker (Owner: Grok Bot)
- **W1 (after S1 is live):** `worker/index.mjs` `route()`: set `x-guilded-client-ip` from `cf-connecting-ip` for API and web requests, and drop that header from caller pass-through. Test in `tests/worker-routing.test.ts` that a caller-supplied value is overwritten.
- **W2:** HSTS on every Worker response (bot pages, API, redirects).
- **W3 (optional):** `x-frame-options: DENY` and `permissions-policy` on bot-rendered pages.
- **W4 (optional):** SHA-pin `actions/*` in `.github/workflows/*.yml`.

H1 in `docs/seo/SEO_AUDIT_2026-11-10.md` (HTTP 500) is a false alarm, already corrected at the top of that file. It is not a task.

### SEO1. Worker-localize French `?lang=fr` for /start/, /docs/*, /guides/*, /reference/, /quebec-gold/ (High, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Interim fix; long-term French moves to /fr/ folder per redesign item R1.x — keep changes compatible.
- Source: docs/seo/SEO_AUDIT_2026-11-10.md (H2)
- **Spec:** In `wrangler.jsonc` `assets.run_worker_first`, keep the existing entries (including `/quebec-gold/cores` and `/quebec-gold/wow`) and add `/docs`, `/docs/*`, `/guides`, `/guides/*`, `/start`, `/start/`, `/reference`, `/reference/`, `/quebec-gold`, `/quebec-gold/`, `/quebec-gold/*`, `/status`, `/status/`. `worker/localized-assets.mjs` then rewrites those HTML pages for `?lang=fr` (no separate change there if every public HTML page already goes through it): `html lang`, visible copy, title, description, canonical and `og:url`. The FR URL's canonical and `og:url` are the FR URL (with `?lang=fr`). hreflang `en` / `fr` / `x-default` stay and still point at the two language URLs. Optional in the same change: also rewrite `<script type="application/ld+json">` language / `inLanguage` / description when a French block exists.
- **Acceptance:** For each of `/start/?lang=fr`, `/docs/QUICK_START?lang=fr`, `/docs/PRIVACY?lang=fr`, `/guides/install/?lang=fr`, `/guides/link/?lang=fr`, `/quebec-gold/?lang=fr`, `/reference/?lang=fr`: HTTP 200, `Content-Language: fr`, `<html lang="fr">`; `<link rel="canonical">` and `og:url` are the FR URL (with `?lang=fr`); `<title>` and meta description are French (`data-content-fr` applied); `[data-language-copy="fr"]` is not `hidden` and `[data-language-copy="en"]` is `hidden`; hreflang en / fr / x-default still present and still pointing at the two language URLs; curl with the Googlebot UA matches the browser UA. English URLs (no `lang`, or `lang=en`) are unchanged.
- **PR:** one PR, with a test.

### SEO2. One canonical host: 301 www.kcaron.top to apex, and canonical tags so kcaron.top and guilded.kcaron.top don't duplicate each other (High, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/seo/SEO_AUDIT_2026-11-10.md (H3)
- Decision: kcaron.top is primary (Kevin, 10 Nov 2026).
- **Spec:** In `worker/index.mjs` `route()`, early, before asset or bot handling. (1) `www.kcaron.top` → 301 `https://kcaron.top` plus pathname and search (`/` stays `/`). (2) On `guilded.kcaron.top`, `/creator`, `/creator/` and `/creator/index.html` → 301 `https://kcaron.top/` (keep `?lang=` if present). (3) On `kcaron.top` or `www.kcaron.top`, a Guilded product path (`/features`, `/start`, `/docs`, `/guides`, `/officers`, `/companion`, `/editions`, `/forever`, `/reference`, `/status`, `/quebec-gold`, `/g/`, and the rest of that set) → 301 the same path on `https://guilded.kcaron.top`. Keep serving `/`, `/robots.txt`, `/sitemap.xml`, `/support` and the Google verification file on kcaron.top. Canonical tags name that primary host so kcaron.top and guilded.kcaron.top do not both look indexable for the same page (apex for the creator homepage, `guilded.kcaron.top` for Guilded pages under the default proposal). (4) Rewrite `site/creator/index.html` so the creator homepage is clearly "K Caron Projects / Kevin Caron" (title, H1, description, JSON-LD `WebSite` / `Person`) and links to Guilded as a product. (5) `www.guilded.kcaron.top`: leave it unpublished, or add it in `wrangler.jsonc` and 301 it to `https://guilded.kcaron.top`. Do not leave it as a TLS error if it will be typed or linked.
- **Acceptance:** `curl -sSI https://www.kcaron.top/` → 301 `Location: https://kcaron.top/`. `curl -sSI https://www.kcaron.top/?lang=fr` → 301 `https://kcaron.top/?lang=fr`. `curl -sSI https://guilded.kcaron.top/creator/` → 301 `https://kcaron.top/`. `curl -sSI https://kcaron.top/features/` → 301 `https://guilded.kcaron.top/features/`. `https://kcaron.top/` and `https://guilded.kcaron.top/` remain 200, with clearly different titles, H1s and descriptions. The kcaron.top sitemap still lists only `https://kcaron.top/` and `https://kcaron.top/?lang=fr`.
- **PR:** one PR, with a test.

### SEO3. Canonical + hreflang on bot-served public pages (leaderboards, recruitment, guild pages), stop Accept-Language switching when ?lang is absent for crawlers, drop the duplicate ?lang=en internal links (High, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/seo/SEO_AUDIT_2026-11-10.md (H4)
- **Spec:** (1) `src/services/web-layout.ts` `layout()`, for indexable pages (`!input.noindex`): emit `<link rel="canonical" href="https://guilded.kcaron.top{canonicalPath}">`, `og:url` with the same value, hreflang `en` and `x-default` at the canonical EN URL, and hreflang `fr` at the same path with only `?lang=fr`. The canonical EN path is the section URL without `?lang=` and without filter params that should be noindexed (or one consistent minimal set). (2) `langFrom()`: public indexable routes (`/leaderboards`, `/recruitment`, `/players`, `/g/`) default to `"en"` when `?lang` is absent. Do not use `Accept-Language` to switch that HTML, including for crawlers. `Accept-Language` can remain for `/me/` and other `noindex` pages. (3) `link()` in `web-layout.ts` stops adding `?lang=en` on internal EN links. 301 `?lang=en` to the clean URL (strip `lang=en` only), in the Worker for GET on those paths, or in the bot with the existing redirect pass-through. (4) Filter query strings (season, dungeon, class, realm and the rest): either canonical to the unfiltered page and `noindex,follow` the filtered views, or canonicalize every filter back to the unfiltered page. Filtered URLs stay unindexed unless they have a self or parent canonical. (5) The same canonical, hreflang and `og:url` on `src/services/guild-page.ts` for published, indexable guild pages (canonical `https://guilded.kcaron.top/g/{slug}/`, FR `?lang=fr` when a French rendering exists). (6) `scripts/build-site.mjs`: add the FR bot section URLs (`/forever/leaderboards/?lang=fr`, guilds, recruitment, players) to the sitemap once those canonicals are self-referencing. Keep `/g/{slug}/` only in the bot sitemap (`src/services/guild-directory.ts`).
- **Acceptance:** `curl -s https://guilded.kcaron.top/forever/leaderboards/` with no `lang` and `Accept-Language: fr` still returns English `html lang="en"` (or a 301/302 to `?lang=fr` — pick one rule and test it), with a self-canonical to `https://guilded.kcaron.top/forever/leaderboards/` and hreflang `fr` to `…?lang=fr`. `curl -s https://guilded.kcaron.top/forever/leaderboards/?lang=fr` returns French, canonical `…?lang=fr`, hreflang back to the clean EN URL. `curl -sSI https://guilded.kcaron.top/forever/leaderboards/?lang=en` → 301 to `/forever/leaderboards/`. `https://guilded.kcaron.top/g/quebec-gold/` has a self-canonical and is listed in `/recruitment/guilds/sitemap.xml`. `/me/` remains `noindex` and is not added to any sitemap. Internal links do not point at `?lang=en`.
- **PR:** one PR, with a test.

### SEO4. Redirect and sitemap hygiene: 301 instead of 302/307 (H5), sitemap lastmod and remove weak FR/query URLs (M1), disallow /me/, /auth/, /api/, /health in robots.txt (M2) (Medium-high, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/seo/SEO_AUDIT_2026-11-10.md (H5, M1, M2)
- **Spec:** H5, in `worker/index.mjs`, now that Forever is the only edition: 301 with a long `cache-control` for `/leaderboards`, `/recruitment`, `/players` (and `/guilds` under them) to `/forever/…`. Retired edition sections already 301; keep that. One hop only: `/forever/leaderboards` → `/forever/leaderboards/` directly, not through `?edition=forever`. Trailing-slash and `.html` cleanup (`wrangler.jsonc` `html_handling: "auto-trailing-slash"` is a 307 today): 301 those paths in the Worker before `ASSETS.fetch` (using the SEO1 `run_worker_first` routes), or document that Cloudflare Assets 307 cannot be changed and add explicit 301 rules for the public HTML routes. Leave a true temporary hold (a held PoE2 page while `POE_ENABLED` is false) as 302. M1, in `scripts/build-site.mjs` after SEO1 and SEO3: keep only sitemap URLs that return 200, self-canonicalize and match the hreflang pair. Add a real `lastmod` from the git commit date or the source file mtime (do not invent dates). Remove weak FR/query URLs that are not valid language alternates. Drop `/status/` from the sitemap, or mark it `noindex` if it should not rank. If PoE2 is held, redirect it and remove it from the sitemap; if it is public, add hreflang or leave it as a single-language URL with no fake EN alternate. The same `lastmod` rule applies to the kcaron.top sitemap the build writes over `site/creator/sitemap.xml`. M2, Guilded `robots.txt` from `scripts/build-site.mjs` (the Worker must not override it), and `X-Robots-Tag: noindex` on `/health` and `/api/*` JSON:

```
User-agent: *
Allow: /
Disallow: /me
Disallow: /me/
Disallow: /auth/
Disallow: /api/
Disallow: /health
Disallow: /owner
Disallow: /owner/
Sitemap: https://guilded.kcaron.top/sitemap.xml
Sitemap: https://guilded.kcaron.top/recruitment/guilds/sitemap.xml
```

kcaron.top robots can stay `Allow: /` once product paths 301 away (SEO2).
- **Acceptance:** `curl -sSI https://guilded.kcaron.top/leaderboards/` → 301 `Location: /forever/leaderboards/` (or the absolute HTTPS equivalent), one hop. `curl -sSI https://guilded.kcaron.top/forever/leaderboards` → 301 `Location: /forever/leaderboards/`, one hop, no `?edition=`. `curl -sSI https://guilded.kcaron.top/start` → 301 (not 307) to `/start/`. `curl -sSI https://guilded.kcaron.top/docs/PRIVACY.html` → 301 to `/docs/PRIVACY`. Every `<loc>` in both sitemaps returns 200 (after one 301 at most), has a matching self-canonical, and is not `noindex`. `lastmod` is present and not in the future. `curl -s https://guilded.kcaron.top/robots.txt` contains those Disallows; `/me/` and `/health` are blocked and public pages stay allowed.
- **PR:** one PR, with a test.

Redesign Phase 0 quick wins from `docs/redesign/REDESIGN_PLAN_2026-11-10.md` §10 (Approved by Kevin 10 Nov 2026). No new information architecture. One PR per item, each with a test. Phase 1 and Phase 2 stay in Researched until Kevin's go-ahead.

### R0.1. Remove single-edition leftovers (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.1)
- **Spec:** No "Choose your WoW" menu and no "edition/every version" wording.
- **Files:** `site/nav.mjs` (`editionMenu`, version switcher), `scripts/build-site.mjs` (`versionMenu`), `site/index.html`, `src/services/web-layout.ts`.
- **Acceptance:** Header on static and bot pages has no edition drop-down; `grep -ri "every version\|choose your edition\|Choose your WoW"` in built `dist/site` and bot HTML returns nothing (EN and FR equivalents too); site tests pass.
- **PR:** one PR, with a test.

### R0.2. "Get the addon" goes straight to the downloads (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.2)
- **Spec:** 2 clicks max from home to CurseForge or the zip.
- **Files:** `site/nav.mjs` (`SITE_NAV` cta href → `/editions/forever/`), `worker/index.mjs` (301 `/editions/` → `/editions/forever/`, keep `?lang`).
- **Acceptance:** `curl -sI https://guilded.kcaron.top/editions/` → 301 to `/editions/forever/`; header button lands on a page whose first screen shows the CurseForge and zip buttons at 1280 and 390 px.
- **PR:** one PR, with a test.

### R0.3. Hide zero metrics (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.3)
- **Spec:** Never show "0 … this week" as a headline.
- **Files:** `site/index.html` + `site/site.js` (live strip), `site/editions.mjs` (Forever hub), `src/services/public-leaderboard.ts` ("Top runs this week" block).
- **Acceptance:** With 0 weekly runs the home strip and the weekly block are hidden or replaced by one sentence + link; with >0 they render as today.
- **PR:** one PR, with a test.

### R0.4. Leaderboard readability pass (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.4)
- **Spec:** Data first, no clipping, less noise.
- **Files:** `src/services/public-leaderboard.ts`, `src/services/web-layout.ts` (CSS).
- **Acceptance:** Brackets shown one at a time with a 15–29 / 30–44 switch (or stacked full width); no "WoW Forever" text inside rows; class shown once (colour + text, not capitals); privacy line moved below the table; at 390 px no table needs sideways scroll and the first ranking row is within 900 px of the top; at 1280 px no column is cut off (Playwright screenshot check).
- **PR:** one PR, with a test.

### R0.5. Footer and install-link cleanup (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.5)
- **Spec:** One install path.
- **Files:** `site/nav.mjs` (`FOOTER_NAV`).
- **Acceptance:** Footer Help column has at most 4 links (Install guide → `/guides/install/`, Quick reference, Setup help, Status); "Quick start" and "Install guide (MEMBER_INSTALL)" removed from nav (pages still reachable).
- **PR:** one PR, with a test.

### R0.6. Version line (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.6)
- **Spec:** One version users can trust. Kevin (10 Nov 2026): CurseForge is supposed to be current — being investigated (decision (e)). Do not show two version numbers while that is open.
- **Files:** `site/index.html`, `site/releases.json`, `scripts/build-site.mjs`.
- **Acceptance:** Home shows one version + date; if CurseForge lags, a small note "CurseForge updates can take a day" instead of two numbers. Use that note only if the investigation shows CurseForge is actually behind.
- **PR:** one PR, with a test.

### R0.7. Fonts (Quick win, Approved by Kevin 10 Nov 2026)
- **Owner:** Claude
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md (R0.7)
- **Spec:** Lighter first load.
- **Files:** `site/fonts/`, `site/design-tokens.css`.
- **Acceptance:** Source Serif shipped as woff2; total font bytes on cold home load at least 40% lower than today's 536 KB of font files; no visual change in screenshots.
- **PR:** one PR, with a test.

## In progress

_Empty. Format: item id, PR link, who._

## Done

_Empty. Format: item id, PR link, release._
