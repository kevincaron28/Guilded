# Website sign-in and recruitment (7.0)

Roadmap request 5 (`docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md`). Players sign in on
guilded.kcaron.top with Discord, browse `/recruitment/`, apply to a guild or a raid core, and post a
"looking for guild" card. Officers set their listing with `/officer recruit set` and answer in
Discord.

## How it works

- **Pages** (`/auth/*`, `/recruitment/`, `/recruitment/apply/<id>`, `/me/`) are rendered by the bot
  (`src/services/web-app.ts`) and reach the browser through the Cloudflare Worker, which forwards
  `cookie`, `origin`, `referer`, `accept-language` and `content-type` for these paths only, and
  returns only the bot's own `__Host-guilded_*` cookies. No scripts: plain forms under a strict
  Content-Security-Policy.
- **Sign-in**: Discord OAuth2 with the `identify` scope only. The access token is used once to read
  the Discord ID and name, then dropped. The `state` value is bound to the browser with a signed,
  10-minute cookie.
- **Session**: a random token in a signed `__Host-guilded_session` cookie (HttpOnly, Secure,
  SameSite=Lax, 30 days); only its SHA-256 is stored (`WebSession`). Sign-out deletes it.
- **CSRF**: every form carries a per-session HMAC token, and every POST must come from the website
  (`Origin`, or `Referer` for older browsers). Missing either is refused.
- **Who is listed**: open listings of approved servers only (`hostedPilot.allows`). Lite and blocked
  servers never appear and cannot receive applications.
- **Applications** go to the guild's applications channel (or the officer log) with Accept, Decline
  and Spam / report buttons (officers only). The player is told by DM when Discord allows it, and
  always on `/me/`. Spam also stops that account from applying to that guild again.
- **Limits**: 5 applications a day per account, one waiting application per listing, 10 card
  changes an hour, 10 reports a day. Three different reporters hide a player card; a reported
  listing is posted to `ERROR_LOG_CHANNEL_ID` for the owner.
- **Data**: migration `20261119100000_web_recruitment` (WebAccount, WebSession, RecruitmentListing,
  RecruitmentApplication, PlayerCard, RecruitmentReport). Only Discord ID, username and display
  name are kept for an account.

If any of `DISCORD_OAUTH_CLIENT_SECRET`, `PUBLIC_SITE_URL` or `WEB_SESSION_SECRET` is missing,
sign-in is off: `/recruitment/` still lists guilds, and the pages say applying is off.

## Owner setup (once)

1. Discord Developer Portal → https://discord.com/developers/applications → the Guilded bot's
   application (the same one as `DISCORD_CLIENT_ID`) → **OAuth2**.
2. Under **Redirects**, click **Add Redirect** and enter exactly
   `https://guilded.kcaron.top/auth/callback` → **Save Changes**.
3. On the same page, **Client Secret** → **Reset Secret** (only if you never copied it) → copy it.
   This is not the bot token; the bot keeps working.
4. On the Oracle server, add to `.env.local` (never commit these):
   ```
   DISCORD_OAUTH_CLIENT_SECRET=<the secret from step 3>
   PUBLIC_SITE_URL=https://guilded.kcaron.top
   WEB_SESSION_SECRET=<32+ random characters>
   ```
   A random value: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
5. Deploy the bot as usual (`redeploy-oracle.bat`; `db:update` applies the migration), then
   redeploy the Worker: `npm run worker:deploy`. The new pages need both.

## Test script

1. Open https://guilded.kcaron.top/recruitment/ — the page loads; with no listing it says so.
2. In Quebec Gold: `/officer recruit set open:true classes:Priest, Mage roles:healer days:wed, sun
   times:20:00-23:00 ET language:Français faction:Alliance realm:Doomhowl`. Reload: the listing shows.
   `/officer recruit set open:true core:<a core>` adds a core listing.
3. Filters: class Rogue hides the Priest/Mage listing; `?lang=fr` shows French.
4. **Sign in with Discord** → Discord asks only for your username/avatar ("identify") → you come
   back signed in.
5. **Apply** on the listing (second Discord account if you have one): the card appears in the
   applications channel with Accept / Decline / Spam. A member without officer roles clicking gets
   "Only Officers…". Accept → the applicant gets a DM; `/me/` shows "Accepted".
6. `/me/` → fill "Looking for a guild" → Save. The card shows under "Players looking for a guild".
7. Sign out → `/me/` asks to sign in again.
8. A Lite (unapproved) server's listing never shows.
