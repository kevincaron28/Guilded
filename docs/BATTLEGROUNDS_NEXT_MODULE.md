# Battlegrounds — implementation and acceptance

## Current checkpoint — October 30

8.3 organization is deployed with the website/Companion remodel and opt-in
automation. GitHub's 23 public downloads and all ten approved CurseForge edition
downloads are hash-verified. Store Submission 6 is published; installed 8.3
verification remains pending. The selected season calendars are unchanged.
All available testing is authorized now; the earlier wait-until-launch direction
is superseded. Publication does not imply real-client acceptance.

The [QuébecGold BG hub](https://discord.com/channels/1323321076478119967/1552246570714402827/1565730945766527019)
was posted in the existing scoped channel at 14:15 UTC. Its French Create, Join,
My groups and Upcoming buttons use deployed **8.3 organization controls only**.
Permissions were unchanged and mentions suppressed. Native click acceptance is
not recorded; results/statistics buttons await deployment of the new handlers.

The **8.4 source candidate**, on `codex/bg-recorder-history-oct30`, now includes:

- A provisional Forever adapter reading only permitted postmatch own-player
  evidence, with explicit local consent, capability/Hardcore checks, durable
  reporter-local IDs and reload/backfill limitations. SavedVariables flow through
  Companion; no opponent roster or universal damage/honor rating is collected.
- Independent server capture/statistics consent and authenticated paired-member
  ownership. Staging and ingestion serialize against consent changes. Replays are
  idempotent; conflicting evidence remains unranked with a bounded explanation.
- Private result cards/history, withdrawal with a recorded correction reason,
  and scoped member-data export. Withdrawal cannot manufacture a replacement win
  or restore a withdrawn report through replay.
- Consented provisional **player-participation** counts, wins/losses/draws,
  known-outcome sample and win rate by edition/season/mode/API bracket. These are
  player reports, not unique matches or a verified guild ranking.
- An explicit `/guilded bgcapture premade <code>` source path for the next
  capture only, confirmed in the recorder source. Teammates enter the same code
  themselves; it is consumed after capture and cleared on disable/login/reload.
  Distinct consenting reporters and compatible observations may corroborate a
  provisional association; a shared code never proves a universal match ID.

Root is integrating these changes. They are not deployed or included in frozen
8.3 artifacts. Focused checks have passed, while integrated CI, migrations,
packaging and real acceptance remain release gates.

### Still gated or incomplete

Verified unique-match reconciliation, verified match statistics and further
accepted adapters require the live pilot; they are not marked complete. Forever
cannot be tested on its real client before November 4. Other editions' capture
adapters are disabled. Only Retail Blitz has a reviewed queue-start policy;
other formats remain planning-only. Corrections currently withdraw evidence,
not edit results or resolve a dispute into a verified match. Capture currently
belongs to the full Guilded addon, not standalone GuildedDungeons. No automatic
BG channel posts, recurring delivery or competitive awards are enabled.

See [capture capabilities and limits](BATTLEGROUND_CAPTURE_PILOT.md) and the
[release integration record](RELEASE_INTEGRATION_2026-10-30.md).

## Historical approved module plan — before 8.4 implementation

Kevin approved implementation after the current release on October 30.
The PC integration chat owns coordination. Organization implementation is on
`codex/battleground-organization-oct30`. No BG capture, statistics or competitive
awards are claimed as shipped in the frozen 8.2.0 clients.

The first implementation provides private `/bg panel`, `create`, `join`, `mine`,
`upcoming`, `view`, `leave` and leader `manage` commands. It reuses the existing
transaction-locked PvP session/lineup system, with one-off scheduling and all
automatic BG delivery suppressed. Signups require an owned character in the
chosen edition/bracket and personal normal-realm/faction confirmation. The
character model does not yet verify faction or Hardcore status from game data;
these remain explicit declarations, not verified capture.

Retail Blitz uses a two-person queue limit and a healer requirement for duos,
based on [Blizzard's published queue rules](https://worldofwarcraft.blizzard.com/en-gb/news/24119590).
Other formats currently allow a planning lobby of at most five (a product limit,
not a claimed legal queue limit); starting is blocked until a reviewed adapter
exists. This is a partial organization phase, not all-edition queue acceptance.
The EN/FR Discord panel now has Create, Join, My groups and Upcoming controls;
Create selects format/faction and opens a five-field form in the current channel.
Join requires the player's character, role, faction and normal-realm declaration.
Native recorder and real Discord visual acceptance remain outstanding.

1. Organization panel: reuse PvP teams/groups for Create, Join, My group and
   Upcoming sessions. Edition, map/random queue, bracket, faction, casual/rated,
   roles and start time; legal queue-party limits; EN/FR and mobile layouts.
2. Forever recorder pilot: permitted postmatch APIs only, SavedVariables through
   existing Companion sync, separate match/reporter/consenting-participant data.
   Record incomplete/presence/backfill/early-exit capability limits. Hardcore BG
   features remain disabled; other editions need verified adapters.
3. Cards/history: durable reporter IDs, optional premade nonce and corroborating
   fields; never merge by map and timestamp alone. Conflicts stay reviewable and
   unranked. Participant opt-in, minimal opponent data, corrections and throttling.
4. Guild-only seasonal statistics after pilot: matches, wins and win rate with
   sample count, separated by edition/bracket/mode. No invented MMR or universal
   damage/healing/honor score. Additional adapters follow real acceptance.

Automatic external posts and awards stay OFF. Channel/audience consent and
validated capture are prerequisites; organizer consent does not cover everyone.
No unsolicited channel creation or voice participation. No dungeon/EPGP changes.

Acceptance: win/loss, backfill, early leave, reload/disconnect, replay, two
reporters, permission loss and corrections. Forever availability and multi-client
tests are material gates. Capture must respect SecretInActivePvPMatch; no live
restriction bypass. [Reviewed API source](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/PvpInfoDocumentation.lua).

## Historical implementation sequence — October 30

Recorder, result cards/history, deduplication/privacy and separate guild statistics
remain approved. Integrate the 8.3 organization/remodel/automation candidate first,
then implement the capture pipeline on a separate branch: versioned consenting
reporter payload and idempotent ingestion, private history/corrections and
unranked conflict handling, then opt-in guild statistics/cards. Native capture
requires a capability-checked postmatch adapter; Forever live verification cannot
run before November 4. Unsupported adapters remain disabled, and provisional
evidence cannot grant competitive points or trigger public sends. This sequence
does not remove the remaining features from scope.
