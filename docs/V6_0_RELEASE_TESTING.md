# Guilded 6.0 release testing

Target: 6.0 public release. Current repository version: 5.0.0.
Release is not yet verified or published. Follow the deployment and backup gates in
[V5_0_RELEASE_HANDOFF.md](V5_0_RELEASE_HANDOFF.md); use
[RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md) for the full feature coverage.

## Confirmed test environment

- Owner's client: **WoW Forever beta** (confirmed 3 October 2026).
- Screenshot: character Ray; realm Classic Beta PvP; normalized realm ClassicBetaPvP.
- Addon reports saved data belongs to Quebec Gold-Classic Beta PvP.
- Owner confirms installed addon reports 5.0.0. Client build number is not yet captured.
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

The owner expects a second guildmate in about 15 minutes. While waiting, the
next solo check is window position/size persistence and sidebar access after reload.
Then test map sharing and loot with the second updated player.

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
Fresh CI and real first-time owner/member installation remain required.

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
