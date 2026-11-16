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

_Empty._

## Ready for Claude

Website redesign: R0.1–R0.7, P1, R1.1–R1.6, R2.1–R2.5 and CF1 are done (see Done). Still open: R1.7 (needs the owner's Cloudflare token), R2.6, R2.7. Avoid editing site/ files they touch without checking open PRs.

16 Nov 2026 audit: S1, S4, S5, S6, S8 are done (#1015, see Done); S2 and S3 are superseded (see Done); W1 is the next step for S1 to take effect. Open: S7, W1-W4, SEO3, SEO4, R1.7, R2.6, R2.7.

Priority order. Source: Grok Bot's read-only security review of main@8b073f5d, 10 Nov 2026 (`docs/security/SECURITY_REVIEW_2026-11-10.md` once added; summary below).

### S7. Mobile dependencies (Low)
- **Spec:** bump the Expo SDK and toolchain in `mobile/` to clear the glob/minimatch advisories (`npm audit` in `mobile/`).

### Website / Worker (Owner: Grok Bot)
- **W1 (after S1 is live):** `worker/index.mjs` `route()`: set `x-guilded-client-ip` from `cf-connecting-ip` for API and web requests, and drop that header from caller pass-through. Test in `tests/worker-routing.test.ts` that a caller-supplied value is overwritten.
- **W2:** HSTS on every Worker response (bot pages, API, redirects).
- **W3 (optional):** `x-frame-options: DENY` and `permissions-policy` on bot-rendered pages.
- **W4 (optional):** SHA-pin `actions/*` in `.github/workflows/*.yml`.

H1 in `docs/seo/SEO_AUDIT_2026-11-10.md` (HTTP 500) is a false alarm, already corrected at the top of that file. It is not a task.

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

### R1.7. Analytics on (High, Approved by Kevin 10 Nov 2026)
- **Owner:** Grok Bot (cloud agent)
- **Status:** In progress
- **Priority:** High
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md §9 and decision (d)
- **Spec:** Turn Cloudflare Web Analytics on (cookie-free). Kevin's beacon token goes in `site/analytics.json`. Do not invent a token and do not commit a fake one. An empty token omits the beacon. The beacon loads on static pages only. The site build updates CSP to allow it. `/privacy/` (and `/fr/privacy/`, decision (c)) says the site uses cookie-free Cloudflare Web Analytics. Decision (a): those canonicals stay on kcaron.top.
- **Files:** `site/analytics.json`, `scripts/build-site.mjs` (CSP and the beacon snippet), the privacy page under `site/pages/`.
- **Acceptance:** with a token set, the beacon is on static HTML and absent from bot and API responses, and CSP allows that host; with an empty token, no beacon and no request to a placeholder host; the privacy page names Cloudflare Web Analytics.
- **Open question (g):** defaults (Kevin can override): keep the headline "Less organizing. More playing."; keep self-hosting guides public under `/guide/`; keep same-name slugs under `/fr/`.
- **PR:** one PR, with a test.

### R2.6. Mobile app page (Medium, Approved by Kevin 10 Nov 2026)
- **Owner:** Grok Bot (cloud agent)
- **Status:** In progress
- **Priority:** Medium
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md §10 Phase 2 (R2.6)
- **Spec:** Publish a mobile-app page, linked from `/download/`, only once Android leaves preview or an iOS build exists. Until then do not add the page and do not invent store URLs; the R1.1 preview APK block stays. When it ships, show version, size and SHA-256 from `site/releases.json`. Drop the preview label only for a build that has actually left preview, and show iOS only when a real iOS build is listed. Decision (a): canonical on kcaron.top. Decision (c): French is `/fr/` plus the same slug. Decision (f): no PoE2 or Diablo app.
- **Files:** a new page under `site/pages/` (EN/FR pair), `site/releases.json`, `scripts/build-site.mjs`.
- **Acceptance:** while Android is still preview and no iOS build is listed, the page is absent and `/download/` still marks the APK as preview. When `site/releases.json` lists a non-preview Android build or a real iOS build, the page returns 200 with that version and no fake store button.
- **Open question (g):** defaults (Kevin can override): keep the headline "Less organizing. More playing."; keep self-hosting guides public under `/guide/`; keep same-name slugs under `/fr/`.
- **PR:** one PR, with a test.

### R2.7. Visual regression in CI (Medium, Approved by Kevin 10 Nov 2026)
- **Owner:** Grok Bot (cloud agent)
- **Status:** In progress
- **Priority:** Medium
- Source: docs/redesign/REDESIGN_PLAN_2026-11-10.md §10 Phase 2 (R2.7)
- **Spec:** On each PR, Playwright compares screenshots of six key pages (home, download, guide, reference, leaderboards, community) at 390 and 1280. The home shot includes the kept headline "Less organizing. More playing." Also shoot `/fr/download/` so a same-name `/fr/` slug miss fails the job (decisions (c) and (g)). Decision (a): the paths are the kcaron.top paths. Decision (f): no PoE2 or Diablo page in the set.
- **Files:** `.github/workflows/quality.yml` (or a workflow next to it), a Playwright spec under `tests/`.
- **Acceptance:** the job is green on an unchanged tree; it fails when one of those screenshots changes past the agreed diff; the six pages and `/fr/download/` are in the set.
- **Open question (g):** defaults (Kevin can override): keep the headline "Less organizing. More playing."; keep self-hosting guides public under `/guide/`; keep same-name slugs under `/fr/`.
- **PR:** one PR, with a test.

## In progress

_Empty. Format: item id, PR link, who._

## Done

_Format: item id, PR, release._

Moved here in the 16 November 2026 audit (checked against main). Items marked superseded were not built as written.

- **S2**: superseded by the owner decisions of 14 Nov 2026 (single-report runs are ranked; one witness is enough; #872, docs/plans/SINGLE_WITNESS_2026-11-13.md). Not built.
- **S3**: superseded by the same decisions; plausibility checks already exist (`src/services/run-plausibility.ts`, #872). Not built as specified.
- **SEO1**: superseded by R1.6 (French pages at `/fr/`, #756) and the redirect table (#820, #831).
- **SEO2**: superseded: guildedwow.com is the main site (#776); `canonicalRedirect` in `worker/index.mjs` handles the old hosts.
- **CF1**: #894, #937, #957, #1007 (pointer kept current; 9.3.5 files).
- **R0.1**: #737
- **R0.2**: #738
- **R0.3**: #739
- **R0.4**: #743
- **R0.5**: #740
- **R0.6**: #741
- **R0.7**: #742
- **P1**: #748 (site), #755 (companion)
- **R1.1**: #745
- **R1.2**: #751
- **R1.3**: #752
- **R1.4**: #749
- **R1.5**: #750
- **R1.6**: #756
- **R2.1**: #753
- **R2.2**: #754
- **R2.3**: #757
- **R2.4**: #758
- **R2.5**: #759

- **S1** (bot side): `clientAddress()` uses `x-guilded-client-ip` only when the peer is loopback and `x-guilded-origin` equals the `GUILDED_ORIGIN_TOKEN` environment variable (`timingSafeEqual`, length-checked); otherwise it falls back to `x-forwarded-for`. The variable is new on the bot: set it to the same value the Worker sends (`GUILDED_ORIGIN_TOKEN` secret) in the bot's environment, or the header stays ignored. `recordFailure` is called only for a present, well-formed credential. W1 (Worker sets the header) is still open (Grok Bot). PR: branch `claude/security-queue-s1-s8`. Release: not yet.
- **S4**: the Discord client defaults to `allowedMentions: { parse: ["users"], repliedUser: false }`; the two role-ping sends (LFG group post, invite-notify role ping) already pass explicit `roles`. PR: same branch. Release: not yet.
- **S5**: `selfRoleProblem` refuses any role that is a Guilded permission role (EN/FR names, Class Leader variants, scoped role ids); callers pass the role name. PR: same branch. Release: not yet.
- **S6**: `replyWithCommandError` shows `error.message` only for `isMemberAnswer(error)`. PR: same branch. Release: not yet.
- **S8**: `deploy/Caddyfile` log filter deletes the `key` query parameter from `request>uri`. PR: same branch. Release: not yet (copy the Caddyfile to the server on deploy).
