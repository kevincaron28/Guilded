# Community delivery — 2 October 2026

The community upgrade is deployed to Quebec Gold. PR [#25](https://github.com/kevincaron28/Guilded/pull/25) was merged after both required CI jobs passed. Production runs `e6a3e4db2d6d7074de3d984e86989c812db30c36`, version 5.0.0, protocol 2. Systemd is active and Discord-ready health passed.

## Live result

- The existing pinned activities guide `1555380981618180132` now has eight buttons: dice, current activities, personal points, polls, thanks, rankings, seasons and this week's schedule.
- The existing pinned podium `1555515229767471114` now has dice, points, full rankings and season buttons, plus channel links.
- Both panels display **Saison 1 — Octobre 2026**. Future seasons receive stable numbers; internal identifiers remain internal.
- Season `cmuq9jdgk0026ntcaj5sy7jo8` remains active with the same identity and ledger: one award totaling **5 points**. Existing messages were edited in place and remain pinned.
- Activity announcements now route to `1555370172045332573`; the ranking anchor remains `1555370174620897341`. Topics were updated without changing channel permissions.
- Migration `20261102090000_community_experience` is applied. Registered `/community` options include `hub` and `season-settings`.

The live read-back verified both messages, all button labels, the season, migration, commands and unchanged point total. Member button clicks and mobile rendering still need a real Discord account check: the available browser session required login. Automated interaction tests passed, but are not a substitute for that client check.

## Validation and recovery

- Isolated release: TypeScript, 1,073 tests across 138 files, ESLint, addon validation, full release build, Windows installer packaging and both dependency audits passed.
- GitHub Actions run `37020327216`: `checks` and `windows-package` passed on reviewed head `e3c740f287c06cc7c2e9ce72a665f01dee5f62f6`, including PostgreSQL concurrency/migration/restore gates.
- A temporary clone of production passed the additive migration while preserving existing records. It expires automatically at 2026-10-02 16:24 UTC.
- Production ledger preflight passed. Neon recovery retention was confirmed at six hours.
- Verified custom-format database backup: `/var/backups/guilded/community-before-2026-10-02T14-37-28-766Z.dump` on the existing Oracle host. Mode 600; 201,088 bytes; 429 readable archive entries.
- Backup SHA256: `37910e31507fa18ed0060ea5f646b6f01666b956b89df8e4ce9f5f35526bc9b4`.
- Previous production revision: `21af6098dec07b2119017b85a1998cd59200ef3a`. Follow the community experience document for rollback; preserve additive fields and points. Do not restore old data merely to undo a label.

## PoE2 analysis delivered

See [POE2_DISCORD_INTEGRATION.md](POE2_DISCORD_INTEGRATION.md). Reuse the existing Path of Exile 2 role and categories; propose only `🧭・poe-compagnon` and `🗺️・mapping-stats`, with existing map-clearing/boss groups and voice rooms. The plan covers exact channel/role bindings, private pairing, opt-in named statistics, league/mode separation, permissions and staged verification. Log observations cannot verify map completion or boss kills.

PoE2 provisioning was an analysis request: no PoE2 channels or settings were changed. Tracking was disabled and no observations or PoE2 seasons existed at inspection.

## Checkout preservation

The release was isolated in `C:\Users\Kev\.codex\worktrees\community-poe-finish\Quebec Gold Bot`, now clean on main at the deployed revision. Original development work in `C:\Users\Kev\Desktop\Quebec Gold Bot` remains on `fix/audit-hardening`; unrelated audit, FAQ and companion edits were preserved and were not included in this release. Do not reset that checkout or mistake its additional work for deployed code. This local delivery record is not part of PR #25.

No product version bump, second gateway bot, companion installation, addon installation or public package release was performed for this bot-only upgrade.
