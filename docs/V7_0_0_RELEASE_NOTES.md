# Guilded 7.0.0 — Recruitment, public dungeon leaderboards and Guilded Dungeons

Major release, October 19, 2026. Addon, bot and Windows companion move together to 7.0.0;
protocol remains 2. A new standalone addon, **Guilded Dungeons 7.0.0**, ships alongside.
Two database migrations (they only add tables and one column; applied automatically on deploy).
This release finishes the six requests from 18 October 2026 (see [ROADMAP.md](../ROADMAP.md)).
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Recruitment on the website

- **Sign in with Discord** on guilded.kcaron.top (Discord's "identify" permission only).
- **guilded.kcaron.top/recruitment/** lists open guilds and raid cores, with filters for class,
  role, faction, language and realm, in English and French.
- Officers set their listing with `/mod recruit set` (the guild's, or one core's with `core:`),
  and check it with `/mod recruit status`. Only approved servers are listed (not Guilded Lite).
- Players **apply** from the website. The application arrives in the applications channel (or
  the officer log) with **Accept**, **Decline** and **Spam** buttons, and the player is told the
  answer by DM and on their page at **/me/**.
- Players can post a **"Looking for a guild"** card for 30 days.
- Limits against spam: 5 applications a day, one waiting application per listing, and a report
  button on every listing and card.

## Public dungeon leaderboards

- **guilded.kcaron.top/leaderboards/**: the best run per character for each dungeon, filtered by
  season, level bracket (15-29, 30-44, 45-59, 60), class, role and "confirmed by the party", plus a
  page per character.
- Runs come from players' companions (personal mode, below) and from guilds that opt in with
  `/mod leaderboard share:true`.
- Every run is checked: completed, real times, the uploader was in the party, no duplicates.
  Party members who upload the same run confirm it; a disagreement hides it.

## New addon: Guilded Dungeons

- For players without a guild, or whose guild doesn't use Guilded: the same dungeon timer, run
  results and scores as Guilded, in a small separate addon. Commands: `/gdungeons` or `/gdg`.
- With Guilded installed too, Guilded Dungeons stays silent and Guilded counts the run.
- Download: `GuildedDungeons-v7.0.0.zip` on the GitHub release.

## Windows companion

- **Personal mode:** sign in at guilded.kcaron.top/me/, choose **Get a companion code**, and paste
  it in the companion. It uploads your finished dungeon runs to the public leaderboards; no guild
  needed.
- **Export to spreadsheet:** CSV files for standings, loot, attendance, raids and dungeon scores
  from your SavedVariables, into a folder you choose. They open in Excel with accents intact.

## Discord bot

- **`/officer export`** sends officers a CSV of the server's standings, EP/GP ledger, loot,
  attendance or roster, visible only to them. It replaces `/report export`.
- **All-level dungeon season, ready to start:** `/officer dungeon bracket-preview` shows the
  provisional season (four brackets, routes, level ranges and target times, marked provisional);
  `/officer dungeon bracket-start` starts it at a set time; `/officer dungeon recalibrate`
  replaces a route's target from real runs without changing scores already earned. Seasons
  already running are unchanged.
- **Ko-fi:** `/help` links to [ko-fi.com/wowguilded](https://ko-fi.com/wowguilded). Guilded stays free.

## Commands that moved

| Before | Now |
| --- | --- |
| `/report export what:` | `/officer export table:` |
| (new) | `/mod recruit set`, `/mod recruit status` |
| (new) | `/mod leaderboard share:` |

`/officer`, `/organize` and `/mod` stay hidden from members (6.7.0). If an officer can't see them,
`/setup` explains the one-time Integrations setting.

## Website and links

- Ko-fi links on every guide page, the GitHub README (with a Sponsor button) and the addon and
  companion READMEs. The website itself is updated separately.

## Owner setup for website sign-in

Without these three settings the sign-in, recruitment applications and personal codes stay off,
and the pages say so; the public lists still work.

1. Discord Developer Portal → the Guilded application → **OAuth2** → **Redirects** → add
   `https://guilded.kcaron.top/auth/callback` → Save.
2. Copy the OAuth2 **Client Secret** (not the bot token).
3. On the server, add to `.env.local`: `DISCORD_OAUTH_CLIENT_SECRET`, `PUBLIC_SITE_URL=https://guilded.kcaron.top`
   and `WEB_SESSION_SECRET` (32 or more random characters), then restart the bot.

Details: [WEB_SIGNIN_AND_RECRUITMENT.md](WEB_SIGNIN_AND_RECRUITMENT.md),
[PUBLIC_DUNGEON_LEADERBOARDS.md](PUBLIC_DUNGEON_LEADERBOARDS.md),
[DUNGEON_SEASON_BRACKETS.md](DUNGEON_SEASON_BRACKETS.md).

## Database

- `20261119100000_web_recruitment`: website accounts and sessions, recruitment listings,
  applications, player cards and reports.
- `20261119110000_public_dungeons`: personal companion codes and credentials, public runs, and
  `GuildSettings.publicDungeonRuns` (off by default).

## Checked

- Automated: TypeScript, ESLint, both addon validators, the Worker build and the full test suite,
  including sign-in, cookies and CSRF, recruitment and applications, run trust checks, leaderboard
  queries, CSV export, the provisional season and Guilded Dungeons running next to Guilded.
- Before publishing, on 19 October: [the 7.0.0 test checklist](V7_0_0_TEST_CHECKLIST.md) (in game,
  in Discord and on the website).
