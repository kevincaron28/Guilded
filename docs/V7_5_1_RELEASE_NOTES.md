# Guilded 7.5.1 — 27 October 2026

Released by Claude at Kevin's request ("finish codex work so we can test retail and other version of wow
today"; "publish everything"), while Codex was out of capacity. Protocol 2. Real-client checks on every
edition are collected from players after release; see [the 7.5 game checklist](V7_5_0_GAME_CHECKLIST.md).

## Loot follows the original rules (PR #241)

- The public guild page describes each core's loot exactly as Discord does (English and French), with
  decay ("applied by officers" unless automatic), base GP, minimum EP and the off-spec share.
- PR = EP ÷ max(1, GP + base GP), as EPGP Classic: a raider with EP and no gear yet no longer ranks last.
- Decay rounds up (EPGP), never past zero, and reaches every balance in the pool, members who left too.
- A reversal after decay takes back only what is left, so EP/GP never go below zero.
- Bench (standby) players get the same raid EP as present players (EPGP's standby default).
- GP bids rank bidders with the minimum EP first, then the bid, then PR, in Discord and in game.
- Rankings (website and `/epgp leaderboard`) list players under the minimum EP last.
- Addon: SR+ grows once per weekly reset, and a win given out by another officer clears the winner's SR+;
  the softres.it import reports +1/bonus values it does not copy; suggested prices use the Classic
  EPGP formula (4.83 × 2^(ilvl/26 + quality − 4) × slot).

## Website

- "Guilds / Guildes" in the menu opens `/recruitment/guilds/`: every guild with a published page, an
  open listing or public dungeon runs, with search, edition, faction, language and "recruiting now".
- `/players/`: search by character, filters (edition, class, role, realm, guild), one card per player
  by character, cursor paging.

## Dungeons (Codex's current-v2 work, finished and merged)

- Both addons record conservative observed presence, start provenance and native boss events next to
  the existing run data. Season 1 stays on **current-v1**: the new evidence is stored and shown as
  history, it does not change official scores.
- Guild and public imports reconcile observer revisions, withdraw awards on later evidence with an
  audit trail, keep timely evidence eligible and lock calendar changes against imports.
- Achievements can be revoked and reactivated with an audit; revoked ones leave member shelves.

## Bug reports and diagnostics

- `/report bug` shows a private preview first, with Send and Cancel. It no longer takes a screenshot
  and no longer copies the report to officers; reports go to the developer inbox.
- Automatic error reports keep technical fingerprints only, not message text or user IDs.

## Database

Three additive migrations: `20261125210000_dungeon_integrity`, `20261125220000_player_directory_index`,
`20261125230000_dungeon_achievement_revocation`.

## Not verified before release

Real-client capture on each edition (Forever only from its 4 November launch build), two-PC and
standalone/full-addon combinations, and the new `/report bug` flow with a second account.
