# Community achievements — 27 October 2026

The badge implementation uses shared **100 / 300 / 500 earned community point**
thresholds for recognition, progress and congratulations. It does not change the
point rules, spendable wallet, loot priority or Discord roles. Product version
remains 7.5.0; this is a bot/web/database change, with no addon payload change.

## Member experience

- `/community badges` shows your seasonal shelf; choose `season` for archives.
- In Québec Gold, `player` shows another eligible current member's shelf without
  a sharing toggle, as requested by the owner on 27 October. Both viewer and owner
  must still have access to the season's channel and audience role. Responses are
  ephemeral; private proof and review notes are never rendered.
- Other Discord servers retain opt-in sharing: `share:true` shares that season,
  `share:false` withdraws it. Québec Gold's registered command omits this option;
  cached share requests explain the member-visible policy without changing old
  preference rows. No preference rows, badges or historical records are deleted.
- Signed-in `/me/badges` provides the same shelf under the existing guild/member
  and season access checks. Public character profiles expose no new badge data.
- Reviewed helper nominations and independently confirmed event attendance give
  cosmetic helper/participant badges. A creator earns the organizer badge when
  another member's attendance is confirmed. These extra badges have no public
  announcement, no points and no roles; proof links and review notes stay private.

## Baseline and preservation

The additive migration creates `CommunityBadgeConfig`, `CommunityBadge` and
`CommunityBadgeSharing`. It never edits or resets points, prior honors or runs.
Initialization reconstructs conservative earned-score peaks from AWARD + REVERSAL
ledger entries (equal timestamps grouped). It preserves evidence-backed legacy
50/150/300 recognition and already-reached new milestones **silently**. Historical
records have a null earning date and a separate recorded date. No dates are guessed.
Archived seasons initialize only after an authorized shelf request. New records
retain their earning date and survive spending, reversals, season rollover and
character relinking. There are no new legacy-tier awards after initialization.

## Delivery and operations

`/organize badge-settings season:<season> enabled:<true|false> channel:<channel>`
requires officer authority, active Discord season and equivalent channel visibility.
Role-restricted seasons cannot enable celebrations: channel visibility alone cannot
prove that every reader has the season role. Delivery also cancels queued posts if
a season gains a role restriction, even when source and destination are identical.
Configuration and ledger writes share the existing guild advisory transaction lock.
Threshold records are unique per season/member/code; the season belongs to one guild.
An award crossing several thresholds records all of them but queues only the highest.
The record is also the transactional outbox; generic refresh jobs are not reused.
Completed deliveries cannot be requeued. Re-enabling silently suppresses old pending
work; unchanged settings are a no-op. Monthly rotation carries configuration, not
sharing choices or old achievements, to the new season.

The dispatcher checks current season/audience/membership/destination and score,
escapes names and disables all mentions. It sends at most five per scheduler pass.
It durably changes PENDING to ATTEMPTED **before** contacting Discord. Success stores
the message ID and SENT. An ambiguous error becomes UNCERTAIN; a crash can leave
ATTEMPTED. Neither state is automatically retried. This intentionally prefers a
missing congratulations to duplicates: Discord nonce deduplication expires and
cannot prove that a deleted message was never delivered. Investigate uncertain
rows manually; do not reset them to PENDING or replay deleted messages. Preflight
failures before the durable attempt leave PENDING for retry after five minutes,
without blocking later members. A departed member or explicit access denial cancels
that announcement permanently, retaining the earned badge. Turning off or ending
a season cancels undelivered records. No message history scanning or backfill.

For Québec Gold (`1323321076478119967`), read-only discovery confirmed
`chat-communauté` (`1555370176755802123`), topic “Chat communautaire pour tout le
monde, tous jeux confondus.” The active Discord season uses the community leaderboard
channel and has no audience role. Final live audience/permission checks and a fresh
silent baseline are required at enablement; earlier aggregate counts are not a
frozen migration input. No synthetic member achievement may be posted to production.

## Verification and rollout

The PostgreSQL release gate now verifies silent baseline/legacy dates, concurrent
crossings, combined jumps, transaction rollback, spending/refunds, reversal/recross,
single-send claims, ambiguous failure suppression, sharing, pause/re-enable and
backup/restore. Unit tests cover exact boundaries, name escaping, EN/FR, shelf
privacy, archived display and forbidden web access/mutation. Run the complete
TypeScript/lint/Vitest/addon validators and both GitHub quality jobs on the exact
final commits before the normal verified-backup/Oracle update procedure.

Before activation: inspect the shared coordination log, confirm no conflicting
operator/release, run ledger preflight, verify database/application backups and
encrypted off-server copies. Deploy once; verify accepted commands and health;
enable only the authorized guild/season/channel and verify zero pending baseline
announcements. Rollback: disable celebrations, restore the prior application
using the recorded recovery path if needed, and retain additive tables/records.
Do not drop achievements or restore an old database over newer member activity.

## Deliberate evidence gates

Max-level badges remain gated: a stored imported character level is not trusted
ownership-and-level evidence. Edition cap plus verifiable ownership/level attestation
is required before implementing automatic awards. Streaming and dungeon-breadth
badges remain future candidates. No message-count, idle-voice, microphone/camera,
or unverified imported-level achievements were added. Real member crossing and
browser/Discord acceptance remain distinct from synthetic tests.

Dungeon scoring work follows the badge deployment milestone, in a separate reviewed
change, and must preserve both addons' source/payload compatibility.
