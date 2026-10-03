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
Cross-player recipe sharing, additional professions and cooldown behavior remain
separate checks.

The owner confirmed that window position and size persist after reload. Sidebar
accessibility and absence of new Lua errors were not explicitly reported in that
answer and remain separate observations.

The owner expects a second guildmate for map and loot tests. Start outdoors in
the same zone, on matching updated addon files, and check both map views.

### Open failure: asymmetric guild map dots

Owner reports that the second account sees a dot on the map, but this PC does
not. **Map acceptance has not passed.** The observations below identify an
asymmetric connection; its cause remains unconfirmed.

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
