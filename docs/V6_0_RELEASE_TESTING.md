# Guilded 6.0 release testing

Target: 6.0 public release. Current repository version: 5.0.0.
Release is not yet verified or published. Follow the deployment and backup gates in
[V5_0_RELEASE_HANDOFF.md](V5_0_RELEASE_HANDOFF.md); use
[RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md) for the full feature coverage.

## Confirmed test environment

- Owner's client: **WoW Forever beta** (confirmed 3 October 2026).
- Screenshot: character Ray; realm Classic Beta PvP; normalized realm ClassicBetaPvP.
- Addon reports saved data belongs to Quebec Gold-Classic Beta PvP.
- Owner confirms installed addon reports 5.0.0. The automatic check reports client
  version 1.60.1; the separate numeric client build has not yet been captured.
- Active executable verified locally: `_classic_beta_/WowB.exe`. Companion watches
  that same installation's account SavedVariables (not a different WoW client).

## Evidence, 3 October 2026

The owner's `/guilded diag` screenshot shows the addon loaded and five saved
COMPAT notices for unsupported CRAFT_SHOW, CRAFT_UPDATE and TRADE_SKILL_UPDATE
events, dated 30 September and 1 October. No LUA_ERROR is visible in these five
entries. This does not prove the complete diagnostic history is error-free.

Current source already treats alternate crafting events as optional in
Modules/Recipes.lua. tests/lua/recipes.test.ts covers those exact unavailable
events. The screenshot may show retained history or an older installed build;
it does not establish a new error or prove recipe scanning works.

Recipe scanning runs automatically when the profession window opens. The
`/guilded recipes mine` command only displays stored results; members do not need
to run it to enable scanning.

## Build alignment and refresh, 3 October 2026

- GitHub main, local HEAD and Oracle deployed HEAD all verified as
  `5ab7759eface69cde1339c8307e7adc13456ac1d`.
- Oracle checkout clean; systemd service active; local health endpoint returned
  `ok: true`, bot version 5.0.0 and protocol 2. No bot restart was necessary.
- [Guilded quality CI](https://github.com/kevincaron28/Guilded/actions/runs/37116716795):
  both `checks` (including PostgreSQL migration/restore) and `windows-package` succeeded.
- `npm run release:prepare` succeeded: 148 test files / 1,206 tests, type check,
  ESLint, addon validation, both audits with zero reported vulnerabilities,
  addon ZIP, browser companion and Windows NSIS installer.
- Installed addon was stale in Core.lua, Locale.lua, Modules/Sync.lua and
  Modules/Bidding.lua. Installed companion UI and engine were also stale.
  Version 5.0.0 alone did not distinguish these builds.
- Backed up the addon, saved data, companion settings/journal and old companion
  resources under `backups/2026-10-03-client-refresh-080011/` (gitignored).
  Saved-data and config copies verified by hash. Did not change SavedVariables
  or the companion-generated Standings.lua.
- Refreshed the installed addon; all 37 distributed source files checked match.
  Installed the rebuilt Windows companion (installer exit 0); all 20 checked
  application/renderer/engine files match. Personal credential, watched file and
  server configuration match their backup. Reopened the companion.
- Owner reported **08:04 and 08:06** successful companion uploads on 3 October:
  "Uploaded and applied automatically (0 ledger entries, 0 new characters).
  Your character is linked to your Discord account." This confirms upload,
  automatic application and the existing character link. It does not test a new
  ledger import, a new character pairing or the standings return path.

The owner then confirmed that Ray's EP/GP values and expected core match Discord
after the standings refresh and another reload. The upload and standings return
path passes for this installation and existing character.

The owner also confirmed that recipes appear automatically on Guilded's Crafting
page after opening a learned profession, without running a scan command.
Cross-player recipe sharing was subsequently confirmed below. Additional
professions and cooldown behavior remain separate checks.

The owner confirmed that window position and size persist after reload. Sidebar
accessibility and absence of new Lua errors were not explicitly reported in that
answer and remain separate observations.

The owner expects a second guildmate for map and loot tests. Start outdoors in
the same zone, on matching updated addon files, and check both map views.

### Guild map: asymmetric delivery recovered after a game reconnect

Owner initially reported that the second account saw a dot on the map, but this
PC did not. After the checks below, logging Seria out and back into the game
restored Ray's view of Seria's dot (owner confirmed). **The one-way symptom has
recovered; full map acceptance has not yet passed.** The exact underlying cause
is unconfirmed. The observations below preserve the investigation evidence.

Checked this PC's SavedVariables saved at 2026-10-03 14:48:20 UTC: `mapShare`
and `mapShow` are both true, no personal guildmap module override exists, and
guildModules.off does not disable it. Current source defaults missing share/show
settings to true and enables the module unless explicitly disabled. The latest
five stored diagnostics contain only the previously reported profession-event
notices; they do not establish whether the current map renderer succeeds.

Requested `/guilded map check` output from both accounts to distinguish no peer
position received from a drawing failure. Do not treat repeated enable commands
as a fix or override a member's explicit privacy choice. Cause remains unconfirmed.

Owner's screenshot from this PC confirms: module on, sharing on, dots on,
**peers 0**, with an available position in **Tirisfal Glades (1420)**. Therefore
no usable peer position is present here; changing pin placement cannot resolve
this observed state. The owner also confirms all three enable commands were run
on both computers. The second account's own position availability and current guild
membership still need to be captured before choosing a fix.

The owner then reports **peers 1 on the second computer**, with all settings on.
The current transport is therefore asymmetric; the second account's own position
availability, client send results and this PC's raw receive/reject counts have
not yet been captured. A diagnostic build adds session-only, payload-free client
send counters and map receive outcomes to `/guilded map check` (identified by
"Map diagnostics 2"). It also reports guild membership, combat, prefix
registration, last position queued and tick age. API acceptance is explicitly
not a delivery receipt. Enabled users no longer receive redundant enable-command
advice. The cause is still unconfirmed and map acceptance remains failed.

The diagnostic change also avoids advancing the position-send clock when no
guild channel exists, allowing the first update as soon as guild membership is
available. No change to map privacy defaults, protocol, saved data or ledgers.

Local diagnostic-build validation passed: TypeScript, all 148 test files / 1,211
tests, ESLint, addon static validation and the verified 38-file addon ZIP. New
tests distinguish client refusal, throttling, rejected/protected incoming messages,
valid peer positions and delayed guild membership. These simulated results do
not establish the cause of the live failure.

Diagnostic source commit `81409aa17e3eb2ba4bbfc4987c48f1682b9c82fb` passed both
`checks` (including PostgreSQL) and `windows-package` in
[CI run 37132183801](https://github.com/kevincaron28/Guilded/actions/runs/37132183801).
Installed and hash-verified Util.lua, Locale.lua and Modules/GuildMap.lua in the
owner's `_classic_beta_` addon folder. The prior three files were backed up and
verified under `backups/map-diagnostics-2-2026-10-03-111005/`. SavedVariables and
Standings.lua were not changed. A reload is required to use the new files.

`dist/Guilded-map-diagnostics-2-patch.zip` contains only those three addon files
and installation/rollback instructions; it is for the existing updated Guilded
installation on the second PC. Its SHA-256 is
`da74a94185a034370f3974c38d96b7d1377935ffe68b3063493623371032a01f`.
Next live check: apply the patch on the second PC, reload both, remain outdoors
and out of combat for 35 seconds, then capture the complete `/guilded map check`
output from both. The "Map diagnostics 2" line confirms the diagnostic build.
The next screenshot (codex-clipboard-7a813d27-9b83-4de1-99bd-f60afb1b0536.png)
shows the diagnostic build running, with module/sharing/dots on and **peers 1**:

- Own map Tirisfal Glades (1420); in guild; out of combat; prefix registered.
- Position queued 16 seconds ago; last tick 0 seconds ago.
- Client send results: accepted 2, refused 0, errors 0, throttled 0, queued 0;
  last result sent, code 0.
- Incoming map messages 1, positions 1, ignored 0; last outcome position.

The owner explicitly confirmed that this screenshot is from the **second
computer**. It proves that the second computer received and retained a usable
peer position, not that reception on the main computer recovered. Its two
outgoing updates were accepted by the client API; that alone does not establish
delivery to the main computer. The main computer's fresh "Map diagnostics 2"
output is still required after a reload and 35 seconds outdoors/out of combat.
The previously reported one-way failure remains unresolved. Full map acceptance
remains pending, including continent and nearby minimap views, movement, hover
information and sharing-off behavior.

The next screenshot from the main computer
(codex-clipboard-3067762a-8ba4-4650-b0fe-8b3b6d044472.png) still shows peers 0.
Module/sharing/dots are on; own map is Tirisfal Glades (1420); guild yes, combat
off and prefix registered. Position queued 4 seconds ago, last tick 0 seconds
ago. Client accepted 4 sends with zero refusals/errors/throttles/queued messages.
Incoming messages 4, positions 0, ignored 4, **last outcome self**. The last
outcome applies only to the most recent message; it does not prove that every
ignored message had that reason. This can represent normal echoes of this
client's own sends and does not yet prove a collision with another character.
Asked for the second character's exact name to check the identity comparison.

The owner identifies the second character as **Seria Cuthbridge**. Current name
normalization produces Seria, distinct from the main character Ray. The reported
names therefore do not support a collision in the self-name comparison. Next
check requested: Seria sends an ordinary guild-chat test and runs `/guilded map`;
confirm that Ray receives the chat and that Seria's stored map peer is Ray. This
distinguishes the guild-chat path from addon-specific delivery and confirms the
identity of the dot on the second computer before changing transport behavior.

Owner confirms **Ray does not see Seria's ordinary guild-chat test, and Seria's
map list shows Ray**. This establishes the identity of Seria's peer and a missing
ordinary-chat symptom on Ray in addition to missing addon positions. It does not
by itself distinguish game/server filtering from a local chat-display filter.
Asked the owner to check Ray's in-game Ignore list for Seria/Seria Cuthbridge or
the second account. Do not change addon identity or transport speculatively, and
do not mark the root cause confirmed until that check produces evidence.

Owner reports the Forever beta has no visible Ignore list. The standard-WoW
Social > Ignore instructions did not match this client's UI and must not be
repeated as verified beta instructions. Owner also confirms Seria sees the
ordinary `/g` test in her own chat without an error. That does not prove delivery
to Ray or rule out a local display filter on Ray.

Prepared a read-only, 204-character `/run` probe on Ray for the optional
`C_FriendList.IsIgnored` (legacy fallback `IsIgnored`) using Seria's short, spaced
and hyphenated names. The command uses `pcall` and prints `unavailable` if the
function is missing or fails; it does not alter ignore settings. Validated Lua
syntax and results against available/missing/throwing/legacy mocked APIs. Its
result on the actual beta client remains pending. The live API documentation
lists this function, but that is not confirmation that this beta exposes it.

### Temporary local automatic check (owner requested direct assistance)

Windows computer use found the exact running beta executable and window, but
capture failed with `FrameArrived timed out` / `window capture timed out` after
refreshing the window handle and retrying. Owner confirms WoW is already
windowed. No blind game input was sent. Ray's saved chat-cache enables GUILD in
General, Guild and Guilded windows; Guilded is the only installed addon.

Installed a **temporary local-only support probe** appended to the installed
Modules/GuildMap.lua, leaving repository addon source and distributable ZIPs
unchanged. It runs once for Ray for 35 seconds after PLAYER_LOGIN and writes
`GuildedDB.mapSupportProbe` (ID `ray-seria-20261003-1`). It reads optional ignore
APIs for Seria's name forms and matching roster entry, current guild/identity,
guild-chat capability and chat-window subscriptions. It counts incoming guild
chat and GuildedMap events and retains at most 12 sender/channel metadata rows;
no chat bodies or position payloads are retained. It sends no messages and
changes no ignore, guild, pairing, ledger or map settings.

Probe source, build/test/reader scripts are under gitignored `backups/`:
`map-support-probe.lua`, `test-map-support-probe.ts`,
`build-map-support-probe.mjs`, `read-map-support-probe.mjs`.
Lua 5.1 parsing and four mocked API scenarios passed, including missing/throwing
APIs, bounded metadata and one-shot completion. Required repository checks also
passed again (148 files / 1,211 tests, TypeScript, ESLint and addon validation).
This local support code has not been represented as a public release or map fix.

Installed combined module SHA-256:
`b7ee684bb33cbe5e3f24ae9e0c1c248baa7dbd74a2cbbbcffb263f63afeb8b41`.
Verified rollback copy:
`backups/automatic-map-check-2026-10-03-113950/GuildMap.lua`.
Next: owner reloads Ray, waits for the completion message (35 seconds), then
reloads again to save. Run `node backups/read-map-support-probe.mjs` to read only
that report from SavedVariables without executing Lua; it also writes
`backups/map-support-result.json`. Inspect the evidence, restore the temporary
module from its verified rollback copy, then choose the fix. Report is pending.

**First automatic report received and preserved** as
`backups/map-support-result-1.json` (SavedVariables modified at
2026-10-03T15:41:59Z). Ray has ignoreCount 0; all three Seria name forms and the
roster GUID ignore query returned false. Seria Cuthbridge is online in Quebec
Gold at rank Initiate; Ray is Officer and CanSpeakInGuildChat returned true.
Live General, Guild and Guilded chat windows subscribe to GUILD. The 35-second
trace contains eight GuildedMap messages, all raw sender `Ray Pissjug`, normalized
Ray, channel GUILD. No Seria addon message reached the observer. All eight own
sends were accepted. Both snapshots report
`C_ChatInfo.AreOutgoingAddonChatMessagesRestricted()` true, which is a realm
policy flag in the published API docs; it does not alone explain the asymmetric
delivery reported on this beta, and must not be used to claim a proven cause.
Reference: [Blizzard-generated ChatInfo API documentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ChatInfoDocumentation.lua).

Restored and hash-verified the original module after preserving that report.
Then installed a second read-only local check (ID `ray-seria-20261003-2`, five
seconds) that additionally captures named guild ranks' listen/speak flags via
`C_GuildInfo.GuildControlGetRankFlags`, the beta's corresponding option labels,
Seria's roster rank index, chat-lockdown and current-account trial flags. It
does not call the protected rank-selection/edit APIs. Lua 5.1 parsing and the
temporary tests passed, including distinguishable listen=true / speak=false
rank results. This check's combined module hash is
`0a1b71336d4f1e5494165437bcacdaa2bd79875356e152d871005c4e473d7552`.
The original rollback copy remains unchanged. Await two reloads with the
five-second completion message between them, then read the same report path and
restore the module again. No permissions have been changed and map remains failed.

**Second automatic report received** (SavedVariables modified
2026-10-03T15:46:08Z), preserved as `backups/map-support-result-2.json`. Client
version 1.60.1; Ray is not a trial/veteran-trial account; chat lockdown false;
the separate addon realm-policy restriction flag remains true. Every named rank
(Guild Master, Officer, Veteran, Member, Initiate) has Guildchat Listen and
Guildchat Speak true, using the client's own option labels. Seria is now listed
as Member (rank index 3), not Initiate as in the first report; the assistant did
not change any rank. Seria is online and not ignored. The five-second trace
contains only two own-message echoes and zero peer positions. This rules out
the checked rank permissions and Ray's ignore list; it does not establish why
Seria's messages are absent or establish Seria's account flags.

Restored and hash-verified the normal module again (source commit 81409aa).
Both temporary probes are complete and no longer installed. Their reports remain
in SavedVariables and local backups for evidence. Next requested test: reconnect
Seria through logout/login, leave both outdoors for 35 seconds, then check
whether Ray sees her dot. Do not call an addon UI reload a game-session reconnect.

**Reconnect recovery confirmed by owner:** after Seria logged out and back into
the game and both remained outdoors for 35 seconds, the owner answered:
"Yes, Ray now sees Seria." This confirms recovery of the missing dot on Ray's
computer. The assistant changed no ignore or guild permission settings; Seria's
rank change noted above was outside the assistant's actions, and both old/new
ranks allowed guild chat in the API results. Recovery after reconnect suggests
a beta game-session delivery problem, but does not establish the exact server
or client defect. Do not claim an addon transport change fixed it.

**Map views and hover names confirmed by owner:** the owner answered "yes all
work now" to the check that both players see the other on zone and continent
maps and on the minimap when close, with the correct name on hover. This passes
those specific views and hover names on both computers. Movement, class colours,
level/zone tooltips, instance removal and rotating-minimap checks remain pending.

**Sharing toggle confirmed by owner:** on Seria, `/guilded map share off`
removed her dot on Ray; `/guilded map share on` restored it within the requested
10-second window. The owner answered "yes that works". Sharing was left on.

### Two-player bidding

**Popup, bid receipt and cancellation confirmed by owner:** Ray and Seria joined
the same party; Ray started `/guilded bid start 10 Guilded Test Item 120`;
Seria received the popup and bid 15 GP; Ray saw her bid with
`/guilded bid status`; `/guilded bid cancel` closed Seria's popup. The owner
answered "yes" to all three outcomes. Award was excluded from this test because
it creates real ledger entries. This does not yet verify awarding or importing.

**Ordinary-whisper bidding confirmed by owner:** after opening another test
auction, Seria whispered Ray `30`. The owner answered "yes" when asked whether
Ray's `/guilded bid status` showed Seria at 30 GP. The instructions ended with
cancellation and excluded Award; this still does not verify awarding/importing.

**Auction recovery and post-reload delivery confirmed by owner:** in a
180-second test auction, Seria bid 15 GP; Ray reloaded and still saw that bid.
Seria then raised it to 20 GP, which Ray received. The owner answered "yes to
all" to the test ending with cancellation and excluding Award.

**Member page visibility and bidding permission confirmed by owner:** on Seria
(Member), Raid, EPGP and Loot pages are hidden, and
`/guilded bid start 10 Guilded Permission Test 30` is refused with
"Only officers can run loot bidding." The owner answered "yes to all".
Other officer commands and Discord permissions remain separate checks.

**Council popup, responses and cancellation confirmed by owner:** Ray started
`/guilded council start Guilded Test Item 180`; Seria answered Upgrade in the
popup and Ray saw Upgrade in council status. Seria then whispered `bis` and
Ray saw her response change to BiS. Ray cancelled and Seria's popup closed.
The owner answered "yes to all". No Award was requested; council awarding,
officer voting and ledger import remain separate unverified checks.

**Automatic cross-player recipe lookup confirmed by owner:** Ray opened a
learned crafting profession normally while Seria was online. After the requested
15-second wait, Seria searched for one of Ray's known crafted items in Guilded's
Crafting page using Who can craft it. The owner answered "yes" that Ray appeared
without a scan or share command. This covers automatic sharing and lookup for
the tested recipe, not all professions, filters or cooldowns.

### Two-player soft reserves

The owner reports `/guilded reserve list` says "No reserve list is open" on
Ray before testing. Ray then opened `/guilded reserve open 1 Guilded Test`;
Seria reserved a real item using its shift-clicked item link. The owner answered
"yes" that `/guilded reserve list` shows Seria's reservation on both computers.
Creation and shared visibility pass. No roll or award was requested.

**Lock enforcement, removal and cleanup confirmed by owner:** Ray locked the
test list; Seria's removal was refused and her reservation remained. After Ray
unlocked it, Seria removed the item and both computers showed it gone. Ray then
cleared the empty list. The owner answered "yes to all". No item was awarded;
whisper reservations, restricted rolls, tooltip display and SR+ remain unverified.

**Core selection observed before award testing:** the owner's screenshot of
`/guilded core` shows "Loot system: GP bids - the guild's default" and lists only
Les Dix-Fonctionnels (EPGP priority / set prices). It also shows "Reserves cleared."
No separate test core is visible in the addon's current rules snapshot.

**Separate test core configured:** the owner confirms creating Guilded Test
with no schedule and setting Its own pool / GP bids in Discord. A read of the
installed companion-generated Standings.lua confirms Guilded Test is already
downloaded with id `cmuslrc4702j3ntsexaxz9807`, mode `EPGP` (GP bids) and
`pool = true`. The owner then confirmed Ray reloaded, selected
`/guilded core Guilded Test`, and saw "Loot system: GP bids - Guilded Test".
Core.lua's changeEpgp uses the selected core's id when its pool flag is true.
A simulated raid alone must not be assumed to isolate real characters' ledger
entries. Once a separate core has point history, the existing deletion guard
retains that history.

Next requested live award: keep Guilded Test selected; Ray opens
`/guilded bid start 10 Guilded Test Award 120`; Seria bids 15; Ray verifies
Seria at 15 with bid status, awards once, then reloads to save/upload. This
intentionally adds 15 GP to Seria in the separate test pool. Verify the winner
message and companion application result, then inspect the saved entry and
Discord pool before testing duplicate-upload handling.

**Award saved, import held for unlinked Seria:** the owner's 12:29 companion
message reports 0 applied ledger entries and 1 on hold. Read-only parsing of
SavedVariables confirms one +15 GP entry for Seria, reason `Bid: Guilded Test
Award`, source `qg:Ray-1791044969-12`, in test core
`cmuslrc4702j3ntsexaxz9807`. The separate loot row is
`qg-loot:Ray-1791044969-11` and has no raid reference. At 12:30 the companion
wrote standings for two characters; that alone does not confirm this award.
The owner ran `/import held`: code LOS7JT is the +15 GP entry, held because
Seria is not linked to a Discord member (UNLINKED). Next: link the discovered
Seria character to its actual owner's Discord account, then reload Ray to retry
the existing entry. Do not award again or dismiss the held entry. GP application,
loot-record application and winner-popup confirmation remain unverified at that stage.

**GP application and isolated return standings verified at 12:33:** after the
linking step, the owner reports 1 applied ledger entry and 1 remaining hold.
The downloaded standings acknowledge `addon:qg:Ray-1791044969-12` and show
Seria with 15 GP in Guilded Test, 0 GP in the guild pool and 0 GP in
Les Dix-Fonctionnels. This confirms the GP entry applied to the intended test
pool and returned to the companion. It does not yet confirm in-game display
after reload or repeated-upload deduplication.

The saved loot row has no raid reference and the downloaded rules have
`coreOnly = true`. The importer holds linked loot without a matching separate-pool
raid as NO_CORE_RAID; this is the expected remaining hold, pending confirmation
from `/import held`. The test instructions omitted a matching raid and must be
corrected before claiming complete loot-record import coverage. Do not re-award
the item or charge the 15 GP again. Winner-popup confirmation also remains pending.

**Remaining hold confirmed:** `/import held` shows RRLKWG, Seria,
Guilded Test Award (15 GP), NO_CORE_RAID. This is the separate loot row, not the
already accepted GP entry. Because the row has no raid reference, ending a new
raid cannot retroactively associate it. Next requested cleanup: dismiss only
RRLKWG, reload Ray to repeat the upload, and verify 0 new ledger entries and
Seria still at 15 GP in the Guilded Test Discord leaderboard. Dismissal is for
this artificial unassociated loot record only; it does not reverse its GP.
A fresh award during a correctly matched recorded test raid remains required
for complete loot-history acceptance.

### EPGP Discord command routing defect

During the duplicate-upload check, the owner reported `/epgp leaderboard
core:Guilded Test` returned "That command is not available." Source inspection
found epgpCommand was published but executeEpgp was absent from main.ts's fallback
handler map. Added its import and handler registration without changing the
version, schema or point data. A regression check walks every published command
route through the real resolver and checks main.ts's fallback registrations
without importing main.ts or starting a bot. Before the fix it failed for all
seven EPGP subcommands. Validation and deployment are in progress; do not ask
the owner to retry until the live handler has been updated. Dismissal and
duplicate-upload results from the preceding instructions remain unconfirmed.

**EPGP handler fix validated and deployed, 3 October 2026:** all 149 test files /
1,212 tests, TypeScript, ESLint and addon validation passed. Full
`npm run release:prepare` also passed, including audits and Windows packaging.
Both PostgreSQL checks and Windows packaging passed for source commit 03257f4
([CI](https://github.com/kevincaron28/Guilded/actions/runs/37138135828)) and
merged main commit `7d8152c6bf2f75c7e4c19c0dbe6d21dbf8517b63`
([CI](https://github.com/kevincaron28/Guilded/actions/runs/37138358110)).
PR #37 is now merged; its earlier draft/pending statements above are historical.

Production ledger preflight passed. A custom PostgreSQL dump was verified with
pg_restore --list, and the application was archived under
`/home/ubuntu/guilded-recovery/2026-10-03T16-48-13-667Z` (private files).
Oracle Node was updated from 22.23.3 to 24.21.0 using the existing signed
NodeSource repository; the old package and repository configuration were saved.
The deployment script copied main and restarted the existing service. Its first
migration precheck timed out acquiring the advisory lock; systemd's automatic
retry succeeded, with no pending migrations. Verified deployed commit 7d8152c,
service active, Discord logged in and local /health returning ok true, version
5.0.0, protocol 2. No second bot was started. Desktop companion installation was
not changed in this deployment; rebuilt artifacts are local, not a 6.0 release.

**Live EPGP retry passed:** the owner supplied the Discord response to
`/epgp leaderboard core:Guilded Test`: Guilded Test pool lists claudyazes with
EP 0 / GP 15 and kevmister28 with EP 0 / GP 0. The leaderboard displays Discord
member names; this matches the previously verified Seria 15 GP test-pool entry.
This confirms the live handler repair and Discord pool display. Next check:
reload Ray once more, wait for the companion upload, and verify it applies zero
new ledger entries and the same leaderboard remains at 15 GP. Repeated-upload
deduplication was subsequently verified below.

**Repeat upload passed at 12:58:** the owner reports an automatic upload with
0 ledger entries / 0 new characters and no remaining hold warning. Read-only
inspection of returned standings timestamped 16:58:34Z confirms the same accepted
ledger reference and Seria still at 15 GP in Guilded Test, 0 in the guild pool
and 0 in the existing raid core. The repeated upload did not duplicate GP.

**Matching Discord raid created:** the owner supplied the Guilded Test Raid
signup card at 13:01: Planned, 3 October 2026 at 13:15, core Guilded Test,
0 signups. Two copies of the card were pasted; this alone does not establish
two database raids (shared/core channel posts are supported).

Next requested in-game test, with Ray and Seria in the same party: Ray selects
Guilded Test, starts recording Guilded Test Raid and confirms the start succeeded;
opens a 120-second bid for Guilded Raid Test Award, Seria bids 10, Ray verifies
and awards once, then ends the recorded raid and reloads. Expected test-pool GP
for Seria is 25 (existing 15 plus 10), with one new GP entry and a raid-associated
loot record. If another raid is already active, stop instead of awarding into
it. Complete loot import and the winner message remain pending.

**Recorded raid award imported at 13:06:** owner reports 1 applied ledger entry,
0 new characters and no hold warning. SavedVariables show the +10 GP entry
`qg:Ray-1791047136-14` in Guilded Test, and loot row
`qg-loot:Ray-1791047136-13` with raidRef `1791047102-Ray`. The completed addon
raid ran 17:05:03Z to 17:05:44Z and saw Ray and Seria. Returned standings
acknowledge both test entries and show Seria 25 GP in Guilded Test, 0 in the
guild pool and existing core.

Read-only production verification confirms exactly one loot row for that source,
amount 10, attached to Discord raid `cmusn307h006into7z62i6fo5`, which has two
attendance records. Both GP source references exist once (15 and 10 GP).
Complete recorded-raid loot import passes; winner-popup confirmation remains
unreported. The second pasted signup card actually is a second database raid:
`cmusn4gw80082nto7ksyv6lhs`, same title/time/core, with zero attendance/signups.
Both are still PLANNED. Next cleanup: cancel only the empty duplicate, then
start and end the matched test raid in Discord (end requires ACTIVE), declining
the optional EP proposal. Preserve
the test award/attendance audit trail. No claim is made about why the duplicate
raid was created.

**Test raid cleanup verified:** owner reports "EP award cancelled. Nothing was
recorded." A subsequent read-only database check confirms matched test raid
cmusn307h006into7z62i6fo5 is COMPLETED with two attendance records; empty duplicate
cmusn4gw80082nto7ksyv6lhs is CANCELLED. The imported loot row remains attached to
the completed raid and both GP entries (15 and 10) remain present. The cancelled
proposal concerns new EP, not deletion of existing attendance/loot history.

**Imported GP reversal passed:** after `/guilded void Seria` and reload, the
owner's 13:11 companion message reports 0 new ledger entries and "1 voided in
game and taken back." The 13:13 Discord Guilded Test leaderboard shows
claudyazes at EP 0 / GP 15 and kevmister28 at EP 0 / GP 0. Both show attendance
100%, reflecting the recorded test raid. This confirms the imported 10 GP award
was reversed once; it does not imply removal of the separate loot-history record.

**Priority configuration confirmed:** the owner answered "yes" after changing
only Guilded Test to EPGP priority (set prices), refreshing standings, reloading
Ray and confirming `/guilded core Guilded Test` reports that mode.

**Fixed-price priority award passed:** after the requested recorded test raid
segment, 20 GP price, Seria-only I want it response and timer-driven award, the
owner reports one applied ledger entry at 13:21 and confirms 35 GP. Returned
standings independently show Guilded Test in PRIORITY mode, its item price
`guilded priority test = 20`, and Seria at 35 GP (other pools remain zero).
This covers automatic fixed-price awarding with one interested player;
highest-PR competition remains separate.

Next: repeat the same 20 GP item in another recorded test segment with Seria
choosing Off-spec and Ray passing. Verified returned rules have offspec = 50,
so the automatic award should cost 10 GP and bring Seria to 45 GP after end/reload
and import. The existing non-cancelled Discord test raid is still within the
importer's four-hour matching window, which allows completed raids.

## Installation documentation prepared locally

GETTING_STARTED.md now routes members and owners to separate guides.
MEMBER_INSTALL.md includes the actual beta client path, current companion labels,
personal pairing, expected success messages, return sync, troubleshooting and a
French quick start. GUILD_OWNER_SETUP.md covers an independent application,
database/host, HTTPS, permissions, initial acceptance tests and a member handout.
AI_SETUP_HELP.md provides copyable member, owner and troubleshooting prompts.
These changes are local and still need release publication and first-time user testing.

**Setup improvements prepared locally for 6.0:** desktop defaults and the CLI
example no longer prefill Quebec Gold's bot address. The address field is visible
before the pairing fields, and an unpaired companion initially opens setup.
Existing configurations still override defaults, preserving their address and
credential. Browser mode retains its own origin and hides the desktop address
field. Fresh-server setup now installs Node 24 when Node is missing or older.
These changes need new CI/build evidence and clean-install acceptance; they are
not yet installed or deployed. Live tests above remain against baseline 5ab7759.

Candidate local validation: `npm run release:prepare` passed after the setup
changes (148 files / 1,206 tests, type check, lint, addon validator, both audits,
addon ZIP, web build and Windows installer). The server script passes `bash -n`.
All local documentation links in the new setup paths resolve. A browser preview
with a fresh desktop configuration opens Connection & setup and shows an empty
guild bot address above pairing; this is a UI fixture check, not a fresh-PC install.
[PR #37](https://github.com/kevincaron28/Guilded/pull/37) is a draft. Both
`checks` (including PostgreSQL) and `windows-package` passed for candidate commit
`4ee66489abf1a2500a191b507f40912575972d73` in
[CI run 37122892433](https://github.com/kevincaron28/Guilded/actions/runs/37122892433).
Real first-time owner/member installation remains required. This is not a merge,
deployment or public release confirmation.

## Remaining release gates

### Owner confirmation, 4 October 2026

The owner confirmed that Ray and Seria both reloaded the patched addon and
passed the two-player loot-response feedback and off-spec GP retests. This
closes those two pending checks from 3 October. The off-spec test described
above expected a 10 GP charge for the 20 GP item at 50% off-spec pricing.
This is owner-reported acceptance; no new database inspection was performed
for this confirmation. Other unchecked release gates below remain pending.

- [x] Patched two-player loot-response feedback after both clients reloaded.
- [x] Off-spec GP retest (owner confirmed both retests passed).

### Loot response feedback fix (3 October, 13:36 local)

Owner reported that Seria's I want it / Off-spec clicks gave neither player
visible feedback. Council responses now appear on Ray's Loot page as well as
Council, with local chat for new or changed answers. Seria's popup shows a
pending answer immediately and confirms it in local chat only after the host's
ACK. Failed queue attempts report failure; unrelated and stale pending ACKs are
ignored. English and French feedback included.

Validation passed: 149 test files / 1,215 tests, TypeScript, ESLint and addon
validator. Three changed Lua files installed and hash-verified on Ray's Forever
beta client; originals saved under `backups/loot-feedback-2026-10-03-133610`.
`dist/Guilded-loot-feedback-patch.zip` contains the same three files and install
instructions for Seria. The full 5.0.0 addon ZIP was rebuilt; no version bump,
bot deployment or public publication. Both clients need `/reload` after Seria
installs the patch. Real two-client feedback verification remains pending;
off-spec's expected GP amount is not yet marked passed. Cancel the feedback-only
test before expiry to avoid another automatic award.

- [x] Local release preparation for baseline commit 5ab7759 (rerun after changes).
- [x] PostgreSQL migration/restore and Windows packaging CI for baseline 5ab7759
  (require new green CI for the final release commit).
- [x] Installed addon/companion files and deployed bot aligned with baseline 5ab7759.
- [x] Companion upload and existing character link confirmed by owner at 08:04 / 08:06.
- [x] Standings return and in-game values match Discord for the selected pool
  (owner confirmed both values and core).
- [x] Recipes appear automatically after opening a learned profession
  (owner confirmed; no manual scan command).
- [x] Window position and size persist after reload (owner confirmed).
- [x] Both players see the other on zone/continent maps and the nearby minimap,
  with correct hover names, after Seria's game-session reconnect (owner confirmed).
- [x] Seria's sharing toggle removes her dot on Ray and restores it when enabled
  again (owner confirmed; sharing left on).
- [x] Seria receives the bidding popup, Ray receives her 15 GP popup bid, and
  cancellation closes her popup (owner confirmed; no award requested).
- [x] Seria's ordinary whisper of 30 is recorded as a 30 GP bid on Ray
  (owner confirmed).
- [x] Ray's reload preserves Seria's 15 GP bid; her subsequent 20 GP bid arrives
  and the test auction is cancelled (owner confirmed).
- [x] Seria's Member rank hides Raid, EPGP and Loot pages and refuses starting
  a bid auction (owner confirmed).
- [x] Council popup Upgrade response, ordinary-whisper BiS update and popup
  closure on cancellation work between Ray and Seria (owner confirmed).
- [x] Seria finds Ray as a crafter after Ray opens his profession normally,
  without a manual scan or share command (owner confirmed).
- [x] Ray opens a test soft-reserve list and Seria's linked-item reservation
  appears on both computers (owner confirmed).
- [x] Locked reserves refuse Seria's removal; unlocking allows removal on both
  computers, followed by clearing the empty test list (owner confirmed).
- [x] Test-pool GP awards import and return in standings (15 then 25 GP), while
  the other pools remain at zero; repeat upload does not duplicate the first award.
- [x] Recorded-raid loot award imports once with two attendance records; matched
  test raid completed and empty duplicate cancelled (database verified).
- [x] Voiding the imported 10 GP test award reverses one entry and returns the
  test pool from 25 to 15 GP (companion and Discord confirmation).
- [x] Priority mode automatically awards the 20 GP priced test item to Seria,
  imports one entry and returns a 35 GP balance (owner and standings verified).
- [ ] Solo client checks: UI, professions, saved data, reload and personal sync.
- [ ] Two-player checks: map, loot, ledger deduplication, core pools and permissions.
- [ ] Fresh guild setup with its own bot/database and an ordinary member account.
- [ ] Windows clean install and upgrade on a non-developer PC; recovery and uninstall.
- [ ] Publish clear owner/member installation, troubleshooting and AI-help prompts.
- [ ] Finish all applicable real-client checks in RELEASE_CHECKLIST.md.
- [ ] Real raid night with accurate totals before promoting Beta to Release.
- [ ] Set the shared release version to 6.0.0 intentionally, rebuild and rerun gates.
- [ ] Publish matching addon and companion downloads and verified release notes.

Unchecked items are pending, not passes. Record skips with their client limitation
and reflect those limitations in the public listing.
