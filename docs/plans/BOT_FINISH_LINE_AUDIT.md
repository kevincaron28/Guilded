# Bot finish-line audit, 22 November 2026

Scope: the Discord bot (`src/`), the website Worker (`worker/`) and the pages the bot serves, at `main` 62b910aa (9.4.8). Read-only audit plus the small fixes listed under "Fixed in this PR". Nothing was deployed, no version bump, nothing posted on Discord, the bot was not started. Method: the CLAUDE.md check list, the bug inbox, three read-only code audits (language, jobs/limits/queries, dead code/stale text), each finding re-read in the code before it was kept (one finding was wrong and dropped, see the end).

## Checks

`npx tsc --noEmit`, `node addon/Guilded/validate-addon.mjs` and `npx eslint .` are green on the clean branch. The full `vitest` run is slow on this PC (more than 10 minutes with other sessions running); the touched test files (`discord-jobs`, `member-trend`) pass, and CI on the PR is the full-suite record.

## Bug inbox (`npm run bugs`, 22 Nov 07:52)

0 member bug reports. 90 error groups since 23 Oct, almost all `P2028` (transaction timeout) or Prisma connection errors in a burst on **20 Nov 00:15-01:15 UTC**, i.e. the Aiven database trouble that ended with the move to the Guilded-DB VM (20 Nov 23:27 UTC). Only two groups are newer than that burst: `H57W2R22` and `2FGPQPGY` (`community.activities` P2028, 20 Nov 11:01 UTC, still on Aiven). **Nothing since the database move.** Recommendation: resolve the whole 20 Nov burst as "database move" once the owner agrees (`npm run bugs -- resolve ...`, not done here).

## What works (checked)

- Help, FAQ, setup text, onboarding and the promotion rule text (linked + 7 days + 3 h voice) match behaviour. Every registered command has a handler; every `package.json` script path exists.
- Discord limits are respected in the core editor selects, craft board, race board, hall of fame, core name/description/schedule.
- Job loops use per-guild isolation (`eachGuild`) and `running` guards in the delivery queue, PUG refresh, mobile alerts and boards. Completed `DiscordJob` rows are purged after 30 days (`retention.ts`).
- Card renderer retries a busy renderer (#1231); donor and promotion cards skip game-linked channels (#1246).
- Raid, achievement, bug-report, invite, link and bank flows are localized.

## Bugs

| # | Sev | Where | Problem and repro | Status |
|---|---|---|---|---|
| 1 | High | `discord-jobs.ts:27` | Permanent-error set lacked **20062** (linked-lobby channels refuse bot posts) and **50035** (invalid body). A non-donor `MESSAGE` job aimed at `chat-wow` retried every hour for ever. | Fixed |
| 2 | High | `discord-jobs.ts:45` | A thrown error with no Discord code ("Channel unavailable", "Card renderer busy", "Board unavailable", "Configure the notification channel first") never reached FAILED: hourly retry for ever. | Fixed (stops after 48 attempts, about 2 days) |
| 3 | Med | `discord-jobs.ts:251` | The duplicate check reads the last 100 messages. Without Read Message History that read fails with 50013 ("permanent"), so the post was never sent although sending works. | Fixed (check skipped) |
| 4 | Med | `member-trend.ts` | When the card renderer is busy the embed still pointed at `attachment://member-trend.png` with no file: Discord refuses, the claim is released, and the weekly trend failed again every hour. `scoreCardPng` rejection was also not caught. | Fixed + test |
| 5 | Med | `context.ts:60` | The generic "The command could not be completed" answer is English-only, for every command. | Fixed (French when the client locale is French) |
| 6 | Low | `main.ts:1222` | "That command is not available." English only. | Fixed (same rule) |
| 7 | Low | `housekeeping.ts:25` | Farewell post uses the English default on French servers (welcome already follows the language). | Fixed (French default) |
| 8 | Low | `officer-tools.ts:166`, `raid-season.ts:177`, `faq-extras.ts:19`, `guild-directory.ts:144`, `web-app.ts:194`, `site/pages/officers*.md` | Stale command names in member-visible text: `/raid edit` (now `/lead edit`), `/raid season` (`/lead season`), `/profile` (`/character profile`), `/guildpage create/publish` (`/mod page ...`), `/recruit set` (`/mod recruit set`). | Fixed |
| 9 | Med | `discord-jobs.ts` / `score-card.ts:424` | When two cards render at once the third gets `null` and the job retries only 3 times (30 s, 60 s), then posts text. A podium or donor burst can degrade cards to text. | Open, proposal P7 |
| 10 | Med | `guild-bank.ts:181`, `member-trend.ts:115` | Weekly posts to the officer log have no permission check; if the bot loses access they throw every hour (error-log noise, query and card rebuilt each hour). | Open (small) |
| 11 | Med | `main.ts:357-619` | Several `setInterval` jobs lack an overlap guard (voice sampler 30 s, activity totals, community activities 60 s, craft offers, raid reminders, cooldown pings, WCL discovery, group cleanup). With a slow database they stack on a small pool. | Open (small) |
| 12 | Med | `autocomplete.ts:37` | Every keystroke runs `ensureGuild`, `getSettings` and `ensureMember` (an upsert that rewrites `displayName` with the Discord username) before the real query; 3 round trips plus a write per keystroke against the 3 s budget, and it can overwrite a nickname-derived name. | Open (small) |
| 13 | Low | `autocomplete.ts:190` | `respond(...)` in the generic branches is not capped at 25 choices / 100 characters; a violation is swallowed so members just see no suggestions. | Open (tiny) |
| 14 | Med | `dungeon-evidence-awards.ts:18` | `reconcileEvidenceAwards` loads every valid run of the guild (no date bound) inside the import transaction, once per run: O(history) per run, O(N^2) for a backlog, and these are the transactions that hit P2028. `dungeon-bracket-season.ts:116` has the same unbounded read (officer calibration only). | Open (not tiny: restrict to `affectedWeek`) |
| 15 | Med | French | Not localized: `own-character.ts:4,13,16,20` (first message of a new member, used by wishlist/profession/attunement/profile), `wishlist.ts`, `profession.ts:92,109`, `attunement.ts:34,45`, `who.ts:26`, `profile.ts` (the whole `/character profile` embed), `loot.ts:128,152,191`, `team.ts:119,158,161`, member-button failure fallbacks in `main.ts:933,999-1013,1065,1097,1105,1189`. `src/i18n.ts` states "officer replies stay English", so officer-only English (settings, rank-roles, invites, core editor, uninstall, pug) is policy, not a bug. | Open; mechanical, about 1 day |
| 16 | Med | slash command picker | French descriptions exist only for `/character`, `/lead`, `/officer`, `/organize`, `/report` and 17 whole files. `/help`, `/raid`, `/epgp`, `/loot`, `/dungeon`, `/craft`, `/bank`, `/tag`, `/mod`, `/setup`, `/config` and about 60 files of options show English in a French client. `/setup` and `/config` are at the 4000 character limit: no French there. | Open, proposal P2 |
| 17 | Low | `COMMANDS.md` | Still lists pre-restructure commands (`/officer loot`, `/report inactive`, `/system`, `/uninstall`, `/profile`, `/tag set`, `/bank list`, `/craft permissions`, `/raid signup`, `/roll`). The site `reference.md` is correct. (Also listed in `POLISH_AUDIT_2026-11-20.md` finding 5.) | Open; regenerate from the registered tree or archive |
| 18 | Low | `setup-status.ts:166`, `battleground-setup.ts:267`, `game-reminder.ts:10`, `battleground.ts:161-174`, `pvp-group.ts:41` | "/setup step 6", "run /setup": the wizard is `/setup start`, step N. | Open (text) |
| 19 | Low | `main.ts:269-284` | Handlers registered for `profile`, `config`, `loot`, `epgp`, `tag`, `bank`, `craft`, `uninstall`, `system`, `community`, `participation` are unreachable (merged parents). | Open (dead code) |
| 20 | Low | 11 services used only by tests | `artisans-gallery`, `guild-bank-page`, `mvp-card`, `officer-handover`, `personal-calendar`, `profession-note`, `raid-planning-page`, `roster-dashboard`, `tcg-cards-set1-fr` (Clash, on hold), `web-community-badges`, `web-loot-lists`: about 1250 lines, no production importer. | Open; owner decides which are unfinished features |
| 21 | Low | `help.ts` | Does not mention `/mod invites`, `/mod rankroles`, `/mod page`, `/officer roster`, `/officer promotion`. | Open |
| 22 | Low | Worker/site | The 502/503 burst on bot-backed pages (polish audit finding 2) is not reproduced here; needs production logs. The database move (queries about 2 ms) probably removed the cause. | Open, owner check |

## Non-Forever and dead paths

- Reachable by members, owner decision: PoE2 (`companion/active-games.mjs` `ACTIVE_GAMES = ["wow","poe2"]`): a "PoE currency" lottery mode (`community.ts:43`), the game list in gaming nights and challenges (`community.ts:81`, `community-rules.ts`: DISCORD, WOW, POE2, DIABLO2, DIABLO4, OTHER), Worker PoE routes. The multi-game "Pick my games" onboarding (`setup.ts`, `onboarding.ts`, `game-reminder.ts`, `/officer reports games|remind|auto-remind`) is generic but is part of the multi-game story.
- Harmless single-edition scaffolding (`raid-presets`, `world-buffs`, `edition-context`, the Worker `guilded_edition` cookie, `site/editions.mjs`). Leave.
- Intentional read-only retention (retired achievement ids, `assertForeverEdition`). Leave.
- "Moved for one release" stubs (`moved.ts`: `/wow`, `/import`, `/poll`, `/delete-my-data`) have lived 9.4.0 to 9.4.8 and are not registered with Discord, so only a stale client reaches them.

## Defaults against the "ON by default" rule (owner decision)

Still off by default in `prisma/schema.prisma`: `achievementAnnounceEnabled`, `messageLogEnabled`, `weeklyReportEnabled`, `weeklyRecordsEnabled`, `gameReminderAuto`, `onboardingNudge`, `publicDungeonRuns`, `aiAnswers`, `rulesGate`, `autoApplyImports`, `characterSignups`, `meritEnabled`, `poeTrackingEnabled`. Item previews and crafter offers were listed as off in ROADMAP; crafter offers went on in 9.4.8 (#1233). Some should stay off on purpose (message log is a privacy matter, rules gate and AI answers change the server's behaviour). Proposal: turn on achievement announcements, weekly report, weekly records and game reminders; keep the rest off.

## Ranked proposals (what guild bots offer that members value)

| Rank | Proposal | Why members care | Effort |
|---|---|---|---|
| P1 | **Linked Roles (role connections)**: expose "WoW Forever character, level, guild rank, dungeon score" as Discord role-connection metadata, so server admins can gate channels/roles on a verified character. | The proof is already in the bot (linked characters with evidence tiers). Members see their character on their Discord profile; admins stop hand-assigning roles. Few WoW bots do it. | M (OAuth `role_connections.write`, metadata schema, nightly push) |
| P2 | **Full French command picker**: French names and descriptions for every member command (not `/setup` and `/config`), plus the French generic error map (bug 5, 15). | Québec Gold members use a French Discord; the picker is the first thing they see. | M (mechanical, 1-2 days; add a keyed translation map at `replyWithCommandError` for the ~370 short `throw new Error` texts) |
| P3 | **Right-click context commands** ("Guilded profile", "Link this character", "Invite to guild") on users and messages. | One click instead of typing a name; works on any message in a French server without learning commands. | S-M |
| P4 | **LFG forum / thread for dungeon groups** with auto-expire and role pings, built on the existing group finder; optional Discord scheduled event for planned runs. | Group finding is the daily use during levelling; threads keep chat tidy and searchable. | M |
| P5 | **Personal weekly digest** (DM or ephemeral on `/character profile`): your points, rank movement, runs, what is missing for the next promotion, craft requests waiting. | It turns the existing data into a reason to come back; promotion rule status ("where am I") already exists. | S-M |
| P6 | Components V2 layouts for boards and cards (sections, galleries) and Discord Polls API for the poll feature. | Cleaner, less embed-limited posts; native polls need no bot refresh jobs. | M |
| P7 | Render queue instead of "busy": a small waiting queue in `scoreCardPng`, so bursts (podium, donor backfill, season end) never degrade to text. | Cards always arrive as cards. | S |
| P8 | Operations: overlap guards on all intervals, readable health page for officers (`/system`: failed jobs by code, stale boards), alert when jobs hit FAILED. | Fewer silent failures like the 20062 retries. | S |
| P9 | User-installable app (`/character profile` and card lookup in DMs and other servers). | Members share their card anywhere; spreads the bot. | M |

## Owner decisions needed

1. Remove PoE2/Diablo from lottery and event game lists, or keep them (PoE2 community was kept on purpose).
2. Keep or retire the multi-game "Pick my games" onboarding.
3. Which default-off features to switch on (list above).
4. Remove the `moved.ts` stubs and the dead top-level handlers now (9 release lines passed).
5. Delete the 11 test-only services, or keep any as planned features.
6. French register tu/vous (open since the polish audit, finding 6) before P2 translates 60 more files.
7. Resolve the 20 Nov error burst in the inbox (database move).
8. Approve P1 (Linked Roles) and P2 as the next bot work.

## Fixed in this PR

`discord-jobs.ts` (codes 20062, 50035, 10013 permanent; any failure stops after 48 attempts; duplicate check no longer fails a post), `member-trend.ts` (embed image only when drawn, render rejection caught), French generic failure and unknown-command answers, French farewell default, five stale command names in member text and the officers site page. Tests: `tests/discord-jobs.test.ts`, `tests/member-trend.test.ts`.

## Finding dropped after checking

"No purge of `DiscordJob` rows": wrong, `retention.ts` deletes DONE rows after 30 days. FAILED rows are kept on purpose for `/system` retry.
