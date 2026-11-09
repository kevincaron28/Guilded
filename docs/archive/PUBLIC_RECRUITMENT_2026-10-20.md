# Public recruitment, player profiles and dungeon guide

Prepared locally on `codex/open-raid-recruitment`, based on source version 7.2.0.
No version bump, production migration, bot startup, Discord post or deployment.
Existing `.claude/` files were left alone.

## Included

- Existing guild/core recruitment remains available on `/recruitment/`.
  `kind=raids` adds public vacancies for individual Discord raid occurrences.
- `/raid pug share raid:<raid> open:true realm:<realm> faction:<faction>
  language:<language> invite:<Discord invite>` lets officers opt in one raid.
  Later shares reuse its metadata. `open:false` withdraws it.
  Only upcoming, planned, non-test raids with a signup post and explicit role
  capacities can be shared. Weekly successors remain private.
- Vacancies count `SIGNED_UP` only. Maybe, waitlist and cancellations do not
  consume confirmed places; unknown role caps never become unlimited vacancies.
  Full, started, cancelled and expired raids are absent. The discovery horizon
  is 30 days, at most 100 public raids.
- `/raid pug browse` shows other guilds' upcoming spots.
  `/raid pug board enabled:true` creates an optional read-only `open-raids` /
  `raids-ouverts` channel, or accepts an existing `channel`. It edits one board
  every minute (up to eight raids, with the website for the full list).
  Disabling removes the board message and preserves the channel.
- Full Guilded's **Open raids** page (`/guilded pug`) shows the companion snapshot,
  role/realm filters, pagination and copyable host invites. It expires after ten
  minutes, also hides raids that have started, and requires a fresh sync plus
  `/reload`. This uses the existing guild companion standings path; personal-only
  companions and standalone Guilded Dungeons do not download this raid browser.
  No addon HTTP calls, public roster identities or automated game invitations.
- `/players/` and `/players/<account ID>` show public player profiles. The owner's
  requested default applies to both existing and future website accounts.
  `/me/` contains visibility, companion controls, applications and player cards.
  Display name, linked characters and accepted public runs are public; secrets,
  raw Discord IDs, application messages and private guild runs are not.
- Characters come from the account's active Discord memberships in approved
  guilds, or its own character in successful personal run uploads. Party members
  are not claimed as alts. Earlier personal uploads may need resending to create
  a character link. Profile pages list the latest 50 public runs (up to 25 linked
  characters queried), with links to the existing seasonal character pages.
  Hiding a profile removes the account page and directory card immediately;
  already-public character leaderboard results remain public.
- `docs/DUNGEONS_GUIDE.md` is built into the website's public guides and linked
  from Features and the guide navigation. Includes English/French installation,
  standalone/full-addon choice, personal/guild companion setup, runs, profiles,
  raid discovery and troubleshooting.

## Delivery requirements

Apply `20261121100000_public_raid_spots` through the normal production release
process, after backup and PostgreSQL/CI checks. It adds opt-in raid metadata,
optional board references, `WebAccount.publicProfile` (default true) and
`WebCharacter`. Regenerate Prisma, deploy the bot, and register its commands.
Deploy the Worker and website together for `/players/` routing and new guide links.
Rebuild the full addon and companion from an accepted release; do not overwrite
published 7.2.0 artifacts with candidate code.

## Remaining real-client acceptance

1. In two approved test servers, opt in a raid, enable the other server's board,
   and confirm guests can follow the invite and access the host's signup post.
2. Confirm a signup/cancellation changes the website count and next board refresh;
   a full/cancelled/started raid disappears. Withdrawing must remove it too.
3. As an ordinary game member, sync the candidate companion, `/reload`, open
   `/guilded pug`, filter, page and copy a host invite. Confirm expired snapshots
   cannot be used as current vacancies. Check English and French at actual UI scales.
4. Sign in with two test Discord accounts. Confirm each profile is public by
   default; hiding one removes only that profile. Only the owner can manage its
   visibility and companion. Check personal upload and guild character links.
5. Finish, save and upload a supported dungeon run. Confirm the matching player's
   profile links to its character's existing results without duplicate runs.

Offline checks and browser fixtures do not substitute for these acceptance items.

## Verification on 20 October

- Full Vitest suite: **240 files / 2,015 tests passed** on the final source.
  Log: `backups/public-recruitment-20261020/vitest-verified.log`.
- TypeScript, ESLint, Guilded and Guilded Dungeons validation, and `git diff --check`
  passed. Prisma client generation succeeded without migrating a database.
- Website build and Cloudflare Worker dry run passed.
- The real page renderers were previewed locally with synthetic guild/player/run
  data, without starting the bot or reading production. Recruitment was inspected
  at desktop and mobile width; the public player profile and dungeon guide fit a
  mobile viewport without page-level horizontal overflow. The run table scrolls
  within its container.
- Local review server: `http://127.0.0.1:8801/recruitment/?kind=raids`.
  Fixture source: `backups/public-recruitment-20261020/preview.ts`.
