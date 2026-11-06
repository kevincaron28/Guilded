# 8.5.0 release acceptance (in progress)

Candidate branch `release/8.5-candidate`, built from `main` (8.4.7) plus PRs #385, #387, #389, #390,
#391, #392, #393, #394 and #395. Track K is not in yet. The local test build still says 8.4.7
because the version bump happens once, at release.

## Single-client test on the owner's PC, 6 November 2026 (WoW Forever 1.60.1, Lebowski Holyroller)

Install: the candidate Forever build was copied into `_forever_\Interface\AddOns\Guilded`. The old
8.4.6 folder is backed up in `backups/addon-before-8.5/`. WoW was restarted through Battle.net Play.

| Item | Result | Evidence |
| --- | --- | --- |
| Addon loads | **Found a bug, fixed on the candidate.** Lua warning at login: "Binding header GUILDED was attempted to be loaded more than once" (`Bindings.xml`): the new call-for-help binding repeated `header="GUILDED"`. Track J asked to fix #395. | Zoomed warning |
| E2 minimap tooltip | Pass: lists left, right, shift, ctrl, alt, middle and drag, plus "Changes waiting to be saved (/reload)". | Zoomed tooltip |
| E2 right-click quick menu | Pass: Raid signups, Loot and standings, Dungeons, Crafting search, Guild map, Call for help, Settings. | Zoomed menu |
| E2 left-click | **Minor bug:** the first left-click after closing the quick menu with Escape does nothing; the second opens the window. Sent to Track E. | Two screenshots |
| E4 companion link in game | Pass: Home shows "Get the Windows companion (select a link, Ctrl+C)" with the site and stable GitHub links. | Screenshot |
| J call for help (sending) | Pass, with two UX findings. A bare `/guilded sos` sent a real call: "[Guilded] Help! Lebowski is under attack in Tirisfal Glades" reached guild chat, and guildmates answered within a minute. The banner "Help called. Waiting for answers." with **All clear** worked. Findings sent to Track J: a bare command should confirm first, and All clear should also post a guild line. A manual "test, all clear" line was posted to the guild. | Zoomed chat |
| J Defender banner (receiving) | Not run: needs a second client in the same zone (two-PC window). | — |
| E1 online/offline lines | Not seen yet: no guildmate logged in or out during the run. | — |
| E3 last seen in the Crafted by tooltip | Not run: needs an item that a guild crafter makes. | — |

### Retest after the fixes (candidate `75aa9b2b`, adds #396 C4/C5 and #397 Track K)

| Item | Result |
| --- | --- |
| Addon loads | Pass: no Lua warning after the `Bindings.xml` fix. |
| J bare `/gsos` | Pass: shows "Call for help now?" Yes/No. **No** sends nothing to guild chat. |
| E2 left-click after Escape | Pass: the first click opens the window. |

### Learned for the test plan
- `/chatlog` does not record addon output, so Guilded's lines are checked with zoomed screenshots.
- WoW Forever's `/quit` returns to the login screen. Restart through Battle.net **Play** instead.
- Bringing WoW forward with the desktop tool's "open application" **starts a new WoW copy**. Bring the
  existing window forward through its window handle instead.
- WoW asks "Allow custom scripts?" for `/run`. That is a game security setting, so it was declined.
  The tests use the real buttons instead.

## Second PC, fresh install of the published 8.4.7 companion (6 November 2026, tester session)

| Item | Result |
| --- | --- |
| Download via the stable `releases/latest` link | Pass: 123 MB in 11.7 s; the SHA-256 matches the v8.4.7 asset. Not code-signed (Authenticode: NotSigned). |
| SmartScreen | Not observed: the tester launched from a shell. Expect a warning on a real double-click. |
| Install | One click, about 10 s, into `%LOCALAPPDATA%\Programs\guilded-companion`. |
| Launch after install | **Bug:** "cannot find …Guilded Companion.lnk". The launch runs before the shortcut exists, so the app doesn't open. Sent to Track F. |
| Uninstall registry entry | **Bug:** empty InstallLocation. Sent to Track F. |
| Leftover | `%LOCALAPPDATA%\guilded-companion-updater\installer.exe` (123 MB) stays behind. Sent to Track F. |
| Addon present | That PC had no addon at all, and the companion doesn't install it. This is the member-journey gap (audit item 7); the F1 "addon missing" check must catch it. |
| Manual addon install (member path) | Done: the v8.4.7 Forever zip (hash matches) has one `Guilded` folder; 70 files copied. About 6 steps and 1-2 minutes if you know the folder; finding `_forever_\Interface\AddOns` is the stumbling point. Companion "Install addon" button sent to Track F. |
| Restart through Battle.net | Pass: goes straight to the character screen (Blunt Cruising), no login. |
| Discord sign-in and link | Waiting for the owner (12:00). |

## Preview deploy to the live bot (6 November 2026, 14:20-14:27 UTC)

- Owner approved ("Allow you to deploy"; "Test server only").
- Preflight: ledger check passed, backup verified (`/home/ubuntu/guilded-recovery/2026-11-06T14-20-36-756Z`, database 653 KB). An encrypted copy is on the owner's PC with a separately stored key.
- `FEATURE_PREVIEW_GUILD_IDS=1563959517337747556` (Kevmister28's server) was added to `/opt/guilded/.env.local` **before** the code changed. The original is kept as `.env.local.before-8.5-preview`.
- PR #398 merged to `main` as `08dc53f`, pinned to the tested candidate `1555b5a` (CI green). `deploy/update.sh` ran: four migrations applied (race board and PvP channels, roster gaps and nicknames, promotion panel, guildmate relay). The bot is back as version 8.4.7 (no bump, so no update notice) and Discord accepted the commands in every server.
- Startup log: setup complete for High Guard, Québec Gold and Kevmister28's server. No new errors; the `[diagnostic:…]` warnings after startup are the same as on earlier restarts.
- Rollback: `/opt/guilded.previous.A5ACpyhx`, plus the recovery directory above.

## Discord checks on the test server (preview bot, main-PC tester, 6 November 2026)

| Item | Result |
| --- | --- |
| `/setup start` wizard | Runs through all 7 steps; one stray "This interaction failed" at step 5 |
| PvP category, race-to-60 channel | **FAIL (bug):** not created when the server has no member role; `battleground-setup.ts:125` refuses. Sent to Track B (fallback to @everyone). |
| Member role picker (step 6) | **FAIL (bug):** "This interaction failed", the choice is not saved. Sent to Track B. |
| Duel and battleground ladders, Who's who, nickname format | Not tested: blocked by the bugs above, and the test server has no linked characters yet |
| `/character nickname on:false` | Pass |
| `/officer roster gaps` | Partial: lists members with no linked character and offers "Ask them to link"; no `/ginvite` lines without roster data |
| `/character achievements` | Pass: 0/89, Forever 0/9 and guild 0/80 counters |
| `/officer promotion list` | Pass: three empty lists |
| Roster card | Pass: the command is `/report guild`; the docs said `/guild-health` |

## Still to do
- Full test suite on the merged candidate (running).
- Track K merge, then the two-PC window ([test plan](V8_5_0_GAME_TEST_PLAN.md)).
- Discord checks: boards, nickname sync, roster gaps, achievements, after a bot deploy of the candidate.
