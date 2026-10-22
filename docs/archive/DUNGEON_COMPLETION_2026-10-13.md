# Hall of Thanes completion repair

The owner reported that killing Durgen Dirgehammer in WoW Forever did not end
the dungeon run. After the owner reloaded, read-only inspection of SavedVariables
confirmed instance 3065, a successful final encounter 3496, and no
`finalEncounterId`. All four encounter kills were recorded. The owner manually
completed the run; the stored duration includes the delay before that command.
Existing SavedVariables and recorded results are not rewritten by this repair.

Guilded previously required a final encounter ID from the Encounter Journal.
The compatibility layer now recognizes the observed Hall of Thanes encounter
ID without that journal. ENCOUNTER_END and BOSS_KILL finish active runs.
Numeric identities support localized names. No combat-log event is registered.
Completion requires the player to be in the matching party instance. Wipes,
unrelated kills, and later duplicate events do not complete another run.
Completed instances stay finished through zone notifications and reload until
the player leaves, avoiding an immediate replacement run in the cleared dungeon.

Regression coverage runs the actual Lua files with mocked game events. A new
in-game final-boss kill remains required to verify automatic completion on
Forever. Version remains 6.0.0 / protocol 2; no bot deployment or public release
is part of this addon repair.

Validation: TypeScript, ESLint, addon validation, and all 166 test files /
1,357 tests passed (full suite with `--maxWorkers=2`). The initial unrestricted
run was interrupted after unrelated PoE test failures under load; those tests
passed in the bounded full run. All six dungeon regressions and the addon
validator passed again after the final combat-log fast-path adjustment.

Installed and SHA256-verified Compat.lua and Modules/Dungeon.lua in the active
`D:/Program Files (x86)/World of Warcraft/_classic_beta_/Interface/AddOns/Guilded`
installation. Original files are in
`backups/dungeon-completion-2026-10-13-095637`. SavedVariables and Standings.lua
were not modified. Rebuilt `dist/Guilded-v6.0.0.zip`; no public publication.
The owner must reload once after installation to load the patch. Automatic
completion acceptance remains pending the next real final-boss kill.

## Blocked-action follow-up

The owner reported Blizzard's blocked-action popup on `/reload` after installing
the first patch. Its optional COMBAT_LOG_EVENT_UNFILTERED registration is a
likely cause: restricted clients raise a forbidden-action notification even
when registration is wrapped in pcall. Removed that registration and the entire
combat-log fallback. The original saved-run evidence already proves that
ENCOUNTER_END delivers encounter 3496 on this client, so that fix remains.
The screenshot does not name the forbidden function; the saved diagnostics
available during investigation did not yet contain this new warning.

The regression harness now simulates a restricted client and asserts zero
attempts to register either combat-log event. It also verifies localized
encounter names and duplicate completion events. Live acceptance requires
reloading the corrected addon and confirming the popup no longer appears.

Corrected patch validation passed: TypeScript, ESLint, addon validation, six
focused regressions, and the full 166 files / 1,357 tests with two workers.
The static validator now rejects combat-log event-name literals, catching
table-driven and compatibility-wrapper registrations that its old direct-call
regex missed. Installed both corrected Lua files with SHA256 verification;
the previous patch is backed up under
`backups/dungeon-restricted-event-2026-10-13-103939`. Rebuilt the addon ZIP.
SavedVariables remain untouched. The owner confirmed on 13 October 2026 that
the blocked-action popup no longer appears after reloading the corrected addon.
This closes the popup acceptance check. The subsequent Hall of Thanes run
`QG-20261013-140828-Highpriest` completed automatically on encounter 3496 in
22:25, confirmed by SavedVariables and the owner's completion-popup report.
Its separate Discord rejection and repair are tracked in
`DUNGEON_RESULTS_2026-10-13.md`.
