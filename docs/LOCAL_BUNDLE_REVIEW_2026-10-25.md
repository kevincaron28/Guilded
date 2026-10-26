# Full local bundle review — 25 October 2026

Status: **local review candidate, not published**. This review covers the combined
addon, bot, companion and website changes, including Claude's walkthrough and loot
reference fixes. Published 7.3.2 / protocol 2 remains unchanged. The owner's latest
instruction keeps all changes local until review.

Feature instructions and earlier evidence remain in
[bulk actions, GRM migration and buffs](LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md) and
[the integrated feature bundle](LOCAL_FEATURE_COMPLETION_2026-10-25.md).

## Findings fixed in this review

| Priority | Finding and resulting behavior | Main source |
| --- | --- | --- |
| P1 | Changing pasted actions or failing a replacement/recovery preview could leave an older plan confirmable. Input changes and new previews now invalidate it; a pending native request keeps its audit receipt but loses confirmation. | `addon/Guilded/Modules/RosterTools.lua:236`, `RosterAdmin.lua:45` |
| P1 | A recent roster timestamp could be reused immediately after switching guilds. Freshness is now bound to the guild/realm/edition that emitted the roster event. The admin window clears its inputs and previews on scope or permission loss. | `addon/Guilded/Modules/RosterTools.lua:59`, `RosterAdmin.lua:68` |
| P1 | Nested GRM fields could retain known officer/custom notes with private history disabled. Conversion strips those fields recursively, and the addon independently rejects falsely public archives containing them. | `companion/grm-migration.mjs:60`, `addon/Guilded/Modules/GRMMigration.lua:38` |
| P2 | The converter could report success for data rejected by the addon: scalar groups, oversized numbers, control characters or incompatible structural bounds. It now validates the import contract before creating an archive. | `companion/grm-migration.mjs:90` |
| P1 | Availability treated missing/throwing/secret combat state as outside combat. Unknown state now prevents reporting and owned-key reads. | `addon/Guilded/Modules/Presence.lua:20` |
| P1 | Throttled availability packets could be retried after consent, guild, edition, status, key or combat state changed. An optional queue guard rechecks every attempt; stale packets expire after five seconds and failed guards discard them. Ordinary packets retain their existing pacing. | `addon/Guilded/Modules/Presence.lua:92`, `addon/Guilded/Util.lua:407` |
| P2 | Long review reports exceeded the copy window's visible area without a scrollbar. Reports now use a capped scrollable viewport; single-line archive codes retain their full text. | `addon/Guilded/Core.lua:902` |
| P2 | Core rename, editor opening and submitted price/rename actions acknowledged Discord after slow database/channel work. They now acknowledge first and finish through the existing reply. Modal failures use an ephemeral follow-up after acknowledgement, avoiding a second initial reply. | `src/commands/core.ts:155`, `src/commands/core-editor.ts:76`, `:180`, `:204` |

The queue change is mirrored in Guilded Dungeons through `npm run dungeons:sync`.
The new GRM validation message has a French companion translation. Regression tests
exercise the actual Lua modules and command handlers, with mocked clients and stores.

## Review assessment

### Additional offline pass

The owner's next continuation added these fixes, still local and uncommitted:

| Priority | Finding and fix | Main source |
| --- | --- | --- |
| P1 | Core collectors reused opening-command authority for later actions. Buttons, character picks, forms, loot selection and final schedule confirmation now check the current interaction's member roles within the bound guild scope. Cached and raw Discord member representations are covered. | `src/commands/core-access.ts`, `core-editor.ts`, `core-planning.ts` |
| P1 | Rename/price modal collectors accepted any modal submitted by the same user, allowing two open editors to consume the same submission. Each modal is now tied to its unique opening interaction and exact custom ID. | `src/commands/core-editor.ts:186`, `:206` |
| P2 | Character picks could fall back to a bare name when strict signups were off. The picker now passes exact IDs, displays Forever surnames, and refuses a character removed after the menu was shown instead of clearing the current assignment. Core assignment/backup resolution uses owned identities within the selected guild in either signup mode. | `src/commands/core-editor.ts:251`, `src/services/raid-core.ts` |
| P1 | A 24-character menu could remove backup choices omitted from its options. It now has bounded pages; editing backups changes only that page. Stale page/player controls are rejected, and overlapping picker actions are refused while an operation is pending. Read-only navigation/rejected controls do not refresh the public roster. | `src/commands/core-editor.ts:251` |
| P1 | Replacing multiple backups could remove old entries before encountering an invalid new choice. The complete visible-page selection is validated before writing and committed in one serializable transaction. Other pages and existing backup roles are preserved. Selecting a core's primary character removes its duplicate backup entry in either signup mode. | `src/services/raid-core.ts:171` |
| P2 | Schedule/composition forms could spend their acknowledgement window updating the old message. They now acknowledge the submission before cleanup or database work. | `src/commands/core-planning.ts` |
| P2 | Large numeric-looking string keys could collide when encoded as Lua numbers. They remain strings; unsafe numeric source keys are refused. Lua nil entries no longer inflate migration counts, and malformed history containers are refused rather than silently dropped. | `companion/grm-migration.mjs:31`, `:60`, `:131` |

Additional regression coverage includes exact per-edition role IDs in one Discord,
revoked leadership at later steps, modal isolation, later character pages, removed
characters, scoped backup transactions and actual Lua import of adjacent large keys.
Revocation inside a nested character picker stops the entire pending add batch and
closes that picker. The add batch retains the role/bench choice from its opening click,
so editing another control while a character is being selected cannot redirect it.
Database transaction tests use a mocked adapter; no production database or Discord
service was contacted. Real deployment/transaction-load acceptance remains separate.

### Combined assessment

| Dimension | Assessment | Evidence and practical limit |
| --- | --- | --- |
| Security/privacy | Good after the fixes above | Fresh guild-specific authorization, CSRF and escaped web output; private notes excluded by default; literal-only GRM parsing; source and destination overwrite protection. Native permissions still need real-client acceptance. |
| Correctness | Offline candidate passes; client acceptance pending | Preview invalidation, roster freshness, changed permissions, acknowledgement/timeouts, recovery, edition identity and delayed messages have regression coverage. Mocked APIs do not certify game behavior. |
| Performance | Bounded for the reviewed paths | Web queries/pagination and imports are capped; presence is paced, observations sampled, and stale packets dropped. Roster timers check pending state, while fresh roster events drive enumeration. No new recurring database or Discord polling. |
| Maintainability | Good with documented boundaries | Shared buff catalog generation, shared dungeon utilities, focused integration tests and explicit local/published status. Claude's two commits are tracked independently because their ancestry differs. |

Positive observations: Forever display names retain both names without changing ledger
identity; Blizzard realm distinctions remain intact. Assigned team characters count
once, while backups do not inflate buff coverage. Partial/hidden observations remain
unknown. Bulk mutations require a separate click and verified result; recovery refuses
to overwrite newer changes. GRM history remains separate from Discord ownership and
Guilded points. Existing countdown behavior does not require per-minute bot refreshes.

Reviewed surfaces include roster filtering/export, main/alt review, crafter/team/history/
group pages, current scoped authorization, native client tool entry points, opt-in
availability, native bulk action plans, GRM conversion/import, edition buff catalog,
Claude's walkthrough fixes and the packaging boundaries. This is a review of the combined
candidate and its integration paths, not a guarantee that every historical code path is
bug-free.

## What remains before publication

1. Owner review of this local candidate, then an intentional version/release change.
   Preserve the uncommitted bundle before pulling or merging Claude's PRs #222/#223.
2. Real-client checks across Forever, Era, TBC, Mists and Retail: officer permissions,
   native roster requests/acknowledgements, combat transitions, recovery, guild switches,
   report/paste layout, locale behavior and character-local persistence.
3. A real GRM backup comparison: source counts, retained/omitted fields, private-history
   access and restore behavior. The accepted schema and limits are explicit; arbitrary
   GRM versions are not assumed compatible.
4. Native profession/finder behavior, opt-in sharing between clients, Retail key/secret
   APIs and actual aura reads. Forever buff coverage remains a provisional Classic
   baseline until its custom spells are observed.
5. Previously recorded dungeon/two-client checks and benchmark calibration. The sourced
   routes and provisional scoring are implemented, but offline tests cannot validate
   actual route timing or custom-server mechanics.
6. After approval: final committed CI, the existing database preflight/backup procedure,
   deployment and live acceptance. Local builds do not certify production behavior.

Recommendation: keep the next release focused on this reviewed scope. Do not silently
turn GRM history into ownership/ledger changes, enable presence by default, or present
provisional buff/benchmark data as measured facts. Further roadmap ideas remain separate
from the implemented release candidate.

## Validation and local artifacts

- Latest stable suite: **295 files / 2,548 tests passed**, 133.75 seconds, with
  `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=20000`.
  Log: `backups/offline-continuation-full.log`. The preceding review passed
  293 files / 2,519 tests (`backups/release-review-full.log`).
- TypeScript, ESLint, both addon static validators, generated buff-catalog check,
  shared dungeon synchronization and `git diff --check` passed. Browser companion
  build passed. Focused logs: `backups/release-review-queue.log` (103 tests),
  `backups/release-review-discord.log` (26 tests), plus UI and migration checks.
  Latest core access/pagination/GRM regressions are included in the full suite;
  the final batch/character-picker run also passed 21 tests in two files.
- Local package location: `backups/local-review-2026-10-25/`. Ten addon ZIPs cover
  Guilded and Guilded Dungeons for all five edition targets. Their review markers
  distinguish them from the published version, whose number remains unchanged.
- Windows companion review folder: `backups/local-review-2026-10-25/companion/win-unpacked`.
  This is an unpacked local build, not an installed release. It shares the installed
  companion's app identity; close that app before manually reviewing this one.
- Rebuilding and package verification **passed**. Checksums and source fingerprints
  are recorded in `manifest.json`. Every packaged addon Lua file matches current source
  except the deliberately sanitized `Guilded/Standings.lua`; companion ASAR and converter
  checks passed. The packaged converter processed synthetic data, and the CLI refused
  to overwrite an existing archive while preserving its input. Verification did not
  launch Electron, access real game data or send anything to Discord.
  Logs: `backups/release-review-packages.log`, `backups/local-review-companion-build.log`,
  `backups/release-review-package-verification.log`.
  This continuation's package/browser-build/verification logs use the
  `backups/offline-continuation-` prefix; the Windows build log above is refreshed.

## Claude coordination

Claude's checkout remains at `b9fd62cffeefff5bba22772f4b1ada245ef02c4d`.
The previously integrated `816c7af` and `b9fd62c` changes remain preserved. This review
intentionally extends `src/commands/core.ts`, `src/commands/core-editor.ts` and
`src/commands/core-planning.ts` with response timing and subsequent collector fixes,
so these files no longer exactly match `816c7af`. The latest pass also changes the
core service, character picker and their tests; it retains Claude's original fixes.
His tracked checkout was not modified. Ownership/status updates use the existing
untracked `CODEX_LOCAL_REVIEW_HANDOFF.md` and shared coordination record; no new direct
reply is implied. No commit, push, merge, live Discord mutation or deployment occurred.
