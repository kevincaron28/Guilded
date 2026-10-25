# Release scope and work remaining — 25 October 2026

Kevin requested feature completion and Classic/Retail releases today, clarified
that both Classic Era/Hardcore and progression Classic are targets, and required
Forever characters to display their first and last names. Other editions retain
single character names. The existing Forever target remains supported.
Kevin subsequently confirmed **full addon, bot and companion** for every target.
The in-game-only option is out of scope. Kevin also confirmed **several editions
in one Discord server**. A server-wide edition setting is therefore incorrect;
every WoW action needs an unambiguous in-game guild context.

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
2. Implement the confirmed full connected-product scope: edition identity/rule
   isolation, client compatibility, bot setup and companion selection.
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

## Edition groundwork (separate stacked branch)

Branch `codex/game-editions` starts from the full-name commit `f7251ac` on
`codex/prelaunch-features`. That full-name commit passed GitHub quality run
`40179278185`; this does not establish real-game acceptance.

Implemented in the next change:

- Both addons capture the client edition and Interface number; dungeon peer
  summaries and native/browser companion exports preserve them.
- A shared parser recognizes Forever, Era, TBC Classic, Mists Classic and
  Retail interface families. Unknown/contradictory metadata fails explicitly.
  These families identify data; they are not a compatibility certification.
- Guild imports check edition provenance at preview (before pairing/relay) and
  again inside apply's transaction. Personal files from different editions
  cannot be combined. Standings writes compare saved-client and guild editions.
- An unapplied migration namespaces linked-character uniqueness by edition and
  adds edition metadata to unclaimed characters. Existing rows default to
  Forever; IDs, ownership and ledger references remain unchanged.
- `WowGuild` can hold multiple in-game guilds/editions under one Discord server,
  keyed by server, edition, realm and guild name. Its registration/selection
  service rejects ambiguous choices and foreign-server IDs. It does not infer
  in-game names from Discord names or move existing history. PostgreSQL
  verification now covers same-named characters in different editions,
  multiple guild spaces, uniqueness and backup restoration.
- Matching keeps the legacy Forever realm fallback, but an explicitly tagged
  other-edition character requires its own realm. Discovery keys outside
  Forever include the realm.

**This is groundwork, not the completed port.** New-edition connected guild
sync and public competitions deliberately remain disabled. No edition chooser
has been exposed. Before removing those guards, finish the following together:

1. Wire in-game guild selection through setup, channel defaults, commands,
   companion pairing and uploads. Scope guild settings, cores, rosters, raids,
   loot, ledger, imports and announcements to the selected `WowGuild`, with a
   verified migration for existing Forever history. Shared Discord membership
   must not imply shared points or access to another in-game guild.
2. Propagate edition and realm through every manual character/verify/claim
   path and query projection. The addon's non-Forever internal identity must
   retain realms; its current first-name ledger keys cannot safely identify
   cross-realm duplicates. Preserve Forever identities through any migration.
3. Scope public runs, web characters, URLs, caches, official seasons and guild
   rotation by edition. Give each edition its own verified route evidence and
   scoring configuration; never reuse Forever map IDs/targets by assumption.
4. Make raid readiness, presets, attunements and loot rules edition-aware.
5. Finish companion edition selection and complete the matching addon, bot and
   installer packages. Audit restricted Retail APIs in the actual client.
6. Run actual Classic/Retail and Forever acceptance, PostgreSQL migration/restore
   and Windows packaging on the final source before release promotion.

No new edition has been publicly released, installed on a game client, or
enabled on the live bot by this branch. The full-product request remains open.
