# Guilded roadmap

## Current stage — 18 October 2026

Guilded **6.6.0 Release** (protocol 2). Real-client checks still owed:
G6-G8 (dungeon runs), G10 (French client) and the 6.1.2 parts of G2/G12; see
[the 6.2 game acceptance record](docs/V6_2_GAME_ACCEPTANCE.md). The 6.0 testing
record is historical.

## Built

- WoW addon: raid attendance, EPGP, GP bids, council, soft reserves, priority loot,
  recipes, guild map, readiness, calendar integration where the client supports it,
  dungeon scores, games and backups.
- Discord bot: setup wizard, cores and signups, standings, personal pairing,
  crafting, onboarding, community seasons/activities, participation and PoE2 journals.
- Desktop and browser companions: personal uploads and standings; desktop file
  watching and optional PoE2 log tracking.

Built does not mean every live workflow has passed. Recorded two-player results
cover map visibility/privacy, recipes, bidding/council/reserves, GP accounting and
sync. Fresh-guild setup, installation/recovery, concurrency, permissions and a
full raid still have outstanding acceptance checks.

## Next

1. Make independent guild setup clear and rehearse a clean install. Aim for
   30 minutes with hosting/database/DNS ready; see [QUICK_START.md](docs/QUICK_START.md).
2. Test a genuinely fresh Discord guild and an ordinary member, and complete
   the Windows clean-install/upgrade/recovery checks.
3. Finish the real-client checklist and real raid, verify final-commit CI,
   then publish/promote matching packages as appropriate to the evidence.

## Website — 16 October 2026

Phase 1 (simpler guilded.kcaron.top and kcaron.top) is live from PR #86.

1. **Phase 2 visuals.** Replace the homepage's companion setup screenshot with
   real in-game screenshots (guild window standings, dungeon finder). The owner
   supplies the screenshots.
2. **A public page per guild.** When a guild sets up the bot, it gets a draft
   page such as `guilded.kcaron.top/g/<guild-name>/`. Officers choose what is
   public (raid times, cores, rosters, EPGP or loot rankings, recruitment) and
   publish it; nothing is public by default. Quebec Gold's page is the first one
   and replaces the hand-copied `/quebec-gold/cores/` snapshot with live data.
   The bot serves these pages through the Worker; the static homepage stays as is.
   - Earlier draft: the ChatGPT conversation "Portfolio Website Expansion"
     (16 October) produced `KCaron-Portfolio-Guild-Pages.zip` and a
     `LOCAL-AGENT-PROMPT.txt`. They were never pushed or downloaded to this PC,
     were built on an older `main`, and include a 14-project portfolio that
     conflicts with the simpler phase 1 design. Reuse ideas from it, not the files.
   - Open questions: page address and slug rules, which data officers may
     publish, French and English versions, search indexing on or off per guild,
     and whether Discord-only guilds (no addon) get a page.

## Requested — 18 October 2026

In suggested order: quick wins first, then things that build on each other.
How each one gets built: [ROADMAP_REQUESTS_PLAN_2026-10-18.md](docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md).

1. **Ko-fi support links.** The Ko-fi page ([ko-fi.com/wowguilded](https://ko-fi.com/wowguilded)),
   the website footer and CurseForge's Donate button already exist. Add the link
   to the bot's `/help`, the companion app and the addon's Settings page, in
   English and French. It's a link only: no features behind a payment.
2. **Spreadsheet export from the addon.** Recommendation: do both of these.
   - *In game:* an "Export" button on the standings, roster and loot windows
     opens a copy box with tab-separated text. Ctrl+A, Ctrl+C, then paste
     straight into Excel or Google Sheets; each value lands in its own cell.
     Works with no companion. (WoW addons can't write files themselves.)
   - *Companion:* the companion already reads SavedVariables, so it gets an
     "Export to spreadsheet" button that saves a `.csv` file (opens in Excel)
     with one sheet's worth per table: EP/GP, attendance, loot history,
     dungeon scores. A bot `/export` that sends a CSV of the guild's server-side
     data comes later, for officers only.
3. **Next dungeon season covers all levels, not just 60.** The November draft
   ([NOVEMBER_DUNGEON_CATALOG.md](docs/NOVEMBER_DUNGEON_CATALOG.md)) proposes a
   level-60, best-eight competition. Change it to level brackets (for example
   15-29, 30-44, 45-59 and 60) with each bracket's own dungeons, targets and
   leaderboard, so levelling characters compete too. Each bracket still needs
   real timed runs to set its targets before the season starts. Decide: the
   bracket boundaries, whether a character's run counts in the bracket of the
   level they were at the time, and whether to show one combined ranking.
4. **Guilds join on their own, with a lite version until approved.** Any Discord
   server that adds the hosted bot is accepted automatically and can run setup
   in a **lite** mode (setup, help, basic signups and dungeon groups). The owner
   approves a guild with a bot command, which unlocks everything (EPGP, loot,
   companion sync, seasons, guild page). Needs: a stored guild status
   (lite/approved/blocked), a check on each command, an approval queue sent to
   the owner, and per-guild limits to protect hosting costs. This changes the
   "Later" item below about managed multi-guild hosting from "maybe" to planned.
5. **Online core and guild recruitment on the website.** Builds on the public
   guild pages above. Guilds publish an opt-in recruitment listing (classes and
   roles wanted, raid times, language, faction, server); cores do the same for
   open spots. Players browse and filter on the website and apply; the
   application arrives in the guild's Discord as a message officers can accept
   or decline. Players can also post a "looking for guild" profile. Approved
   guilds only (item 4), with a report button against spam.
6. **Standalone dungeon module and a public leaderboard (Raider.IO-style).**
   A separate small addon, "Guilded Dungeons", for players with no guild or a
   guild without Guilded. It shares Guilded's dungeon code and timers so scores
   match exactly, and the two addons don't conflict when both are installed
   (one counts the run, not both). Players upload runs with the companion,
   paired to a personal account instead of a guild. The website gets
   leaderboards by dungeon, level bracket (item 3), class, role and season, and
   a profile page per character, plus a page per guild for Guilded guilds that
   opt in. Needs: a way to sign in without a guild, cheat checks on uploaded
   runs (party members must agree, time limits), and a database change.
   Largest item on this list: do 3 and 4 first.

## Later

- A standalone leader addon for markers, tank marking and boss plans. These
  features were removed from Guilded v6 on 4 October; preserved source is in
  [the extraction archive](docs/archive/raid-tools/README.md). It is not an installable addon yet.
- Additional standalone-first-run improvements described in
  [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Managed multi-guild hosting is now planned through item 4 of "Requested"
  (automatic joining with a lite version); self-hosting stays supported.

Historical feature plans are in [the roadmap archive](docs/archive/ROADMAP-history.md)
and version handoffs. Their old version numbers and pending-test statements
must not override the current release testing record.
