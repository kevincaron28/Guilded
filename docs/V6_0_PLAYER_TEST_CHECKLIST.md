# Guilded 6.0 player testing tracker

Saved 5 October 2026 at the owner's request. Guilded 6.0.0 is the full Release;
the next planned update is 6.1.0. Unchecked rows are unverified, not known failures.
Use this checklist over the coming weeks and retain results across sessions.

Owner setup decision, 5 October: online companion webpage is the default for
Discord synchronization. Keep the Windows companion optional for automatic file
watching, background sync and PoE2 log tracking, especially useful for leaders
and officers. Desktop install tests remain relevant to that optional path.

Deployment, automated checks, backups, website, GitHub assets and public CurseForge
Release distribution are completed. Existing gameplay passes are recorded in
[V6_0_RELEASE_TESTING.md](V6_0_RELEASE_TESTING.md). Do not reset those results.

Use a disposable test core/pool for accounting and permissions experiments.
Preserve SavedVariables. Never record pairing codes, tokens or database URLs here.
Record results as: test ID, date, tester/client version, PASS/FAIL/UNSUPPORTED,
expected versus actual behavior, and safe evidence. Mark a row passed only from
actual evidence. Optional disabled integrations can be recorded as not enabled.

## Current issue

Owner installed/downloaded from the internet but could not locate Guilded.lua.
Local companion detection found an existing file at:

`D:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\<your account>\SavedVariables\Guilded.lua`

The owner's exact account-folder path was provided privately in the testing chat;
the reusable checklist uses a placeholder rather than publishing that identifier.

The owner subsequently reported successful SavedVariables folder selection and
two successful syncs at 16:06 and 16:07 on 5 October. The missing-file issue is
resolved. Correct Discord character/pool, return standings and duplicate-ledger
behavior still need verification; successful sync messages alone do not prove them.
WoW creates/saves the file after Guilded is enabled, a character is logged in,
and the UI is reloaded or the player logs out. Installing the companion alone
does not create addon SavedVariables. The _classic_beta_ folder is WoW's name,
not Guilded's release classification.

## 1. Connection and installation

- [ ] C01 Pair a test member at https://guilded-wow.kcaron.workers.dev/companion/.
- [ ] C02 Upload Guilded.lua; confirm character/pool in Discord; return Standings.lua; reload and compare totals.
- [x] C03 Repeat the upload: no duplicate attendance, loot or points. Owner confirmed unchanged EP/GP and no duplicate history entries after two syncs on 5 October.
- [ ] C04 Browser reopen, renewed folder permission, replaced saved file, and manual upload/download fallback.
  Browser reopen subtest passed on 5 October: owner reports connection and both
  folders remembered after closing/reopening; 17:04 upload and standings save succeeded.
  Permission renewal, replaced-file recovery and manual fallback remain unverified.
- [ ] C05 Second-PC clean install/upgrade, pairing, tray, autostart and restart.
- [ ] C06 Temporary internet loss with queued work; reconnect delivers each entry once.
- [ ] C07 Revoke and re-pair a disposable account; finish queued uploads before switching.
- [ ] C08 Repair/uninstall preserves WoW SavedVariables; companion settings/autostart clear on uninstall.

## 2. Loot and accounting

- [ ] L01 Every loot mode used by the guild starts the correct flow.
- [ ] L02 Two competing priority players: correct PR winner and GP charge.
- [ ] L03 Main/off-spec competition, minimum EP and missing-price handling.
- [ ] L04 Council responses, two officer voters, timer completion and one award.
- [ ] L05 Two reservers plus third-player whisper, lock, roll, award, tooltip and SR+ if used.
- [ ] L06 Outsider bids/council answers refused.
- [ ] L07 Reload during bidding/council preserves responses, timer and award.
- [ ] L08 Consecutive awards and simultaneous officer uploads/retries create each transaction once.
- [ ] L09 Correct pool and raid association for every transaction.
- [ ] L10 GP deduction works and clamps at zero.
- [ ] L11 Real boss loot detection, holder and trade reminder/timer where supported.

## 3. Roles, characters and cores

- [ ] P01 Ordinary members cannot manage officer actions but can apply.
- [ ] P02 Demoting a test officer removes management access immediately.
- [ ] P03 Revoking a test pairing stops protected access.
- [ ] P04 Real cross-guild isolation with accounts from two configured guilds.
- [ ] P05 Alt characters link to the correct Discord account.
- [ ] P06 Two cores per member, different characters and role-specific backups; roster editing follows.
- [ ] P07 Roster/signup visibility and private core chat/voice access, including role add/remove.
- [ ] P08 Test-core rename updates Discord channels and in-game selection.
- [ ] P09 Empty disposable core creation/deletion, permission-failure reporting and safe retry.

## 4. Raids, groups and readiness

- [ ] R01 Apply with role, trial, approval and separate rejection.
- [ ] R02 Signup caps, bench/waitlist, open spots and overlapping-raid warning.
- [ ] R03 In-game roster/invites choose signed-up character or appropriate backup.
- [ ] R04 Ready page officer/leader/assistant access, member restriction, refresh and chat post.
- [ ] R05 No-addon player shows available buff information and missing addon data clearly.
- [ ] R06 Dungeon clients agree on recorder; unauthorized member cannot finish everyone's run.
- [ ] R07 Completed dungeon upload, Scores page and player tooltip agree.
- [ ] R08 Group finder role requirements, full-group waitlist, voice limit and targeted alerts.
- [ ] R09 Calendar sync and Create next raid without duplicates, only on supported clients.
- [ ] R10 Complete real raid night; reconcile attendance, loot, EP/GP, uploads, standings and reports.
- [ ] R11 Larger-group paced messages deliver all awards and complete reserve lists.
- [ ] R12 Pug attendance does not falsely add the pug to the guild roster.

## 5. Addon usability and recovery

- [ ] A01 Available professions, collapsed groups, material filters and transmute cooldowns.
- [ ] A02 Profession-link recipes remain attributed to the original player.
- [ ] A03 Map privacy in instances/combat, sharing toggle and rotating minimap.
- [ ] A04 Item/comparison tooltips show correct selected-pool information.
- [ ] A05 French labels, officer sidebar, keybinding, options, minimap/compartment and module switches.
- [ ] A06 Export/reload outside combat without blocked actions; combat use fails gracefully.
- [ ] A07 Backup, restore preview, restoration and undo on disposable test data.
- [ ] A08 Standalone local features without Discord/companion; officer-published standings reach a member.
- [ ] A09 Deathroll duel/rules and Guilded chat-tab routing.

## 6. Discord and fresh-guild setup

- [ ] D01 Fresh independent guild, preferably Alliance: owner guide, bot hierarchy, wizard, first member/pairing/round trip; record unclear steps and time taken.
- [ ] D02 Rules acceptance, game-role selection/removal, welcome buttons, DM delivery and one onboarding reminder.
- [ ] D03 Update setup panels repairs outdated messages without duplicates; existing-channel selection works.
- [ ] D04 Officer join/leave logs correctly track guild-role membership.
- [ ] D05 Weekly report and automatic decay run once at the intended time.
- [ ] D06 Enabled Community/PoE workflows and English/French messages, including permission-failure recovery.
- [ ] D07 Warcraft Logs automatic raid association if configured.
- [ ] D08 FAQ/AI answer channel if enabled; keep disabled integrations disabled.

## Missing or deferred work, separate from testing

- Clear standalone first-run choice: In-game only versus optional Discord; accurate data-source/freshness labels and bot-related messages. Roadmap steps 0, 1 and 4 remain open.
- Decentralized multi-officer ledger synchronization without the bot is not implemented; current standalone sharing is an officer-authority snapshot.
- Markers, tank marking and boss plans were deliberately archived for a future separate raid-leader addon, outside Guilded v6.
- Windows installer code signing remains unavailable; current installer is unsigned.
- Managed one-click guild hosting is not provided; owners supply their bot/database hosting.
- Raid templates, faster attendance correction, clearer close-out summary, and easier archive/transfer are roadmap proposals, not committed 6.1 scope.

See [STANDALONE_ADDON_ROADMAP.md](STANDALONE_ADDON_ROADMAP.md) and
[the raid-tools archive](archive/raid-tools/README.md).

## Results log

| Date | Test ID | Tester / client | Result | Expected versus actual / evidence |
| --- | --- | --- | --- | --- |
| 2026-10-05 | C02 preparation | Owner PC / local file detection | In progress | Guilded.lua found at the path above; file selection and round-trip remain unverified. |
| 2026-10-05 | C02 upload portion | Owner PC / online companion | PASS (partial) | Owner supplied activity: 16:06 SavedVariables folder selected; 16:06 and 16:07 Synced — Your saved data is synced. File discovery/selection and upload work. Discord character/pool and returned standings remain unverified. |
| 2026-10-05 | C03 | Owner PC / repeated sync | In progress | Two syncs completed successfully, but duplicate prevention requires checking ledger/history for unchanged totals and no duplicate entries. |
| 2026-10-05 | C02 return portion | Owner / WoW screenshot | In progress | Standings page loads a Discord snapshot dated 2026-10-03T21:31:41.485Z. Snapshot lists Ray, Seria and Duude; Highpriest is shown as unlinked. Fresh October 5 standings return and current backend character linkage remain unverified. Next: /character list (claim Highpriest if absent), save fresh standings to the active Interface/AddOns/Guilded folder and /reload. |
| 2026-10-05 | C02 linkage and stale return | Owner / Discord list and second WoW screenshot | In progress | Discord lists Ray, Duude and Highpriest (last seen 14 minutes ago), confirming linkage reported by owner. Highpriest is outside the in-game guild. WoW still shows October 3 standings. Local active-install candidate Standings.lua inspected: empty packaged template, last modified October 5 at 06:44; fresh standings have not been written there. Do not claim return-sync passed or ask owner to re-claim an already linked character. |
| 2026-10-05 | C02 fresh return | Owner / WoW screenshot | PASS (partial) | Fresh Discord snapshot 2026-10-05T20:25:10.149Z displays Highpriest with EP 0, GP 0, PR 0.00, alongside Ray, Seria and Duude. Linkage and fresh return/loading confirmed; correct selected pool and numerical reconciliation with Discord still need explicit confirmation. |
| 2026-10-05 | C03 repeated upload | Owner / companion and Discord check | PASS | Two successful syncs at 16:37. Owner explicitly confirmed EP/GP stayed unchanged and no duplicate ledger/history entries appeared for the same pool. |
| 2026-10-05 | C04 reopen portion | Owner / online companion | PASS (partial) | After closing/reopening the browser, owner reports connection and folders remembered. At 17:04 Activity confirms Your saved data is synced and Standings saved in your Guilded addon folder. Use /reload in WoW. New persistence and combined sync accepted for this browser; other C04 recovery cases remain pending. |
| 2026-10-05 | C04 browser reopen | Owner / online companion | In progress | Reopening showed Setup needed. Current browser credentials/preferences use sessionStorage, so closing the tab can require personal pairing again; folder handles persist separately in IndexedDB. This is expected session behavior, not evidence of lost folder handles. Reconnect, then verify remembered input/output folders. Earlier test instructions omitted the session distinction. |

Folder usability change published after this result: browser Sync now also
saves returned standings once an addon output folder is configured and its write
permission remains granted. Initial selection remains explicit; automatic sync
does not open folder/permission dialogs. Published from source 3cb4772 on 5 October.

Further owner feedback: both folders appear lost after reopening, and repeated
Discord pairing is unwanted. Connection persistence changed to device
storage with existing-tab migration and session fallback warnings; Disconnect
revokes and clears both stores. Folder restoration now preserves either valid
handle independently and warns on storage failure instead of silently claiming
memory. Real browser reopen verification remains pending, including which browser
is affected. Do not mark C04 passed from these code changes.

Publication receipt: source 3cb4772deeb4eba806c0d0636f7399b32ec00969;
Cloudflare build succeeded and PostgreSQL/quality CI passed:
https://github.com/kevincaron28/Guilded/actions/runs/37371943672.
Windows packaging was still queued at browser publication; no installer was
republished. Oracle received only index.html, app.js and web-bundle.js; its bot
service remained active with NRestarts=0. Rollback web archive is
`/home/ubuntu/guilded-recovery/companion-web-3cb4772/previous-web.tar.gz`.
All three public assets returned HTTP 200, Cache-Control no-store and matched
the tested build hashes (accounting for Cloudflare's website navigation insertion
in HTML). Health confirmed 6.0.0 / protocol 2. Local 153 files / 1,237 tests,
TypeScript, ESLint and addon validation passed.

Next owner action: refresh the currently open tab to migrate its existing
connection before closing it. Verify both folder choices, then close/reopen.
If folder storage is blocked, record the new warning and browser name. Pair once
if the prior session is already lost; future reopen should retain it when device
storage is available. Current browser behavior remains a real-client retest.

## Suggested order over the next weeks

Officer-assisted member onboarding is prepared on the next-update branch.
Follow [the officer bridge test](OFFICER_COMPANION_BRIDGE.md) for the private
two-PC patch. Its real-client acceptance remains pending; the public 6.0
release has not been replaced by this development patch.

1. Connection/install tests, then two-player loot/accounting.
2. Roles/cores, group workflows, addon recovery and French UI.
3. Fresh-guild onboarding, scheduled/optional workflows and full real raid reconciliation.

Follow-ups should continue this tracker, retain evidence and prioritize reported
failures. Never infer a pass from an elapsed week or a successful automated test.
