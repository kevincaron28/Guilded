# Clickable community activities — implementation handoff

2 October 2026. Release implementation and gated rollout procedure.
Version remains 5.0.0. Original rationale: [COMMUNITY_UPGRADE_PROPOSAL.md](COMMUNITY_UPGRADE_PROPOSAL.md).
PoE2 integration analysis: [POE2_DISCORD_INTEGRATION.md](POE2_DISCORD_INTEGRATION.md).

## Member experience

- `activites` gets a persistent French/English panel: daily dice, current activities,
  personal points, polls, helper nominations, rankings, seasons and this week's schedule.
- `🏆・leaderboard` retains the podium and adds dice, personal points, full rankings
  and season shortcuts. Personal actions reply privately; the shared buttons stay usable.
- Dice reuse the existing atomic once-per-day award. Repeat clicks show the saved
  result and the next midnight in the guild's timezone, including DST changes.
- Seasons display `Saison 1 — Octobre 2026`, with readable autocomplete choices.
  Member dice, points, rankings and participation status can default to the single
  accessible active Discord season. Archives are selectable and paginated.
- Activity pickers and discovery show only accessible destinations. Activity cards
  use readable season footers, one-click free draws, quantity plus explicit cost
  confirmation for points purchases, event places, and private submission status.
- Helper nominations use a member selector and a short form. They still require
  participation to be enabled, eligible members and independent officer review.
- `/community hub` gives officers quiz, gaming-night and cooperative-challenge forms.
  Officers create polls through `/poll create`; the hub links the latest open polls
  in its visible activity destinations. Existing Discord events supply opt-in
  Interested reminders; their link is added when the native event is created.
- `/community season-settings` renames a season or changes its announcement channel.
  Renaming refreshes existing cards; rerouting preserves their original location.

No pilot activities, prizes, attendance or participation channels are invented.
The weekly button displays the actual next seven days, including open activities;
it does not automatically create a recurring event or send a weekly broadcast.
Participation is still unconfigured in the live season and is described honestly.
Existing display badges are surfaced in personal points. Cosmetic Discord roles,
custom reminder subscriptions and unattended season rollover remain later features.

## Data and authorization

Additive migration: `20261102090000_community_experience`.

| Field/table | Purpose |
| --- | --- |
| `CommunitySeason.number` | Stable, unique season number per guild and game; deterministic historical backfill by creation date then ID. |
| `CommunitySeasonCounter` | Allocates numbers under the guild transaction lock; deleting a season does not reuse its number. |
| `CommunitySeason.announcementChannelId` | New announcement destination; `channelId` remains the authorization anchor. |
| `CommunityActivity.postedChannelId` | Captures an activity's destination at creation and backfills existing posted messages. |

The migration preserves IDs, points, evidence, message IDs and frozen standings.
Do not deploy a generated Prisma client against an unmigrated production database.
An officer and the bot must be able to use the destination. Source and destination
must have identical View Channel overwrites, excluding the bot's own override.
Visibility is rechecked when posting cards, reminders and native events. Member
access is checked again on actions; selecting an earlier autocomplete choice grants
no continuing permission. No privileged intent was added.

The hub refresh uses the existing pinned guide (`Guilded 5.0 setup activities`) or
its new stable marker. The podium reuses its existing pinned message. It creates no
extra category and never changes role/channel permissions on periodic refresh.

## Quebec Gold rollout

Read-only preview succeeded against the live channels:

| Resource | Existing ID | Planned change |
| --- | --- | --- |
| Communauté | `1555370170120151160` | Reuse unchanged. |
| activites | `1555370172045332573` | Replace the existing guide with the clickable hub; route new cards here. |
| 🏆・leaderboard | `1555370174620897341` | Reuse the podium and add action buttons. |
| chat-communaute | `1555370176755802123` | Keep conversation here. |
| Active Discord season | `cmuq9jdgk0026ntcaj5sy7jo8` | Preserve identity/points; rename legacy `Season 1` to `Octobre 2026`. |

The preview confirmed matching channel visibility. It changed no records or messages.
The observed five-point award remains on the same season; the maintenance script
does not touch its ledger. Recheck live state immediately before applying.

1. Complete [V5_0_RELEASE_HANDOFF.md](V5_0_RELEASE_HANDOFF.md): review/merge, green
   Windows and PostgreSQL CI, release build, ledger preflight and verified backup.
   This release was isolated on `codex/community-experience`; unrelated audit and
   companion work remains untouched in the owner’s original checkout. Use the clean
   release worktree for the updater.
2. Deploy the migration and bot handlers together through the existing Oracle updater.
   Verify its deployed revision and Discord-ready health. Refresh registered commands.
   Never start a second bot locally.
3. Preview again, then apply with the existing authenticated local environment:

   ```powershell
   npx tsx scripts/update-community-experience.ts 1555370170120151160
   npx tsx scripts/update-community-experience.ts 1555370170120151160 --apply
   ```

   The apply pass records the rename/routing audit, updates the two channel topics
   and refreshes existing panels. It does not enable participation or create a season.
   Publish buttons only after matching handlers are running.
4. With an ordinary member, roll twice, view points, inspect archives and navigate
   an activity. Confirm exactly one award, private replies and retained old posts.
   Test paid confirmation cancellation/retry, a full gaming night and restricted-role
   access. Verify mobile layout and a bot restart without duplicate panels.
5. Officers can launch the proposed pilot through the forms, using real dates/prizes.
   Configure participation only for deliberately selected chat/voice channels.

## Validation and recovery

The original combined checkout passed 1,134 tests across 142 files. The isolated
release passed TypeScript, **1,073 tests across 138 files**, ESLint,
addon validation and Prisma schema validation (shell-only placeholder URL; no
database connection). Dedicated tests cover purchase confirmation and tampering, officer
reauthorization, visibility changes, numbered labels, DST, archive choices and routing.
The complete release build passed, including Windows installer packaging and both
dependency audits (zero vulnerabilities). A temporary Neon branch cloned from
production passed the migration: existing season/point/entry snapshots stayed
identical, the existing season became number 1 and its counter became 2. The branch
expires automatically at 2026-10-02 16:24 UTC. No production data was changed by
that rehearsal. The disposable PostgreSQL concurrency/restore gate runs in CI.
Real Discord member interactions remain a separate verification step.

Rollback: keep the additive database fields and counters. Revert bot code with the
previous release procedure; replace or remove unsupported panel components before
exposing them to an older bot. Restore the prior announcement destination/name from
the recorded configuration audit if needed. Preserve old activity destinations and
all ledgers; do not recreate the season or restore an old database just to undo a name.

Discovery currently loads accessible season/activity rows before pagination. This
fits the observed small community; add database pagination/archival limits before
large histories make autocomplete approach Discord's response deadline.
