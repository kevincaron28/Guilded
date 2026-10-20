# Guilded 7.3.0 Release

20 October 2026. Guilded, Guilded Dungeons, the bot and companion packages share
version 7.3.0; protocol remains 2. This release includes the already merged raid
templates/history and command cleanup, plus the following two requested features.

## Dungeon exit card

Completed dungeon runs queue a compact, nonmodal result card after leaving the
instance, once loading settles and combat ends. It shows recorded duration and a
clearly labelled estimate of the current provisional public website score, with
the target, time rating and level penalty. Missing levels or unsupported routes
show an unrated explanation. Guild-season rules and server validation may differ.

The card fades after about 15 seconds, pauses on hover or expanded details, and
remembers automatic display and dismissal. Reopen with `/guilded dungeon results`
or `/gdg results`. Leaving early never completes a run. The footer distinguishes
local saving from a companion receipt and does not promise public publication.
The shared change is included in full Guilded and standalone Guilded Dungeons.

## Cross-guild raid recruitment and player pages

Officers can explicitly share one upcoming raid occurrence with `/raid pug share`.
Vacancies follow confirmed Discord signups; full, started, cancelled, expired and
test raids stay out of the public feed. Players can browse the website, an optional
Discord board, or the full addon's companion-fed Open raids page (`/guilded pug`).
Joining and signup confirmation remain with the host Discord. Addon snapshots
expire after 10 minutes. Recurring successor raids remain private until shared.

Discord-linked website accounts have public player pages by default, as requested,
including existing accounts. Pages list linked characters and accepted public
runs; private guild runs, pairing credentials and application messages remain
private. Owners can hide their profile from My Guilded. Existing public character
leaderboard results remain public independently of profile visibility.

An English/French dungeon setup guide covers addon choice, pairing, saving and
uploading runs, eligibility and profiles. Raid sharing and board creation stay
opt-in; this release does not turn on boards or share existing raids automatically.

## Update and verification

The backend requires additive migration `20261121100000_public_raid_spots` before
the new handlers are used. Follow the normal protected backup, ledger preflight,
migration and single-service update process. Preserve pairing settings and all
SavedVariables. No installed game client is changed by publishing these packages.

Offline Lua, backend, website, PostgreSQL integration/restore and Windows packaging
checks are required on the combined release commit. Fresh real-game visual and
UI-scale checks, EN/FR clients, both-addon combinations, a complete fresh-run sync,
and two-server raid signup/board behavior remain acceptance follow-up, not passes.
See [card acceptance](DUNGEON_EXIT_CARD_2026-10-20.md),
[recruitment acceptance](PUBLIC_RECRUITMENT_2026-10-20.md) and the existing
[game checklist](V6_2_GAME_ACCEPTANCE.md). Installer packaging does not verify
installer execution. The Windows installer remains unsigned.
