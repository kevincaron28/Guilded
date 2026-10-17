# Guilded 6.2.0 — Exact pre-upload acceptance checklist

Status: **released October 16, 2026 at the owner's direction with these checks still
pending**; they are now post-release follow-up. Original status: pending real-client checks, October 15, 2026. Use the exact 6.2.0
candidate whose commit/checksums are in the accompanying artifact manifest.
Record tester, date, client build, language, package hash and result for each row.
An automated test pass is not a pass in this table. Do not upload to CurseForge
until every required row passes or the release scope is explicitly reduced.

Already confirmed by the owner: boss-fight timing works in game. Earlier evidence
also covers the native dungeon page/current-past season views and officer bridge
reception/reload on Highpriest and Naomine. These passes are retained, but do not
prove the newly changed paths below. The recovered Deadmines run proves the
encounter identity; its manual recovery is not a fresh automatic-completion test.

Use backed-up test guild data for accounting/restore exercises. Pause the companion
for standalone tests; choosing In-game only does not stop that external process.
Do not overwrite the live guild's SavedVariables or award test EP/GP on its ledger.
Use an actual ordinary member for permission checks; two officers are insufficient.

| ID | Required exercise | Pass criteria | Status |
| --- | --- | --- | --- |
| G1 | Clean candidate install in an isolated test profile, no companion; open minimap menu, `/guilded setup`, Guild tools and dungeon finder. Reload and relog. | In-game only is the default; no missing-Discord error, Lua error or blocked UI action. Local tools remain available after receiving an officer snapshot. | Pending |
| G2 | Upgrade an existing 6.1.2/preview profile using the complete candidate. Open current/past seasons, local cores, standings and settings. Reload and relog. | Saved runs, archives, point totals, settings and pairing remain intact. The menu reports 6.2.0. Native guild/dungeon tabs still work and close normally. | Pending |
| G3 | As an officer in an isolated test guild, create a local core; set loot rules/reserve count; add main and bench characters; record a short raid session with attendance and a boss mark. Award 100 EP and 40 GP on the test ledger. End and reload. | Core/roster choices persist; attendance/marks persist; the selected character's totals change by exactly +100 EP/+40 GP once. Local core edits are refused during an active raid. Switching local/connected views does not overwrite either source. | Pending |
| G4 | With two PCs on the same candidate: publish officer standings, then back up the test record keeper; restore on PC B after previewing; compare cores, rosters, ledger and totals. Test restore undo, then establish one record keeper. | Snapshot source/time is shown; restore applies the saved accounting baseline without adding it twice; undo restores B's prior state. Reload retains both results. No simultaneous writers. | Pending |
| G5 | Log in as an actual ordinary guild member. Try local core edits, EP/GP administration and publishing authoritative standings. Receive an officer's snapshot. | Privileged changes are refused; own/member views work. Received snapshots do not grant officer controls or silently switch setup mode. | Pending |
| G6 | Fresh Deadmines clear with the candidate recording. Observe boss times in the Run/results view; kill VanCleef, then leave/disband normally. Save and let the existing companion upload; sync again. | No floating boss timer. Successful encounters have sensible durations. The run completes automatically at the final boss and stays completed after disband. One imported run/award only. No manual completion or data correction is needed. | Pending |
| G7 | With an eligible level-30 group, complete a candidate competitive route; inspect Discord's run result and the in-game Season page on both PCs. Repeat or improve it. Also inspect one mixed-level run, and the archived beta. | Per-character best and rating gain agree with the run time/target; repetitions do not stack rating; mixed-level completion explains why it is unranked; archived Highpriest 170 remains unchanged. Second-PC detail delivery and boss records work after reload. | Pending |
| G8 | Run Graveyard and Library separately, exiting/re-entering between wings. Test a party replacement or disconnect/rejoin during a recorded run. | Wings remain separate; participant history retains replacements and sensible presence. The server applies recorded eligibility, with no invented level/presence evidence. A replacement does not create duplicate awards. | Pending |
| G9 | Without Guilded Games installed, run a two-player soft-reserve roll-off, including SR+ and a tied reroll, then award once. Install/enable both addons and test session exclusion, combat and reload. | Guilded's loot rolls work independently. A host cannot run overlapping Games/loot sessions. No blocked-action/Lua error; cancelled/reloaded sessions do not award twice. | Pending |
| G10 | On English and French clients, open setup, Local guild, backup preview, Run/Season and loot-roll views; receive ordinary `/roll` messages. | Labels fit, translated controls work, roll messages are parsed, and no newly introduced Lua/locale errors appear. | Pending |
| G11 | On two candidate clients in an isolated in-game-only test guild, enable ledger sync on both officers. Make distinct awards, sync, repeat sync, void an award, reload and sync again. Include recovery of an author's entry from the other PC. | Both ledgers/totals converge once per entry; voids converge; the author can void a recovered award. Ordinary members cannot send accepted ledger edits. Turning sync off stops exchange and retains history. | Pending |
| G12 | Test officer snapshot sharing between candidate clients and between 6.1.2 and the candidate. Include an older client already online before the officer logs in, then request/relog. | Both wire formats arrive without Lua errors or repeated broadcast loops. Record any delayed older-client delivery; the known proactive-sharing limitation remains documented. | Pending |

G3–G5 are the standalone accounting/permissions gate. G6–G8 are the dungeon
acceptance gate. The arithmetic for best-eight replacement, all eleven routes,
80% boundary, weekly caps and archived totals is also covered offline; you do
not need nine dungeon clears merely to retest sorting arithmetic in game.
Do not assume all eleven routes are validated from G7: catalogue acceptance and
target calibration remain separate beta work before official competition.
Deadmines is participation-only in the current Best 8 phase; a correct fresh
Deadmines completion should not receive competitive rating in that phase.

## Required desktop check alongside the in-game session

- [ ] Quit the old companion and upgrade with the 6.2.0 installer. Existing
  configuration/pairing survives; one tray instance opens, finds the correct
  SavedVariables, uploads G6 once, and downloads the active/frozen season views.
- [ ] On the second PC, verify a clean companion installation/pairing where
  applicable. Check restart with an unsent run and an offline/reconnected sync;
  no duplicate awards, no lost unsent run and no second bot process.
- [ ] Verify `GuildedData` is discovered/enabled on the actual client and loads
  after Guilded. Upgrade the addon in the test profile, reload, and confirm
  standings survive. Check a newer browser-written file also takes precedence.
- [ ] With an accepted test backend, compare direct and website-proxied sync:
  one award, one reversal, repeated uploads, disconnect/reconnect, and stop/start.
  Verify no duplicate accounting and record observed update latency/upload sizes.
  New-server long polling cannot be accepted against the current older live bot.
- [ ] Change pairing/server in a test companion, then sync. No acknowledgements
  from the previous account/server may suppress uploads in the new connection.

## Outside the Guilded 6.2 upload gate

Guilded Games remains its own Alpha. Testing every game with non-addon players,
its complete French trivia pack and its publication status belongs to that
separate release. Guilded 6.2 only requires independence/coexistence checks above.

Before November 4 competition: follow the separate
[level-60 model and wing checklist](NOVEMBER_SCORING_IMPLEMENTATION.md), verify candidate routes/encounter evidence,
calibrate level-60 targets with diverse crews, decide the route/timer standard,
freeze official rules and choose an explicit start time. Do not alter the current
beta or old archives as a shortcut. No official season is scheduled by this package.

## Result record

For each ID, record: PASS/FAIL, tester(s)/guild role(s), date, client build,
candidate SHA-256, language, observations, and run reference or screenshot where
useful. Record defects without publishing private SavedVariables. After a source
fix, rebuild and repeat affected checks on the new hash before final publication.

### 16 October 2026: two-client session (one PC, 6.3 main at 7e6691c)

Testers: Highpriest Cheech (officer) and Halidor Galemorne (ordinary member, invited
for the test), both in Quebec Gold (Alliance during testing), English client, WoW
Forever beta. Both clients share one install, so both read the same companion
`GuildedData` file. Data that comes from the companion therefore matches on both
clients whether or not the in-game sync works.

- **G5, partial PASS.** As a member, `/guilded standings publish` and
  `/guilded award` are refused ("Officer or guild-master rank is required").
  Guild tools shows only Standings and Crafting, and the connected snapshot
  (11:56) displays without granting officer controls. Not run: local core edits
  as a member.
- **Defect, fixed in PR #99.** After accepting the guild invite,
  `/guilded diag` showed "Saved data belongs to guild: (not known yet)" until
  a `/reload`, even after the guild window was opened.
- **Finding, open.** This guild keeps EP/GP per raid core, so an officer's
  `/guilded award` needs a core first. `/guilded standings publish` only reads
  the guild pool and has nothing to share for a per-core guild. No test award
  was made.
- **Not run:** G3, G4, G9, G11, G12, and the 6.3 member relay. Each needs
  either two officers, two PCs (separate companion files), or a separate test
  guild whose ledger may take test entries.
- Full first+last names work for `/ginvite` and `/invite`. Guilded reports the
  surname as the UnitName realm (`full=Halidor Galemorne`) and keys data on
  the first name.

### 16 October 2026: G11 on Quebec Gold, temporarily (owner-approved)

Both accounts' SavedVariables were backed up, the companion was paused, Halidor
was promoted to Officer (rank 1), and both characters switched to In-game only
with `/guilded ledgersync on`. Afterwards Halidor was demoted to Initiate, both
logged out, the Guilded SavedVariables were restored (hashes match the backup)
and the companion was resumed. The test-state files are kept next to the backup
for debugging.

- **G11, partial.** Award A (Highpriest → Halidor, 1 EP) reached Halidor as
  soon as Halidor turned sync on. A repeated sync made no duplicates. Highpriest
  voided A, and the void reached Halidor (EP back to 0). The officer pages
  (Administration, Local guild) appeared on Halidor right after the promotion.
- **Defect, open: sync works in only one direction.** Award B (Halidor →
  Highpriest) and the void of B reached Highpriest only when Highpriest ran
  `/guilded ledgersync now`. Halidor's own `now` (twice, including after a
  reload) got no answer: status said "Highpriest: last heard N min ago. Ledgers
  differed". Highpriest handles Halidor's whispers (AUTH/DAYS/E) but seems not
  to answer Halidor's SUM on the guild channel. Suspects: the 60 s answer
  cooldown, or the GUILD addon message from a newly promoted officer.
  Investigate with the after-test SavedVariables.
- **Finding:** in In-game only mode, `/guilded standings <player>` still shows
  the old companion snapshot ("No shared standing for Halidor") instead of the
  local ledger.
- Not run: the void of B converging on Highpriest; turning sync off;
  a member's ledger edit being refused.

### 16 October 2026 (evening): two PCs, release candidate (main 60ede25, then 653171f)

Testers: Highpriest Cheech (guild master, main PC, realm text "Classic Beta PvP",
companion paused) and Naomine Merriweather (officer, second PC, realm text "Classic
Beta PvP 2", no companion and no GuildedData), both in Québec Gold, English clients.
Both PCs backed up their SavedVariables first and restored the Guilded files afterwards.
Each side was driven by its own Claude session; the two sessions coordinated by message.

| ID | Result | Observations |
| --- | --- | --- |
| G11 | PASS | Naomine's award reached Highpriest without Highpriest asking (the direction that failed before PR #100); Highpriest's award and its void reached Naomine; Naomine's void converged ("Ledgers matched" on both). Repeated syncs added nothing; counts survived a reload. With sync off on Naomine, a new award from Highpriest did not arrive and her earlier entries stayed. Members cannot change sync (G5 e). |
| G12 | PASS (candidate to candidate) | Naomine (no companion) shows "Guild data from Highpriest (2026-10-16T15:56:40.149Z)", the same stamp as the officer's companion file, despite the different realm texts. Not run: 6.1.2 against the candidate. |
| G3 | PASS (accounting) | Local core G3Test (EPGP, 2 SR), Highpriest main healer, Naomine bench DPS; +100 EP / +40 GP applied once and still there after /reload. Not run: raid session, attendance and boss mark (raid tools left v6). Found: full names refused by `/guilded localcore add` (fixed in #101). |
| G4 | PASS | Backup on Highpriest, restored on Naomine after the preview (accepted across the realm texts after #101); core, roster and Highpriest EP 100 / GP 40 matched; `/guilded restore undo` brought back Naomine's earlier state exactly. Found: the restore also copied the officer's per-PC settings (ledger sync on, sync partners, chat tab, window spot, characters); restore now keeps the receiving PC's own (this PR). |
| G5 | PASS | As Member: local core edit, award, standings publish and ledger sync on are refused; Guild tools shows only Standings and Crafting; officer data still shows. |
| G9 | Not run | The two characters are on different realm segments and far apart; a two-player roll-off needs a group. |
| 6.3 relay | PASS | Naomine, without any companion data, shows standings and dungeon standings "shared by Highpriest". |

Other fixes from this session: #100 (ledger sync whispered SUM; one officer's guild-channel
messages never arrived), #101 (full names in local cores, backup across realm texts,
`/guilded standings` showing the local ledger in In-game only mode), and the guild-join fix (#99).

Minor, fixed after 6.3.1: `/guilded chat off` now also closes the "Guilded" tab (it used to stay open, empty).

### 16 October 2026 (late): G9 and the guild map, two PCs on 6.3.0

Same testers and backups as the evening session; both PCs on 6.3.0 (7bdce6e), this PC's
companion paused, Guilded files restored afterwards.

| ID | Result | Observations |
| --- | --- | --- |
| G9 | PASS | Highpriest invited Naomine across the two realm segments. Round 1: Naomine reserved item 2042 by whisper to the keeper; clearing the list carried it over as SR+10 (10 per week by design). Round 2: both reserved; `/guilded reserve roll 2042` announced "rolling between Highpriest, Naomine (+10)"; Highpriest rolled 58, Naomine 91; "Roll winner: Naomine (101 including SR+)"; the award recorded the loot once and used up her reserve. Full Forever names in `/roll` messages were read correctly. A real tie cannot be forced in game; the tie re-roll is covered by `tests/lua/loot-roll.test.ts`. Not run: Guilded Games installed alongside (not installed on either PC). Display gap (fixed after 6.3.1): SR+ showed only on the keeper's list; the keeper now shares it with the list. |
| Guild map | PASS | With Naomine out of the party (so the game's own party dots do not count), Highpriest's world map showed her dot in Northshire, tooltip "Naomine — Level 1, Elwynn Forest"; `/guilded map` listed "Naomine (1): Elwynn Forest". The other direction too: Naomine saw "Highpriest / Level 18, Darkshore" on her map and "Highpriest (18): Darkshore" in `/guilded map`. |

Found while setting up: whispers by first name fail on WoW Forever ("No player named
'Naomine'"); fixed in 6.3.1 (version notice, guild module settings for members, loot council list).

### 16 October 2026 (night): G1 and G2 on the main PC, 6.3.1 build

Highpriest Cheech, English client, companion paused; the saved data was restored to the
backed-up baseline afterwards (hash verified) and GuildedData re-enabled.

| ID | Result | Observations |
| --- | --- | --- |
| G1 | PASS (one part not run) | Isolated profile: no Guilded saved data and the GuildedData folder hidden (an earlier attempt that only unticked Guilded Data still loaded companion standings, so it was discarded). First login: "Addon-only is ready. Discord linking and companion sync are optional"; `/guilded setup` labels In-game only as the default; no missing-Discord or Lua error. Home, Guild tools (Standings, Crafting, Administration, Local guild), the Local guild page and the dungeon window open and work. Reload and relog: "No Guilded problems recorded", mode kept. Not run: receiving an officer snapshot on the fresh profile (no other officer online). |
| G2 | PASS (6.2.1/6.3.0 profile) | The real profile, last saved by 6.2.1/6.3.0, loaded by 6.3.1: version 6.3.1; saved standings, both raid cores, the window position, chat tab and connected setup kept; recent runs with dates; current season "Quebec Gold - Beta Best 8" and past season "Beta finale Oct 22" with the archived score 170 unchanged; reload without problems. A 6.1.2-era profile was not available. |

### 17 October 2026 (morning): PR #106 fixes and G1's remainder, two PCs

Highpriest Cheech (guild master, main PC, companion tracking paused) and Naomine Merriweather
(officer, second PC, no companion, no GuildedData), English clients, 6.3.1 plus the PR #106
branch (2e7fca2 for ChatTab.lua). Each PC was driven by its own Claude session; both backed up
their Guilded SavedVariables first and restored them afterwards.

| ID | Result | Observations |
| --- | --- | --- |
| Chat tab | PASS (after a fix) | `/guilded chat off` now closes the Guilded tab. First try found a second problem: turning the tab on again said "on" but nothing opened, because a closed chat window keeps its name and the addon wrote into the hidden window (fixed in 2e7fca2: a window counts only when its frame or tab is shown). Then on/off/on/off/on worked, reusing the same window, on Highpriest. Naomine (2e7fca2): on/off three times, the tab appeared and closed each time, General became active again on off; no Lua error, no problems recorded. |
| SR+ for members | PASS | Highpriest opened a list, Naomine reserved item 2042; Highpriest cleared and reopened (carry-over SR+10), Naomine reserved again. Her `/guilded reserve list`: "Naomine: item 2042 (SR+10)". Her "Yours:" line had no SR+; it now shows it too (9a65ae0, offline test only). Her window has no Reserves tab because her loot system is GP bids (by design). |
| G1 (rest) | PASS | Naomine with her Guilded SavedVariables moved aside and no GuildedData: "Addon-only is ready ..." on first login; about 30 s later `/guilded standings` showed "EPGP: Highpriest (2026-10-16T22:29:15.579Z)"; Home showed standings and dungeon standings "shared by Highpriest"; Guild tools showed the snapshot with officer controls only as her rank allows; Local guild opened. Mode stayed In-game only (`setupMode = "local"`), no Lua error, no problems recorded; the same after /reload and a full relog, without repeating the first-run message. |

Afterwards both PCs restored their Guilded SavedVariables (hashes match the backups); the main
PC went back to the 6.3.1 addon and resumed companion tracking. G6–G8, G10, the Guilded Games
part of G9, the 6.1.2 parts of G2/G12 and the desktop companion checks are still not run.
