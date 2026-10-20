# Dungeon exit result card (candidate source, 20 October 2026)

Shared by Guilded and standalone Guilded Dungeons. No version bump, release,
deployment or installed-client update is part of this change.

- Finalization queues a result only for a completed run. Leaving early does not
  change recording state or create completion evidence.
- Automatic display waits until outside party/raid instances, loading has
  finished and one second has settled, and the player is out of combat.
- The pending run ID and per-run shown/dismissed flags are saved with dungeon
  history. Repeated completion/zone events and reloads do not repeat an automatic
  card. A pending result can survive a reload inside the completed dungeon.
- A new pull hides an open card and defers it until safe. Manual dismissal or
  expiration clears its deferred display. No modal focus, sound or automatic
  reload is used.
- The compact card fades over its last two seconds and expires after 15 seconds
  of unpaused display. Hovering pauses it; expanded details stay open for reading.
  The details button reveals boss attempts and party roles/deaths. Unknown deaths
  remain unknown.
- Reopen with `/guilded dungeon results` or `/gdg results`. Manual reopen bypasses
  the automatic-display guard and can also show an incomplete run honestly.

## Score and sync wording

The prominent score is a **local estimate of the public website rating**, using
the provisional public plan of 18 October 2026: 200 x target/time, clamped to
50-400 before the 10% per over-level penalty (maximum three levels), then rounded.
The breakdown names the provisional target, recorded time, base time rating and
level penalty. Guild-season rules may differ. This does not award points or alter
the authoritative Scores module.

Missing party levels, unsupported/ambiguous routes, a different difficulty,
out-of-band levels or missing automatic final-boss evidence show an unrated
reason. Successful Scarlet boss evidence selects a wing; mixed wings stay
unrated. A parity regression compares the Lua estimates against the website's
actual publicRules()/scoreRun(), including level limits, rounding and clamps.

No personal-best badge is shown: local history and selective season-best
snapshots do not reliably establish a complete comparable personal record.

The footer distinguishes saving locally from a companion receipt and asks the
player to check the website/guild Season for validation and visibility. Neither
state claims public publication or server-accepted points.

## Acceptance still required in the real game

1. Full Guilded: finish a dungeon, stay inside, loot and enter combat again;
   confirm no automatic card inside. Exit and verify one settled, combat-safe
   card with correct duration. Repeat both completion events and zone changes.
2. Exit during combat/loading; resume outside combat. Dismiss, enter/leave combat
   and reload: no resurrection. Reload before exit: one deferred result.
3. Hover during the fade, expand details, scroll party/boss attempts, collapse,
   dismiss and reopen by command. Check actual small UI scales and screen edges.
4. Early exit, abandonment, manual completion, unsupported route, missing levels
   and a rated supported route must retain honest states and score explanations.
5. Repeat on a French client and with standalone Guilded Dungeons alone; install
   both addons and confirm only full Guilded records/displays the result.
6. Save with /reload and let the paired companion upload; check the separate
   server receipt and final public/guild visibility. This code does not perform
   network requests or change sharing choices.
