# Roadmap

Where Guilded stands and what could come next. The full idea backlog, the code audit and the reviews of
other addons are kept in [docs/archive/ROADMAP-history.md](docs/archive/ROADMAP-history.md).
What is left before publishing is in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Status (2026-09-30): version 4.0.0, ready to publish as a Beta

Built and tested (550+ automated tests, lint, type check and the addon validator pass; a test loads the whole
addon in .toc order):

- **Addon:** raids and attendance, EPGP ledger, four loot systems chosen per raid core (GP bids, loot council,
  soft reserves, EPGP priority with set item prices) run with `/guilded drop`, recipes and cooldowns, the guild
  calendar both ways, gear/enchant/consumable checks, a live Ready page, roll games, dungeon challenge,
  attunements, item tooltips, backups, a window with a Home page, French, per-guild data, switchable modules,
  a public read-only API for other addons.
- **Bot:** `/setup` wizard, raid signups with roles and waitlist, raid cores with a bench, their own loot
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

1. **Publish 4.0.0 as a Beta and test with a second player** (see the checklist). Fix whatever it finds. This
   comes before any feature.
2. **Web dashboard** for standings, loot and raid history.
3. **Hosting:** the free Oracle Cloud setup is written ([docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md)); a hosted
   multi-guild bot is a bigger step and only worth it if other guilds ask.

## Also done

Every item of the old numbered list except the two above is built: item tooltips (3.1), Warcraft Logs
automation (3.1), the Guilded chat tab (3.2), loot council answers, soft reserves, guild calendar sync, and
recipes and cooldowns (4.0).

- **Loot systems per raid core** (GP bids, loot council, soft reserves, EPGP priority with set item prices): chosen in `/core setup`, prices with `/core items`, run in game with `/guilded drop`. Needs a try with a second player (the priority popup and the automatic award are the untested parts).

- **Ready page** (3.3.0, officers and group leaders): who in the raid is ready, in the window and as `/guilded ready`, with a ready check. Needs a look in a real raid group (party and raid units are the untested part).
- **French option** (setup language choice, French server and posts). Left for a later pass: officers' own screens and replies, and Discord's slash-command description translations.

## Decided against

- **Imports from other addons and sites** (SoftRes, That's My BiS, Guild Roster Manager): soft reserves are built in, and the rest were never worth the sample-file chase.
- **Casino games and gold wagers:** removed in 2.4 (debts and disputes, no value for a guild).
- **Message edit/delete logging and a starboard:** need Discord's privileged Message Content or reaction intents.
- **Compressed sync, per-guild identity store rewrite:** the current sync is small enough; revisit only if it is not.
