# Moving Guilded's public home to guildedwow.com

Status: prepared 12 November 2026 (nothing deployed, no DNS or account changed). The owner bought
`guildedwow.com` at Porkbun.

## What uses the old address today

The product lives on **`guilded.kcaron.top`** (one Cloudflare Worker, `guilded-wow`, in front of the bot
at `bot.kcaron.top`). `kcaron.top` itself is only the owner's creator page; `dl.kcaron.top` is the R2
download mirror.

| Group | Where | Moves? |
|---|---|---|
| a. Pages, canonical, sitemap | `scripts/build-site.mjs` (`origin`), `site/index.html`, bot pages (`web-layout.ts`, `guild-page.ts`, `guild-directory.ts` sitemap), many `guilded.kcaron.top/...` mentions in Discord text, card footers, `/help`, docs | Yes |
| b. APIs | companion `HOSTED_UPLOAD_URL` (`companion/engine.mjs`), `companion-app/main.cjs`, `companion/request.mjs`, phone app default server, addon `/companion/` and `/downloads/` links (`Util.lua`, `CompanionLink.lua`) | **No, stays forever** |
| c. OAuth | Discord redirect `https://guilded.kcaron.top/auth/callback`, built from `PUBLIC_SITE_URL` (`web-auth.ts`). Battle.net is retired (docs/BATTLENET_SETUP.md) | Yes (add both) |
| d. Downloads | `/downloads/Guilded.Companion.Setup.exe`, `/releases.json` (companion auto-update feed, `companion-app/update-check.cjs`), Android APK redirect, `dl.kcaron.top` R2 mirror | **Stay forever**; mirror host stays |
| e. Listings | Play listing (website, privacy, account deletion URLs), Microsoft Store listing, CurseForge descriptions, GitHub README | Later, at leisure; 301s keep them working |
| f. Email | none found in code (Resend domain is separate) | n/a |

## Design

Owner decision (12 November 2026): `guildedwow.com` is Guilded's **main** site, not an extra address.

1. **`guildedwow.com` is the canonical public address**; `www.guildedwow.com` redirects to it.
2. **The same Worker serves all of: `guildedwow.com`, `www.guildedwow.com`, `guilded.kcaron.top`.** One
   deploy, one bot, no second copy to keep in step.
3. **`guilded.kcaron.top` answers forever.** Released companions, addons and phone apps contain it, so
   API calls (POSTs included), `/downloads/*`, `/releases.json`, `/health` and any `.json`/`.xml` file are
   answered in place on that host and never redirected.
4. **Only browser page views on the old host move**: GET/HEAD get a **301** to the same path on
   `guildedwow.com` (`canonicalRedirect` in `worker/index.mjs`), turned on by the Worker variable
   `GUILDED_CANONICAL_HOST=guildedwow.com`. Unset = off, so merging changes nothing. Pages and POSTs on
   the canonical host never redirect, so web sign-in (cookies are per host) works on exactly one host.
5. **Clients keep their API host.** The next companion/addon release may default to `guildedwow.com`,
   but it is not needed and is not in this change; old and new hosts reach the same Worker.
6. **One place per component:** bot `src/site-url.ts` (`siteOrigin()`, follows `PUBLIC_SITE_URL`, default
   unchanged); site build `SITE_ORIGIN` (Cloudflare build variable, default unchanged); Worker
   `GUILDED_CANONICAL_HOST`. The flip is configuration, not code, and so is the rollback.
7. **`wrangler.jsonc` routes are deliberately not edited in this PR.** `custom_domain` routes fail the
   deploy until the zone is active in Cloudflare, which would break every site deploy on merge. Add them
   in a second tiny PR (snippet in step 6 below) once the zone is active.

Not changed on purpose: stored Discord text that mentions `guilded.kcaron.top/...` (it redirects, and
changing every string is churn), `uptime.yml` checks (update after cut-over), `dl.kcaron.top`, the owner
creator page, the addon `Locale.lua` strings (new addon release only).

## Order of steps

1. Merge this PR (no behavior change). Do not deploy yet.
2. Porkbun and Cloudflare setup (checklist below); wait until the zone is **Active**.
3. Add the two routes in a small PR (see checklist 6), merge; the Worker deploys and now answers on
   `guildedwow.com`. Check `https://guildedwow.com/health` and the home page. Nothing has moved yet.
4. Add `https://guildedwow.com/auth/callback` in the Discord developer portal **next to** the old one.
5. **Cut-over, in one sitting:** on Oracle set `PUBLIC_SITE_URL=https://guildedwow.com` and restart the bot
   (backup first, one bot only); in Cloudflare set Worker variable `GUILDED_CANONICAL_HOST=guildedwow.com`
   and build variable `SITE_ORIGIN=https://guildedwow.com`, then redeploy the Worker. Members sign in again once.
6. Verify (below), update the Search Console, Store/Play/CurseForge listings and `uptime.yml` over the next days.

## Rollback

Reverse step 5 only: unset `GUILDED_CANONICAL_HOST` and `SITE_ORIGIN`, set `PUBLIC_SITE_URL` back, restart the
bot, redeploy the Worker. The old host never stopped answering, so no client is affected. Browsers cache the
301 for an hour (`max-age=3600`), then follow again. Keep the old Discord redirect URI until the move is settled.

## Owner / master checklist (click by click)

1. **Porkbun** → Domain Management → `guildedwow.com` → *Authoritative Nameservers* → **Edit** → replace with
   the two Cloudflare nameservers shown in step 2 → Save. (Cloudflare gives the names; Porkbun also has
   WHOIS privacy and auto-renew switches: turn auto-renew on.)
2. **Cloudflare** (same account as `kcaron.top`) → *Add a domain* → `guildedwow.com` → Free plan → let it scan
   (no existing records needed; delete Porkbun's parking `ALIAS`/`CNAME` records if it imports them) →
   copy the two nameservers into Porkbun (step 1) → *Done, check nameservers*. Wait for **Active** (minutes to hours).
3. **Cloudflare → guildedwow.com → SSL/TLS**: mode *Full (strict)*; turn on *Always Use HTTPS*. No manual
   A/CNAME records: the Worker custom domain creates them.
4. **Email, if wanted later**: Resend → Domains → add `guildedwow.com` and paste its DNS records. Not needed for the move.
5. **Discord** developer portal → the Guilded application → OAuth2 → Redirects → **Add Redirect**
   `https://guildedwow.com/auth/callback` → Save. Keep `https://guilded.kcaron.top/auth/callback`.
6. **Worker custom domains** (second PR): add to `routes` in `wrangler.jsonc`
   `{ "pattern": "guildedwow.com", "custom_domain": true }` and
   `{ "pattern": "www.guildedwow.com", "custom_domain": true }`, merge, and let the build deploy. Or, by hand:
   Cloudflare → Workers & Pages → `guilded-wow` → Settings → Domains & Routes → Add → Custom domain (both names).
   Keep the three `kcaron.top` routes.
7. **Cut-over** (step 5 of the order): Oracle `.env.local`: `PUBLIC_SITE_URL=https://guildedwow.com`, restart
   the bot service. Cloudflare → `guilded-wow` → Settings → Variables: `GUILDED_CANONICAL_HOST=guildedwow.com`;
   Settings → Build → Variables: `SITE_ORIGIN=https://guildedwow.com`; trigger a deploy
   (`keep_vars` is true, so the variable survives later deploys).
8. **Verify:** `https://guilded.kcaron.top/leaderboards/` → 301 to guildedwow.com; `https://www.guildedwow.com/` →
   301 to the apex; `https://guilded.kcaron.top/health` → 200 in place; `…/releases.json` and
   `…/downloads/Guilded.Companion.Setup.exe` still answer on the old host; Discord sign-in on guildedwow.com
   lands back signed in; a companion on the old host uploads fine.
9. **Later, no hurry:** Google Search Console → add `guildedwow.com` and use *Change of address* from
   `guilded.kcaron.top`; Play Console website/privacy/deletion URLs (store listing text in
   `mobile/store/play-listing.md`); Microsoft Partner Center listing website; CurseForge project pages; GitHub
   README; `uptime.yml`; Ko-fi page. Store/Play review is not needed for URL fields on a 301.
10. **Ads, later (not built here):** AdSense will run on `guildedwow.com` (`site/ads.txt` at the domain root,
    a consent banner, a privacy page). The domain must already be live with its privacy page (`/docs/PRIVACY`)
    before the owner adds the site in AdSense, so finish step 8 first.
11. **Next client release (optional):** default new installs to `guildedwow.com` (companion `engine.mjs`,
    `update-check.cjs`, addon `Util.lua`); old builds keep working through the old host.

## Open decisions (recommendations)

1. **Apex or `www`?** Apex canonical, `www` redirects (as built).
2. **Also move `dl.kcaron.top`?** No; the R2 mirror is a plain file host and is already independent.
3. **Move the owner creator page?** No; `kcaron.top` stays the creator site.
