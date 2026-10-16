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
