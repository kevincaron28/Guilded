# Retail acceptance — 28 October 2026

Status: initial load/reload and three main pages passed; broader acceptance in progress.

## Environment and build

- Actual `GetBuildInfo()` captured in game: Retail 12.1.5, build 70575,
  interface 120105, locale enUS.
- Guilded and Guilded Dungeons: 8.0.0-dev.20261028, local review packages.
- Installed ZIP SHA-256 values and extracted bytes were verified against the
  review manifest. No existing Guilded addon folders or saved files were found
  in this Retail installation before testing.
- A temporary `!GuildedLaunchCheck` addon records build/loading checkpoints and
  up to 20 errors locally. It sends no diagnostics over the network.

## Evidence recorded

The owner restarted the client, logged in, ran `/guildedcheck`, then `/reload`,
and reported: "Back in game; commands worked".

Saved diagnostics contain PLAYER_LOGIN, manual and PLAYER_LOGOUT checkpoints,
with both addons loaded and both versions equal to the development version above.
The Guilded namespace exists. The probe's error list is empty for this sequence.
This verifies the initial load and reload baseline; it does not establish that
every page or gameplay action is error-free. Errors before the probe handler was
installed may not have been captured.

The owner then opened `/guilded` and visited Home, My character and Settings,
reporting "All three display correctly". The next save contains five loading/manual/
logout checkpoints, both review addons still loaded, and an empty probe error list.
Guilded's own SavedVariables also identify `gameEdition = retail` and contain an
empty diagnostic list, covering errors that its protected page handlers might catch.
Language was `auto` during this English check. The copied evidence files are
`probe-ui-reload.lua`, `ui-summary.json`, `guilded-ui-reload.lua` and
`guilded-ui-summary.json` in the private acceptance folder.

Private installation/backup manifest, copied probe data, SHA-256 and status are
retained under `backups/retail-acceptance-20261028T105526Z/`.

## Pending checks

- French override and return to English; clipping, scaling and keyboard navigation.
- Dungeon/score pages and Retail API behavior; a real run, reset/abandon, reload
  during a run, completion and depleted-key evidence.
- Standalone Guilded Dungeons with Guilded disabled; both installed together
  should let Guilded record and keep the standalone recorder quiet.
- Upgrade with prior data, backup/restore/undo, two PCs and companion pairing/sync.
- Classic acceptance, recorded separately.

## Computer-use limitation

The Retail window was detected before and after restart. Window capture repeatedly
returned `FrameArrived timed out` / `window capture timed out: timed out waiting on channel`,
including after windowed-mode and foreground retries. No blind game input was sent.
Visual checks are currently performed by the owner and distinguished from filesystem
and saved-diagnostic evidence. The temporary probe should be removed after testing,
with its diagnostic file retained in the private acceptance evidence.
