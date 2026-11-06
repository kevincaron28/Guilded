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
| Discord sign-in and link | Done 10:15-10:32 (owner signed in): about 6-8 min for a member with at least 4 points where they could give up. The browser opened behind the windows; "Tout est relié" was shown with 0 characters (not in a Guilded server yet); the WoW folder on `D:\Jeux` was not found and Search gave no feedback; "Relier" expired after about 5 min with no warning. Smaller items: a second click on the web page, English text in the French UI, a stale "finish in your browser" box, and the website saying "never synced". All sent to Track F. Good: after joining Québec Gold's Discord the second sign-in needed no login, and the link DM arrived. The "bot unreachable" at 10:32 was our deploy restart. |

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

## Preview deploy 2: Québec Gold added (6 November 2026, about 15:15-15:35 UTC)

- Owner asked "please update quebec gold server" and accepted editing the permanent Hall of Fame posts later.
- Backup verified: `/home/ubuntu/guilded-recovery/2026-11-06T15-15-02-370Z`, with an encrypted copy on the PC.
- Preview list is now `1563959517337747556,1323321076478119967` (test server + Québec Gold).
- **Incident:** the first merge request failed (an accented character in the JSON title), so the update script restarted the old preview code `08dc53f` with Québec Gold already on the list, for a few minutes. The log shows three `error:7f90f8ace781` lines in that window; the cause is unknown.
- Fixed: #406 merged as `51d450b` (tested candidate `8245f5c`: #400, #401, #402, #403, #404, #405) and redeployed. Migrations applied: artisans gallery, guild stat snapshots, forever full names. No errors since.
- **Owner action:** the Forever-name backfill dry run (`npm run names:forever` on the server) was blocked for the agent as a production read. See the steps in `docs/FOREVER_NAMES.md`.

## Discord retest and Québec Gold setup (bot 230b8d8, main-PC tester)

| Server | Item | Result |
| --- | --- | --- |
| Test server | Member-role picker, Create missing channels, PvP category, separate duel and BG ladders | Pass |
| Québec Gold | `/setup` checklist → Create missing channels only | Adopted the existing PvP channels and created `course-au-60`, which is **public** (no member role set; "restrict it later") |
| Québec Gold | Race board | Pass with real data (17 characters, levels, professions, last seen, mentions). **Shows first names only**, sent to Track B |
| Québec Gold | Duel and BG ladders | Pass, two separate messages |
| Québec Gold | `/officer roster gaps` | Pass: 258 members with no linked character, 8 in-guild characters nobody claimed |
| Québec Gold | `/report guild` card | Pass; the ⚜ glyph draws as boxes (sent to Track C) |
| Québec Gold | Who's who, nicknames, Hall of Fame, `/ginvite` lines | Not checked yet (nickname sync is hourly; no level 60 yet) |

## Live regression and hotfixes (6 November 2026)

- **Found by the second-PC tester:** with Québec Gold in the preview, the companion's standings refresh failed after every upload ("Could not reach the bot"), while uploads themselves worked.
- **Hotfix 1** (#409, bot `14bd458`): guildmate relay no longer re-flags unchanged professions, and the standings never throw after retries. The "Standings changed during refresh" log errors stopped (0 after deploy).
- **Hotfix 2** (#412, bot `230b8d8`): the refresh right after an upload still hit the companion's 20 s timeout (measured: the error came about 20 s after the upload). Rebuilds over 10 s now answer with the previous standings; Discord calls are capped at 4 s; each request is logged with its time. **Retest passed:** Synchroniser at 16:29:45Z, standings refreshed with no error, and the badge stayed green.
- Deploy restarts briefly showed "Could not reach the bot" / "Upload failed (502)" in companions; the auto-retry recovered within about 4 minutes.
- Still open (Track F): the support summary leaves out the companion version and error details.

## Still to do
- Full test suite on the merged candidate (running).
- Track K merge, then the two-PC window ([test plan](V8_5_0_GAME_TEST_PLAN.md)).
- Discord checks: boards, nickname sync, roster gaps, achievements, after a bot deploy of the candidate.
