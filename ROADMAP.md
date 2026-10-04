# Roadmap

Where Guilded stands and what could come next. The full idea backlog, the code audit and the reviews of
other addons are kept in [docs/archive/ROADMAP-history.md](docs/archive/ROADMAP-history.md).
What is left before publishing is in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Status (2026-10-10): version 5.0.0, ready to publish as a Beta (4.0.0, 4.5.0 and 4.6.0 were never published separately)

5.0 added a guild map, Raider.IO-style dungeon scores, raid tools, GP deduction and
standings without the bot in game; on Discord, core channels made and archived by themselves, group alerts
matched to level and roles, and an answer channel (officer answers, optional free AI). It also fixes the
4.6 companion installer, which did not start. Details: [docs/V5_0_HANDOFF.md](docs/V5_0_HANDOFF.md).
4.6 (a role and channels per raid core, a group finder for every kind of group, a richer weekly report, a
setup checklist, loot upgrades): [docs/V4_6_HANDOFF.md](docs/V4_6_HANDOFF.md).

Built and tested (550+ automated tests, lint, type check and the addon validator pass; a test loads the whole
addon in .toc order):

- **Addon:** raids and attendance, EPGP ledger, four loot systems chosen per raid core (GP bids, loot council,
  soft reserves, EPGP priority with set item prices) run with `/guilded drop`, recipes and cooldowns, the guild
  calendar both ways, gear/enchant/consumable checks, a live Ready page, roll games, dungeon challenge,
  attunements, item tooltips, backups, a window with a Home page, French, per-guild data, switchable modules,
  a public read-only API for other addons.
- **Bot:** `/setup` wizard, raid signups with roles and waitlist, one-time `/character pair` Companion linking,
  raid cores with a bench, their own loot
  system, item prices and point pool, weekly raids, EPGP standings and decay, soft reserves and who-can-craft-what
  in Discord, calendar sync into signups, dungeon leaderboard, forum craft board, readiness board, polls,
  Warcraft Logs, applications, moderation helpers, daily backups, automatic character linking. 17 commands.
- **Companion:** tray app with setup window, standings and loot rules written back into the game.
- **Release kit:** license (PolyForm Noncommercial), changelog, CurseForge text, addon zip, installer script.

Checked by hand in the real game and Discord (3.x): login, the window, sim raid and solo bidding, backup and
restore, sync, `/setup`, cores, test raid, weekly raid, craft board, the companion.
**Not checked in the real game or with a second player yet** (all in the release checklist): every 4.0 feature
(loot council, soft reserves, EPGP priority and `/guilded drop`, the profession window scan, the calendar),
and from before: the bid popup and whisper bids, duels, mass invite, the officer versus member views.
Everything is written to fail plainly (a message, never a broken window) when the game does not offer an
API, and the release notes say which parts are untested.

## Next, in the order I would do them

1. **Publish 5.0.0 as a Beta and test with a second player** (see the checklist, 5.0, 4.6 and 4.5 sections).
   Fix whatever it finds before any new feature.
2. **Hosting:** the free Oracle Cloud setup is written ([docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md)); a hosted
   multi-guild bot is a bigger step and only worth it if other guilds ask.

## v5: Raid tools module (built in 5.0, drawings left)

**Removed from Guilded's v6 scope on 4 October 2026 at the owner's request.**
Markers, tank marking and boss plans are preserved in
[the extraction archive](docs/archive/raid-tools/README.md) for a future optional
standalone leader addon. It is not yet installable. Drawings and Discord plan
editing remain future work. Older feature descriptions above describe v5 history.

## Raid tools polish and standalone addon

- Compact independent marker window: keep it visible during raids without opening the main Guilded window.
- Polish layout, icon tooltips, scaling, saved position, locking, combat behavior and leader permissions in real raids.
- Package a standalone raid-tools addon after the archived module is extracted and polished; it must work without Guilded, the bot or companion. Leader-only plans should use raid chat; custom popups require a receiver on each member's client.

## Dungeon season history and Hall of Fame

- Keep completed seasons, their run and point history, and season champion achievements.
- Discord standings show current standings, recent past podiums, and a season selector; older seasons remain searchable with `/dungeon leaderboard season`.
- Build a Hall of Fame after several seasons, with champions and podium finishes across seasons.

## 4.1

- **Pairing code for character linking (implemented):** `/character pair` gives a short-lived code; the
  companion exchanges it once for a per-account credential and links the uploader's own character
  automatically. Shared guildmate characters still use the existing claim/link flow.
- **Guild member map module (built in 5.0, `Modules/GuildMap.lua`, without HereBeDragons):** a Minimap-style module showing guildmates' zone and position on the world map,
  based on the **GuildMap** addon in `Published Addons/GuildMap` (a MapMate fork: HereBeDragons + HereBeDragons-Pins
  for the pins, guild-chat addon messages broadcasting each player's mapID/x/y every 3-5s past a small movement
  threshold). Ours would reuse that broadcast/pin approach but fit Guilded's module system and rank visibility
  (officers vs members) instead of GuildMap's own UI.

## Also done

- **Path of Exile 2 guild competition:** plan in `docs/POE2_GUILD_COMPETITION_PLAN.md`; separate league points, cooperative challenges, reviewed evidence, season archives and Hall of Fame. API tracking depends on GGG application access. Not implemented yet.
- **System diagnostics and recovery:** `/system status`, durable Discord retries, explicit calendar raid IDs, frozen season results, full Discord archive and Hall of Fame. Real acceptance remains required (`docs/SYSTEM_POLISH_2026-09-30.md`).

Every item of the old numbered list except hosting is built: item tooltips (3.1), Warcraft Logs
automation (3.1), the Guilded chat tab (3.2), loot council answers, soft reserves, guild calendar sync, and
recipes and cooldowns (4.0).

- **Loot systems per raid core** (GP bids, loot council, soft reserves, EPGP priority with set item prices): chosen in `/core setup`, prices with `/core items`, run in game with `/guilded drop`. Needs a try with a second player (the priority popup and the automatic award are the untested parts).

- **Ready page** (3.3.0, officers and group leaders): who in the raid is ready, in the window and as `/guilded ready`, with a ready check. Needs a look in a real raid group (party and raid units are the untested part).
- **French option** (setup language choice, French server and posts). Left for a later pass: officers' own screens and replies, and Discord's slash-command description translations.

## Decided against

- **Web dashboard** for standings, loot and raid history: Discord and the in-game window already show them.
- **Imports from other addons and sites** (SoftRes, That's My BiS, Guild Roster Manager): soft reserves are built in, and the rest were never worth the sample-file chase.
- **Casino games and gold wagers:** removed in 2.4 (debts and disputes, no value for a guild).
- **Message edit/delete logging and a starboard:** need Discord's privileged Message Content or reaction intents.
- **Compressed sync, per-guild identity store rewrite:** the current sync is small enough; revisit only if it is not.
