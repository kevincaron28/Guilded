# Release scope and work remaining — 25 October 2026

Kevin requested feature completion and Classic/Retail releases today, clarified
that both Classic Era/Hardcore and progression Classic are targets, and required
Forever characters to display their first and last names. Other editions retain
single character names. The existing Forever target remains supported.

## Baseline

- Source: `codex/prelaunch-features`, draft PR #215, stacked on draft #214.
- Starting revision: `88db7ab6d96ae4a735cb6bff469c141d2049a9a1`; clean checkout.
- Existing candidate: 7.3.2 / protocol 2. Raid presets, Components V2 signup
  posts, public score images, shared scoring lock, French companion and save
  recovery fixes are implemented. Candidate interaction acceptance remains.
- Last recorded production bot: `65be65d`; installed companion: `b755adf`.
  Last recorded public versions: GitHub 7.3.1 and CurseForge 7.3.0. Today's
  source edits do not update any of those installations or downloads.

## Edition readiness

| Target | Evidence found locally | Work before release |
| --- | --- | --- |
| Forever | Existing TOC 16001; installed client recorded as 1.60.1.70532 | Remaining game/two-PC and French checks; verify full names after resync |
| Retail | Installed client recorded as 12.1.5.70575 | API and restricted-value audit, observed Interface number, appropriate raid/dungeon rules, safe identity isolation, packaging and real-client acceptance |
| Classic Era / Hardcore | No installed target found in the inspected WoW directory | Install/observe the intended client; compatibility audit, appropriate rules, identity isolation, packaging and acceptance |
| Progression Classic | No installed target found in the inspected WoW directory | Confirm the intended progression client/build; compatibility audit, appropriate rules, identity isolation, packaging and acceptance |

The installed version evidence comes from the game's `.build.info`; it is not
a successful login or API compatibility test. Do not infer Interface numbers
or CurseForge compatibility solely from these version strings.

The current build script produces a single Guilded ZIP. Its TOC declares
16001 and 20506, not an accepted set of current retail/Classic targets. Adding
more Interface numbers alone would not complete the port.

Concrete connected-product gaps found in source:

1. `Character` is unique by realm/name with no edition namespace.
   `findCharacter` permits a guild-unique name to match across realm spellings
   for Forever. Retail/Classic must not inherit that loose identity rule.
2. Dungeon run keys, official seasons, route evidence and public rankings lack
   edition isolation. Forever rules must not score other editions' runs.
3. Raid readiness uses a fixed level 60; raid presets, route catalog and loot
   content need target-specific handling rather than universal eligibility.
4. Packaging, installed-client validation, provider metadata and acceptance
   records must identify each exact target. Current mocks are predominantly
   Forever-oriented and do not establish cross-edition API compatibility.

## Forever display-name implementation

The new source stores display names separately from existing accounting names.
On observed Forever interface 16001 it reads `GetUnitName` or the first and
surname returned by `UnitName`; other interfaces retain their single names.
Guild roster and addon sender observations populate a presentation lookup.
Missing surnames are not invented from server names.

The change covers character captures/import codes, guild/personal companion
exports, linked/unclaimed characters, public run/player records, primary addon
views, Discord character/profile lists and signup picker, signup/core character
details, companion selectors, CSV export and public character links/titles.
Stable IDs, ledger keys/source references, ownership and URL lookup keys are
preserved. A new additive migration adds nullable presentation columns; it has
not been applied to production. Older data requires an authentic fresh capture
to acquire surnames. Existing accepted public run snapshots are not backfilled
with guessed names.

This fixes presentation, not the separate first-name identity design. Before
supporting duplicate first names, identify characters using authoritative full
identities/GUIDs and define a migration that cannot merge different players.
That design belongs with the edition-isolation work above.

## Completion order

1. Validate/review the name change and its additive database migration; preserve
   all existing links, points and pairing. Keep the new source distinct from
   the already-installed candidate.
2. Resolve connected-product scope for the new editions, then implement edition
   identity/rule isolation and compatibility fixes. Full addon/bot/companion is
   the proposed default; an in-game-only first release is a separate scope choice.
3. Finish candidate Discord/member workflows and platform previews already
   listed in `LAUNCH_READINESS_2026-10-24.md`.
4. Run exact-source CI including PostgreSQL restore/migration and Windows
   packaging, build matching artifacts and execute each target's real-client
   acceptance. Record hashes, language, build and tester results.
5. Publish the verified edition packages and matching release metadata, then
   verify actual public downloads. No release completion is recorded here.

No production deployment, installed companion replacement, main merge, public
upload, guild notification or live-data migration has been performed in this
continuation.

## Validation of this continuation

- Full local suite: 271 files / 2,274 tests passed. Private log:
  `backups/full-names-tests-2026-10-25.log`.
- TypeScript, ESLint and both addon validators passed; shared standalone files
  were regenerated with `dungeons:sync`. Browser companion and site builds passed.
- The final CSV presentation adjustment and version-document checks passed
  another focused run (2 files / 15 tests). `git diff --check` passed.
- Built/verified the 47-file main-addon preview at
  `dist/preview/Guilded-next-preview.zip`. It is not a public release or an
  installed/tested game package. No new Windows installer was built here.
- Starting head `88db7ab` has successful GitHub quality run `40145757292`.
  That result does not validate today's new code or migration. Exact new-source
  CI, PostgreSQL migration/restore and game/native acceptance remain separate.
