# Server statistics (8.5, Track G)

Guilded writes one statistics row per server per UTC day. Officers read them as charts on the website and, if they want
Google Sheets, through a read-only CSV address. **On by default** (an officer can turn it off); nothing is posted to Discord.

## What is recorded (`GuildStatSnapshot`, `src/services/stat-snapshots.ts`)

| Column | Meaning |
| --- | --- |
| `discord_members` | Members in the Discord server when the snapshot ran |
| `active_members` | Members whose message or voice totals changed in the 24 hours before the snapshot |
| `linked_members` | Active members with at least one linked character |
| `roster_characters` | Characters of active members |
| `online_peak` | Characters seen by uploads in the 24 hours before the snapshot (highest value of the day) |
| `level_60`, `level_1_9` ... `level_50_59`, `level_60` | Level distribution |
| `class_<Name>` | Characters per class (one column per class that appears) |
| `messages`, `voice_minutes` | That day's change in the running totals (the first snapshot has nothing to compare, so 0) |
| `raids`, `dungeon_runs` | Raids started and valid dungeon runs started that UTC day |

The job runs every six hours; a later run on the same day refreshes the day's row (the day's highest `online_peak` is kept).
Test members and `/testraid` data are excluded. Rows are kept; there is no retention limit (a row is a few hundred bytes).

## Charts: Statistics page

Sign in at the website, then **Guild statistics** (`/me/statistics`): members over time, activity, messages and voice,
raids and dungeon runs, the level distribution and the class mix, for 7, 30, 90 or 365 days. Officers only (the same check as
`/officer export`). The charts are inline SVG: no script, no outside library. `/stats server:true` in Discord shows the latest
snapshot with a class chart image.

## Google Sheets (no Google credentials stored)

1. In Discord, an officer runs `/officer stats feed`. The reply (visible only to you) holds an address like
   `https://guilded.kcaron.top/api/v1/stats-feed?guild=…&key=…`. The key is secret: anyone with the address can read these numbers.
2. Open a new Google Sheet. In cell **A1** type `=IMPORTDATA("paste the address here")` and press Enter. The table fills in
   (oldest day first, one row per day). Google refreshes IMPORTDATA about hourly; the numbers only change daily anyway.
3. To draw a graph: select the columns (for example `day` and `discord_members`), **Insert > Chart**, choose a line chart.
   Put charts on a second tab and leave the first tab to the import so a refresh never overwrites them.
4. Share the Sheet with officers as you like; the address is inside the formula, so do not share the Sheet with people who
   should not see it, or share a copy with the values pasted in (**Edit > Paste special > Values only**).

Managing the address:

- `/officer stats feed` creates the address the first time. Because only a hash of the key is stored, a later run cannot show
  it again: it says one exists.
- `/officer stats feed action:New address` makes a new key and the old address stops working immediately (update the formula).
- `/officer stats feed action:Revoke` stops the feed. `/officer stats toggle on:false` stops new snapshots, the page and the feed.

A wrong key answers `404`, the same as a missing feed, and counts toward the shared failed-attempt lockout of the companion API.
The key is never logged by the bot.

A ready-made template Sheet is not published yet: it needs the owner's Google account to create and share a copy of the
steps above (an owner action, not code).

## Security notes

- The key is 24 random bytes (base64url); the database stores its SHA-256 hash; comparison is constant time.
- IMPORTDATA cannot send headers, so the key travels in the address. Cloudflare's own request logs can contain it; treat the
  address like a password and regenerate it if it leaks.
- The Cloudflare Worker (`worker/index.mjs`) forwards `GET /api/v1/stats-feed` with its query (listed in `apiMethods`).
  Redeploy the Worker with the release; until then the feed answers only on the bot's own address.
- Numbers only: no names, Discord IDs or message content are in the feed. Class names are written as column headers with
  non-letters replaced; cell values that start with `=`, `+`, `-` or `@` are prefixed with `'`.

## Not in 8.5

Writing straight into a Sheet with the Google API (needs a Google Cloud service account the owner creates) is a later option.

## Live checks needed

Seven days of real snapshots draw; the CSV loads in Google Sheets through the Worker; revoking the key stops the feed;
`/officer stats feed` and `/stats server:true` in a real server; `FEATURE_PREVIEW_GUILD_IDS` limits snapshots until it is unset.
