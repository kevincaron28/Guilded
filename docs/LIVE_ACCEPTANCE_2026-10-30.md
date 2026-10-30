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
