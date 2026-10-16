# Guilded roadmap

## Current stage — 5 October 2026

Guilded **6.0.0 Beta** is in installation and release acceptance testing. Bot,
addon and companion source versions match; protocol remains 2. The owner reports
the addon is installed on both PCs. Public publication and stable readiness
remain unverified. The authoritative checklist is
[the 6.0 testing record](docs/V6_0_RELEASE_TESTING.md).

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

## Later

- A standalone leader addon for markers, tank marking and boss plans. These
  features were removed from Guilded v6 on 4 October; preserved source is in
  [the extraction archive](docs/archive/raid-tools/README.md). It is not an installable addon yet.
- Additional standalone-first-run improvements described in
  [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Consider managed multi-guild hosting only as a separate product decision;
  current downloads require one guild owner to host the bot.

Historical feature plans are in [the roadmap archive](docs/archive/ROADMAP-history.md)
and version handoffs. Their old version numbers and pending-test statements
must not override the current release testing record.
