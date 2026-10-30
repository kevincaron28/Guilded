# Live Discord acceptance — 30 October 2026

Tester: Claude, driving the owner's signed-in Discord web session in Quebec Gold
(`#general-admin`, `#inscriptions-raid`). Live bot reported itself as 8.1.0.
Only clearly marked test data was used (`/setup testraid`). No real balances, no
mentions, no permission or role changes. Private receipts stay in `backups/`
(not committed). Results are PASS only where the live reply was observed.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `/report ping` | PASS | Ephemeral "Guilded Bot is online." |
| `/help` (French, owner account) | PASS | Private; officer sections shown; footer "Guilded 8.1.0". Does not prove ordinary-member visibility. |
| `/setup system status` | PASS (see warnings) | Bilingual report: 5 active pairings, last upload 6 days ago APPLIED, 0 awaiting approval, auto-apply on. |
| `/setup testraid start` | PASS | 10 fake raiders: 7 signed up, 2 maybe, 1 waitlisted. Public post in `#inscriptions-raid`, labelled `[TEST]`. |
| Signup button into a full role (DPS) | PASS | Private "DPS est complet… liste d'attente"; roster showed the waitlist entry. |
| Peut-être button | PASS | Moved the character from the waitlist to Peut-être; waitlist count fell. |
| Absent button | PASS | Private "C'est noté, vous ne venez pas."; listed under Absents. |
| `/lead edit` DPS cap 3→4 promotes waitlist | PASS | "Moved 1 player(s) off the waitlist."; post updated (Testjuliet now Mêlée, 8/9). |
| `/setup testraid cleanup` | PASS | "Removed 1 test raid(s), 10 fake raider(s) with their EPGP, points and loot… Real data was not touched." |
| `/setup testraid finish` | NOT COMPLETED | Refused: "Loot and EP/GP are per core. Choose a core or a core raid". The helper cannot finish a raid that has no core; nothing was awarded. |

## Findings to triage (none fixed here)

1. **Leader commands hidden from officer roles.** `/setup system status` lists
   `/lead` hidden from Maître de guilde, Officier and Chef de raid, and
   `/officer`/`/organize` hidden from Maître de guilde and Officier. The owner's
   account sees them (Administrator). Needs the owner to allow the roles under
   Server Settings → Integrations → Guilded (or give Chef de raid Manage Events).
   Not changed by the tester. Launch-day risk for real officers.
2. **Permission warning: Administrator-effective vs explicit bits.** The report
   shows "Administrator: enabled" and "Missing: CreateEvents". This is an
   explicit-bit gap hidden by Administrator; it must not be "fixed" by widening
   permissions to produce a pass. Decision belongs to the owner.
3. **Delivery line "MESSAGE: 0 attempt(s), queued · retry in 5 days".** Zero
   attempts suggests a future scheduled delivery rather than a failed retry, but
   this was not confirmed (the underlying record was not inspected). Treat as
   UNVERIFIED; check the delivery row before launch.
4. **`/setup testraid finish` on a core-less test raid** returns the per-core
   refusal. Either the helper should create/attach a test core or `/help`
   should not advertise it as a complete rehearsal. Regression candidate after
   the multi-core change.
5. **Autocomplete:** `/lead edit raid:` first showed "Loading options failed";
   typing the raid ID then returned the raid. Likely a Discord 3 s first-load
   timeout; not reproduced further. Re-check after deployment.
6. **Language:** the `/lead edit` reply was English ("Updated raid…") while the
   guild and signup replies were French. Minor; confirm whether this follows the
   invoking user's locale.
7. **Cleanup note:** cleanup does not delete the public signup post; it must be
   removed by hand. Removal was attempted at the end of this session, and the
   browser stopped responding mid-attempt. **Verify that the stale `[TEST]` post
   is gone from `#inscriptions-raid`; delete it if not.**
8. Earlier in the session one `/setup system status` attempt posted as plain
   text because the command picker had not registered. The tester deleted it.

## In-game: WoW Retail on the owner's PC (30 October, ~05:40–05:50 Toronto)

Baseline evidence for the **installed 8.0.2** addons only; it is not acceptance of
the 8.1.0 candidate, and Retail is **not** Forever acceptance.

- Client: Retail 12.1.5 (70575) Release x64, built 22 Oct 2026, windowed.
- Character: Lebbowski, level 80, realm Zul'jin, Officer rank in Guilded; zone Hammerfall, open world, no group.
- Addons (TOC): Guilded 8.0.2 and GuildedDungeons 8.0.2, Interface 120105. `/guilded version` printed "Guilded version 8.0.2."
- SavedVariables preserved before any action in `backups/live-acceptance-2026-10-30/retail-savedvariables-before/`
  (private; SHA-256 recorded in the receipt there). Account 77911595#2: Guilded.lua 5015 bytes, GuildedDungeons.lua 115, Lebbowski Guilded.lua 55 (all dated 28 Oct before the session).

| Check | Result | Notes |
| --- | --- | --- |
| Load, `/guilded`, `/guilded version` | PASS | "[Guilded] Loaded." No Lua error popup. |
| Main window navigation: Home, Settings, Guilded setup, Dungeons (Run/Season) | PASS with defect | Pages render and respond. |
| `/reload` | PASS | Completed in ~40 s (crowded phase), "[Guilded] Loaded." again; window reopened on the last page. |
| Local save timestamps | PASS | After reload: Guilded.lua 5373 bytes 05:45:12, GuildedDungeons.lua 102 bytes 05:45:13, Lebbowski Guilded.lua 55 bytes 05:45:13. Files are rewritten on reload (originals backed up first). |
| Dungeons season page | PASS (empty state) | "No season snapshot yet. Season scores arrive through your companion or a guild officer." Lists classic dungeon names (Blackfathom Deeps … Maraudon) on a Retail client; confirm that is intended. |
| Standings returned from the companion | NOT VERIFIED | No snapshot in the client; companion window is masked in screenshots and its profile is encrypted, so acknowledgement was not read. |
| Companion actual acknowledgement | NOT RUN | Needs a visible companion window or an owner-supplied status screenshot. |
| EN/FR switch in game | PASS with polish gaps | `/guilded lang fr` printed "Langue : français. /reload pour mettre la fenêtre à jour."; after `/reload` Home, Options and Dungeons render in French (see polish list). Restored with `/guilded lang auto` + `/reload`. |
| Built-in Test dungeon run (disposable) | PASS | Options → Donjon de test: chat "Test dungeon run saved (20:00, you + Testalpha, Testbravo, Testcharlie, Testdelta)"; Dungeons page lists "Test Dungeon - 20:00 - COMPLETED"; result card "Non coté 20:00 … L'envoi et la publication ne sont pas confirmés ici." |
| `/guilded sim clear` | PASS | "Removed 0 test raid(s), 0 EP/GP entries and 1 test dungeon run(s)."; Recent runs empty. Done **before** any reload so the companion could not pick up the test run. |
| Full Guilded and standalone Dungeons together | PARTIAL | Both installed and loaded together (main window plus Dungeons window, and the Dungeons button in the Group Finder frame). Standalone-only run not done (would require disabling an addon and reloading). |
| Real dungeon run, abandon/reset, two-player sync | NOT RUN | Character is in open world with no group; no second client. |
| Import/undo/backup restore on disposable copy | NOT RUN | Not attempted; no disposable setup prepared. |

Defect found in game:

- **"Guilded setup" dialog is see-through** on this Retail build: the Settings page's
  buttons and text show through the dialog, so its text is hard to read
  (Settings → Guilded setup; reproduced twice). Not yet checked on the 8.1.0 candidate.

### Companion observed (06:05, read-only; nothing clicked that changes state)

- Two companion windows are open at once: one on **8.0.2** (Overview, Store-style install) and
  one on **8.1.0** (standalone, `%LOCALAPPDATA%\Programs\guilded-companion`).
  Two companions on the same machine could watch the same SavedVariables and upload twice;
  confirm only one is allowed to track.
- 8.1.0 standalone Overview: **Tracking paused**; Account connection "Account linked";
  Selected game files "1 selected source" (`D:\Program Files (x86)\World of Warcraft\_retail_\WTF\Account\77911595#2\SavedVariables`);
  last upload "not yet"; "file changed 1 day ago" (stale even though the game saved at 05:45–06:00);
  Guild standings "Not refreshed yet"; World of Warcraft card "Not configured / Awaiting your first sync".
- Result: companion acknowledgement and returned standings stay **NOT RUN**. Resuming tracking would upload
  real Retail data, so it was left paused for the owner to decide.

### Companion 8.1.0 standalone: Resume tracking (06:10, owner-authorised)

After the owner restarted the standalone 8.1.0 companion (pointing at the Retail SavedVariables
folder, connected to the guild's Discord server 1323321076478119967), Resume tracking was clicked.
Result: **"Upload failed (409): This guild uses forever; select a saved file from that WoW edition."**
Overview then showed "Your sync needs attention", Guild standings "Not refreshed yet", World of Warcraft card
"Needs attention / Awaiting your first sync", Activity badge 3.

- PASS (guardrail): the bot refused a Retail file for a Forever guild; no Retail data was ingested.
- NOT RUN: acknowledgement and returned standings. They need a Forever client/profile for this guild.
  Retail cannot satisfy them and must not be counted as Forever acceptance.
- Polish: the failure shows only on Overview and the activity feed, while the header chip briefly said "Connected"
  just before; add an edition hint ("choose your Forever saved file") with a one-click Browse on the Overview card.
  Raid prices page showed only a title and a disabled Refresh right after resume (empty state without text).
- Tracking was **paused again at 06:12** (owner-authorised) to stop 409 retries; the button now reads "Resume tracking". The Retail source is still selected; point it at a Forever file before resuming. Activity feed shows 5 entries from the failed attempts.

### Kevmister28's server (throwaway, "Ks" icon, guild 1563959517337747556) — 30 Oct

Bot "Guilded" added there 26 Oct. Server already has Guilded channels (guilded-guide, bot-faq, craft-board,
officer/raid channels, TEST Core), so this is a re-run of an existing setup, not a fresh install.

- `/setup system status` PASS. 0 pairings, "Last upload: none", auto-apply off, last delivery 14 hours ago, "No pending deliveries".
  Permissions: **Administrator off**, "Missing: KickMembers, BanMembers, ModerateMembers". This is the true explicit-bit view
  (no Administrator masking) and is the model for the permission warning in Quebec Gold, where Administrator masks the gap
  (Missing: CreateEvents). Do not widen permissions to hide either warning.
- "Leader commands hidden" appears here too (Guild Master → /lead /officer /organize, Officer → /lead /officer /organize,
  Raid Leader → /lead): this is the default state until a server owner allows the roles in Server Settings → Integrations → Guilded.
  Integrations page reached (Guilded, "Added on Oct 26, 2026 by kevmister28", Bot + Commands, Manage). Applying and verifying the
  role override was **not completed**: a second attempt froze the Chrome renderer again on opening Integrations
  (CDP screenshot timeout), so it looks reproducible in this automated tab. Owner can do it by hand
  (Server Settings → Integrations → Guilded → Manage → Commands); NOT RUN.
  **Update, later 30 Oct:** completed in a fresh Chrome tab by driving the DOM with element refs (screenshots still
  time out on this page). Ks server only: `/lead` → Guild Master, Officer, Raid Leader; `/officer` and `/organize` → Guild Master,
  Officer, each set to Allow and saved. Reopening `/lead` and `/officer` showed the saved overrides. PASS for "the override
  can be applied and persists". NOT verified: that those roles now actually see the commands in the slash picker
  (needs a member holding the role / View as role), and Quebec Gold is unchanged. Side effect: one mistimed click
  joined the Ks "General" voice channel; disconnected immediately.
- Throwaway-server checks that still need a second account: member command visibility, signup as a plain member,
  `/guilded verify`, multi-character picker. The assistant cannot create the account; **owner must provide it**.

### Candidate PR #283 (`codex/oct30-release-integration` at `ea8f92b`) — test matrix, nothing run yet

Source only: not deployed (live bot is 8.1.0 at 6bdc80e; `/me/*` returns 404 unauthenticated on bot.kcaron.top and
guilded.kcaron.top, which does not distinguish "not deployed" from "login required") and not installed in game (Retail still 8.0.2).
Results above are **baseline 8.0.2 evidence only**. Each row below is NOT RUN until Codex gives the build checkpoint.

| Area | Needs | Status |
| --- | --- | --- |
| Simulation pool / finish / cleanup with no real-member awards | deployed bot | NOT RUN |
| Poll expiry closes and refreshes the Discord post | deployed bot + a test poll | NOT RUN |
| Private `/me/calendar` (DST, cancellations, import into a calendar app) | deployed bot, signed-in session | NOT RUN |
| `/me/data` and `/me/handover` (officer-only access, empty/error states) | deployed bot; member and officer sessions | NOT RUN (member session needs second account) |
| Personal pairing and accepted-sync receipts | Forever file for this guild | NOT RUN |
| Retail test-card clearing, French layout, missing-season state | installed candidate addon | NOT RUN (baseline 8.0.2 gaps recorded above) |
| Full + standalone Dungeons coexistence, backup scope | installed candidate addon | NOT RUN |

### Polish list (bugs and UI fixes, none fixed here)

Discord / bot
1. Leader commands hidden from Maître de guilde, Officier, Chef de raid (see Findings 1).
2. `/lead edit` reply is English in a French guild (Finding 6).
3. `/setup testraid finish` refuses on a core-less raid (Finding 4); cleanup leaves the public `[TEST]` signup post (Finding 7).
4. First `/lead edit raid:` autocomplete failed to load once (Finding 5).

Addon (Retail 12.1.5, 8.0.2)
5. "Guilded setup" dialog is transparent; Settings controls show through (EN, reproduced twice).
6. French gaps: "Partly ready : 1 chose(s) à corriger" on Home; "Guild: off" buttons in Options modules; "Backup and restore - activé"; the whole Dungeons window buttons (Run, Season, Close, Start now, Complete, Abandon, Last result), the "COMPLETED" status and "Page 1 / 3", "Previous/Next" and "Guild rankings / Newer season / Older season" on Season.
7. Chat messages from test tools stay English in French mode ("Test dungeon run saved…", "Removed 0 test raid(s)…").
8. "DONJON TERMINE" lacks the accent (TERMINÉ) on the result card.
9. "Enregistrer mes données" overflows its button on the left menu in French.
10. Test dungeon run's chat message says "/reload so the companion sends it; an officer runs /import apply", but the Options label says test tools are "faux joueurs, rien ne va sur Discord". Make the test-data promise consistent, or block upload of test runs.
11. After `/guilded sim clear`, the "Test Dungeon … Non coté 20:00" result card stays on screen; dismiss it when the run is cleared.
12. Dungeons window opens over the Group Finder frame and the two overlap; the window also opens on top of the previous page state after reload (fine) but leaves the Group Finder open.
13. Season page lists classic dungeons (Blackfathom Deeps … Maraudon) on a Retail client; confirm intended.
14. `/guilded lang` needs a `/reload` before the open window updates; consider refreshing open windows automatically.
16. Companion "file changed 1 day ago" is stale after the game saved minutes earlier, and two companion versions run side by side (see above).
17. Discord: the stale `[TEST] Simulated raid` post (buttons dead after cleanup) is still in `#inscriptions-raid`. The tester could not delete it (browser tab froze, and a right-click once opened the menu on a real pinned guide post instead; nothing was deleted). Owner: delete it by hand.
15. Reload took ~40–60 s in this crowded zone; note for launch-day reports (client load, not necessarily the addon).

Environment notes: repeated `open_application "Wow"` from the tester launched extra Wow.exe instances (three extra processes at 05:55–05:58); only PID 25472 is the logged-in client. Close the extras manually. A second computer-use agent's overlay repeatedly took the foreground and blocked
input until WoW was set to windowed mode; avoid running two desktop agents at once.
The character showed "Away: AFK" from idleness.

## NOT RUN (prerequisites)

- Ordinary-member permissions and command visibility: needs a non-officer account.
- Fresh-guild onboarding: needs a throwaway server.
- Multi-character picker: owner has one linked character; needs an account with two.
- Role switching between confirmed roles with free capacity (all but DPS were full).
- Core preset command/modal and Components V2 interaction walkthrough.
- Raid closure with awards (`/lead end`, `/setup testraid finish`): needs a test core.
- Link unfurling of public score pages (OpenGraph).
- Simpler-linking flows (#278–#281): wait for deployment, then run on the live bot.
- All in-game and two-PC checks: require real client evidence.

## Post-deployment regression cases

After the next bot deployment, repeat: ping, `/help` footer version, system status
(pairings, delivery line, permission list), test raid start → button signup/maybe/
absent → `/lead edit` promotion → cleanup, plus the new linking commands
(`/character pair`, `/guilded verify`, auto server selection).

## 8.3 UI/Companion QA pass (30 Oct, about 09:30-10:05 Toronto) — Claude

Direct owner authorization received mid-pass (all available tests allowed). Codex owns fixes; items below are for the PC-owned fix/retest list.

### Versions actually under test
| Item | Actual |
| --- | --- |
| Retail addons | Guilded + GuildedDungeons **8.2.0** (`.toc` and in-game `/guilded version` = 8.2.0), client 12.1.5, Lebbowski/Zul'jin. **The 8.3 addon was not tested.** |
| Native Companion candidate | `dist\companion\win-unpacked\Guilded Companion.exe`, ProductVersion **8.3.0.0**, SHA-256 `622015A6500A2DA72AF3A89E1C7DDFEC05E953CDB8C1741D9307B0F2D1CECED6`, 249,953,280 bytes, built 30 Oct 09:30. Run with `--user-data-dir` on an **isolated empty profile**; owner profiles untouched. |
| Installed standalone Companion | 8.1.0.0 (real profile, left running and unchanged) |
| Windows package registry | `Kcaron.GuildedCompanion` **8.2.0.0** is registered on this PC (see F-9) |
| Backend | `https://guilded.kcaron.top/health` = ok, botVersion **8.3.0**, protocol 2, commands ok (09:48). `bot.kcaron.top/health` 404 as expected for direct origin. Earlier 404s on `/me/*` predate this deployment. |
| Source | worktree HEAD `794c4e0`; handoff names `e6a0bd7` / `2602e67`. Not reconciled by me. |

### Results
| Check | Result |
| --- | --- |
| Retail load, `/guilded` main window, Home/My character/Open raids/Ready/Raid/Loot/Settings pages (EN) | PASS, no Lua error seen |
| `/guilded sim clear` dismisses the test result card; Dungeons list shows "No saved dungeon result yet" (baseline 8.0.2 failed this) | PASS (EN, slash command) |
| Settings "Clear test data" button (FR "Effacer les tests") | PASS but needs two quick clicks; see F-5 |
| Translated simulation chat (FR "Donjon de test enregistré…") | PASS |
| French layout, save button ("Sauvegarder"), options page, module rows | PASS, no clipping seen at default size |
| Group Finder vs Guilded Dungeons window | PASS: both open side by side, edges touch, no overlap seen |
| Language restored to English + `/reload` | done |
| Candidate Companion 8.3.0 first run (EN): Home, Sync & setup, WoW page, Activity, Help & privacy | PASS: honest empty states ("Not connected", "Awaiting first refresh", "Not started: saved-data file is not set", "A connection is not a completed sync") |
| Companion 8.3.0 French: Home, Help & privacy | PASS, no truncation |
| Companion 8.3.0 narrow (560 px): menu collapses to "Menu", no horizontal overflow | PASS |
| Companion version truth | Sidebar shows "Version 8.3.0" |
| Discord `/bg panel`, buttons My groups, Upcoming (Ks server, ephemeral) | PASS: panel text matches design ("Private planning. No automatic posts, match capture or awards") |
| `/bg` Create: start without timezone offset | PASS, refused with a clear message |
| `/bg` Create: valid private session (Ks only, no public post) | PASS: session `cmvv1h6f6000m9ont11jra0fy` created, visible in Upcoming |
| `/bg` Join with an unlinked character | PASS: refused, tells user to `/character add` or `/character pair` |

### Findings (for the PC-owned fix/retest list)
- **F-1 (P3, Companion 8.3.0 native)** "Test connection" with no connection shows raw **"Invalid URL"**. Steps: isolated profile, Sync & setup, bottom, Test connection. Expected: "Connect your account first". Shot: `private/claude-native/native-companion-8.3.0-test-connection-invalid-url-en.png`.
- **F-2 (P3, Companion 8.3.0)** "Refresh standings" with nothing connected toasts **"Standings refresh finished. Check Activity for the result."**; Activity says "Not started". Wording implies success. Shots: `native-companion-8.3.0-wow-page-empty-en.png`, `native-companion-8.3.0-activity-unconfigured-en.png`.
- **F-3 (P2 candidate, a11y, inconclusive)** After pressing Tab 5 times in the narrow French view I saw **no visible focus ring** on cards or links, though focus moved (page scrolled). Needs a proper keyboard/contrast retest with Windows high contrast and 150-200% scaling. Shot: `native-companion-8.3.0-keyboard-tab5-narrow-fr.png`.
- **F-4 (P3, addon 8.2.0 FR)** The load line "Loaded. /guilded help for commands." stays English in French.
- **F-5 (P3, addon 8.2.0)** The two-step clear confirmation ("Cliquez encore pour confirmer") expires quickly and its tooltip covers the neighbouring "Terminer le test" label. Shot: `retail-addon-clear-confirm-fr-8.2.0.png`.
- **F-6 (P3, addon 8.2.0)** On Settings the status message after a test action overlaps the last visible Modules row (EN and FR). Shot: `retail-addon-settings-test-dungeon-saved-en-8.2.0.png`.
- **F-7 (P3, Discord /bg)** "My groups" and "Upcoming" give identical empty text "No upcoming groups you can access"; session IDs are raw 25-character ids retyped in a modal (consider a select); validation errors are bilingual on an English guild.
- **F-8 (process)** A `codex-computer-use` process started at 09:39 during this pass and repeatedly took the foreground; some clicks were lost, and the Chrome tab froze whenever it was not the active tab. Not a product bug.
- **F-9 (version truth, needs PC answer)** `Get-AppxPackage` lists `Kcaron.GuildedCompanion` **8.2.0.0** although the brief says Store 8.2 is still in certification and the installed standalone is 8.1.0.0. Please confirm what that package is.
- **F-10 (my own error, harmless)** While reloading I typed `/guilded` before the UI was ready and it went out as ordinary chat: "[Lebbowski] says: /guilded" in the open world. No other effect.

### NOT RUN (still open)
Window opacity comparison (looked mostly opaque; no baseline, not judged), missing-season display, full + standalone coexistence, backup scopes, real dungeon win/failure/early exit, sync with receipts and freshness, offline/reconnect, pause/resume on the candidate (isolated profile has no connection), linking/profile/edition switching (needs Discord sign-in, which is the owner's), light theme and high contrast, 150-200% scaling, update/version-truth flow, `/bg join` with a linked valid character and level/edition checks, `/bg manage` cancel (the test session above remains in the throwaway Ks server), consenting-recipient automation tests, Forever and two-PC checks.

### Screenshots
Native full-resolution PNGs (CopyFromScreen of the window rectangle, no resampling) in `backups/ui-qa-2026-10-30/private/claude-native/` (28 files; Retail ones show the character name and other players: private only) in the Codex checkout, and ten clean isolated-profile Companion 8.3.0 captures duplicated in `.../publication-ready/claude-native/`. `manifest.json` has one entry per file with version, language, SHA-256 and classification. Nothing uploaded; `publicationApproved` is false for all.

## 8.4 follow-up (30 Oct, about 12:00-12:20 Toronto) - Claude

- **Source:** F-7 fixed in PR #294 (merged into codex/bg-recorder-history-oct30, ac872da). F-1 and F-2 were already fixed in 8.4 source (connection test says "Connect your account first"; standings refresh refuses when not connected). F-4 could not be reproduced from source (code path translates). F-5/F-6 are layout items needing in-game verification, not changed. Full vitest (3220), tsc, eslint and both addon validators passed on fd7dcdc plus the fix.
- **Live surfaces (read-only check 12:10):** bot /health 8.3.0 ok, website guilded.kcaron.top and kcaron.top show 8.3.0, latest GitHub release v8.3.0 (published 13:47Z). Consistent with each other; 8.4 is source only, so no live surface says 8.4 yet. Updating Discord notices and the site to 8.4 requires the 8.4 deployment, which is not done.
- **Retail addons:** installed 8.4.0 Retail zips (built from the merged branch) over Guilded and GuildedDungeons after backing up the 8.2.0 folders and SavedVariables to qgb-qa-fixes/backups/retail-addons-8.2.0-before-8.4 (gitignored). SavedVariables untouched. WoW was closed gracefully first (saved variables written 12:06).
- **In-game 8.4 testing: NOT RUN.** Launching Wow.exe directly shows the password login, which I cannot fill in; the instance was closed. The game must be started from Battle.net by the owner.
- My stray keystrokes during a quit attempt opened the Reputation panel (harmless).