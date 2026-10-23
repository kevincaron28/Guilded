# Guilded 7.3.2 — Game and two-PC acceptance

Record PASS/FAIL, date, both testers, officer/member roles, WoW build, language, candidate SHA-256 and run reference for every step. Use two physical PCs with separate game folders and companions. Two windows sharing one installation do not prove the sync path. Do not publish credentials or private SavedVariables.

## 1. Prepare both PCs

1. Exit WoW and quit the companion on both PCs. Back up the current addon folders, each account's `WTF/.../SavedVariables/Guilded.lua` and `GuildedDungeons.lua` (including `.bak`), and companion configuration. Keep the backups private.
2. Install the supplied matching 7.3.2 companion and complete addon ZIP on both PCs. Preserve SavedVariables and personal pairing. For the guild test use Guilded; for the standalone test use Guilded Dungeons with Guilded disabled. Do not run two companions against the same saved file.
3. Open the companion. Verify 7.3.2, the intended WoW/account path and your own Discord identity. If the live game moved out of the beta folder, use the folder-switch prompt and verify the new path.
4. Log into WoW. Run `/guilded version`, `/guilded diag` and open `/guilded`. Verify no Lua errors, correct guild/character and new synced timestamp. The server wipe does not delete private local history; old local runs must not repopulate server boards.
5. On Discord, run `/report ping` and check the public leaderboard. Record the bot version and empty/reset server results. The owner checks `/guilded-season status`: Season 1 remains November 4, 2026, 23:00 UTC (18:00 Toronto).

## 2. Complete one real dungeon on both PCs (G6)

1. Group the two testers with an eligible party; record levels and chosen tank/healer/DPS roles. Use full Forever character names for invitations/whispers.
2. Enter Deadmines, wait briefly before pulling, then begin combat. Verify timing starts from the recorded first-combat convention, rather than the entrance/loading screen.
3. Kill each boss normally. Check plausible boss durations and no floating timer. Kill VanCleef without manual completion. Leave/disband normally: the result must remain completed.
4. On both PCs `/reload` (or log out) to flush SavedVariables, then sync each companion. Check the same run identity, route, duration, participant levels/roles, deaths and boss evidence in both clients and the server result.
5. Sync both PCs again, including simultaneously. Expect one stored run and one set of awards. Independent reports may add confirmation; copies of the same report must not inflate it.

## 3. Verify scoring and guidance (G7)

1. Open Overall, Tank, Healer and DPS views. A recorded role belongs only to that role's view; missing roles remain unknown. Compare the same character/season/scope on both PCs and the website.
2. Write down a route's target, current best, counted status and suggested improvement/gain. Repeat the route slower: best-N rating must not stack. Improve it: displayed gain and any displaced route must match the actual result.
3. Run one mixed-level/out-of-band example. Confirm the eligibility explanation and any configured overlevel penalty; never assume an unranked run must earn competitive rating.
4. Confirm fresh server history contains no erased season scores/champions. Pre-launch runs belong to testing/Beta, not November's future window. Do not edit the official calendar merely to simulate launch.

## 4. Presence, reconnection and Scarlet wings (G8)

1. During a run, disconnect/rejoin one tester; in another run replace a party member. Keep timestamps of leaving/returning/joining.
2. Finish normally, save and sync both PCs. Verify all participants remain represented with sensible presence, original start levels and no fabricated full-run attendance. No duplicate award from the replacement/reconnect.
3. Complete Scarlet Graveyard and Library as separate runs, exiting/re-entering between wings. Check separate route keys, boss evidence and scores. Capture unknown-map/encounter diagnostics for missing launch routes; do not assign guessed IDs.

## 5. Test standalone Guilded Dungeons

1. On PC B disable Guilded, enable Guilded Dungeons and use personal companion mode with B's own character/realm. Repeat a recorded run and sync.
2. Reload after the companion writes the accepted/public score snapshot. Verify Public scope, own character/realm, role totals, improvement guidance and season context.
3. Press the browser companion's public-score refresh, save/download its output and verify the same view. An empty upload must refresh corrected/season-changed standings.
4. Switch to another character/realm: the previous character's snapshot must not appear as theirs. Enable both addons together and confirm no duplicate announcements or competing score panels.

## 6. Two-PC permissions and sync recovery

1. PC A uses an officer, PC B an actual ordinary member. B can sync their own character but cannot award points, edit a core, publish authoritative standings or read another guild's private data.
2. Pause B's companion, create unsent dungeon data, restart it and sync. Briefly disconnect B's network, then reconnect. Pending data arrives once without losing pairing; repeated sync changes no totals.
3. Test officer snapshot delivery with B's companion paused, then use normal companion sync for detailed role/guidance fields absent from the older officer relay. Record source/timestamp on both PCs.
4. In a disposable test pairing, revoke the credential and verify the next upload is refused. Re-pair with that tester's own account. Do not revoke your sole operational officer pairing accidentally.
5. In an isolated test guild only, repeat the ledger checks: distinct awards from two officers, repeat sync, void one award, reload and converge. Never add test EP/GP to the live guild ledger.

## 7. French layout and normal Windows operation (G10)

1. On a French client open setup, Run, Season, role tabs, improvement guidance, Local guild and backup preview. Check accents, clipping, buttons, scrolling and ordinary `/roll` parsing. Repeat core views in English.
2. On both PCs verify companion tray/window, close-to-tray, reopen, autostart hidden after Windows sign-in and resumed syncing. Check the watched file and last-upload timestamp.
3. Save screenshots/run references and `/guilded diag` output for failures. After a fix, install the rebuilt hash and repeat affected steps.

## Launch decision

Promote the exact tested artifacts only after required checks pass. Keep unknown 45–59/60 competitive routes disabled until real observations validate them. Gather the required diverse crews/days before calibration; the automated guardrails do not supply those samples. November's official window excludes earlier testing runs, but local client history remains private unless deliberately cleared by its owner.
