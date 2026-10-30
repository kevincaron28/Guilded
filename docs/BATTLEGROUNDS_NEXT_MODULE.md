# Battlegrounds — next isolated module

Kevin approved implementation after the current release on October 30.
The PC integration chat owns coordination. Status: queued; no BG capture,
statistics or competitive awards are claimed as shipped in 8.2.0.

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
