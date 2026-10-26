# Local roster actions, GRM migration and buff coverage — 25 October 2026

Latest validation and fixes: [full local bundle review](LOCAL_BUNDLE_REVIEW_2026-10-25.md).
The implementation/results below record the preceding continuation; the review supersedes
its test totals and describes subsequent privacy, stale-preview and response-timing fixes.

Status: **local, uncommitted review candidate**. Nothing in this continuation was pushed,
published, deployed, sent to Discord or applied to a live guild. Published version 7.3.2
and protocol 2 are unchanged. This extends [the earlier bundle](LOCAL_FEATURE_COMPLETION_2026-10-25.md).

## Delivered

### Reviewed native guild operations

Officers can open **Guild tools → Roster admin** or `/guilded rosteradmin`.

1. Refresh the full roster, then paste a tab-separated plan with the literal header
   `character`, `action`, `value`. Use actual tab characters between columns.
2. Each character gets one row, using the exact roster or full display name. Actions:
   `public`, `officer`, `promote`, `demote`, `kick`. Notes are at most 31 UTF-8 bytes;
   rank changes/removal require an empty final value. Plans accept at most 50 rows.
3. **Preview actions** lists before/after values and blocked entries. The whole plan
   must be valid. Rank changes move one step, below the acting officer's own rank.
4. Type the displayed `APPLY N` phrase, or `REMOVE N` when any removal is included,
   and choose **Confirm plan**. A confirmation lasts at most two minutes from preview.
5. Each **Apply next action** click submits exactly one native request. It requires
   fresh roster data, current permissions, the same guild/edition/officer, unchanged
   identity/rank layout and unchanged target values. GUID APIs are preferred; legacy
   note calls resolve the current index immediately before writing.
6. A later roster event must show the expected result before another request is
   available. The addon stops after 15 seconds without verification; it never retries
   or resumes requests on login. Inspect the actual roster before preparing another plan.

**Local audit** retains the last 200 requests and their requested/verified/failed/
unverified states. **Recovery preview** prepares the inverse of the last verified
note or rank change, only if it would not overwrite newer data. It needs a new
confirmation and a new click. Kicks cannot be undone; reinvites require acceptance.
The audit is character-local and scoped by guild, realm and edition. Officer-note
values are hidden when current private-note access is absent. At most ten guild
contexts are retained; exceeding that bound refuses new storage without deleting history.

### GRM data migration

The installed companion's **World of Warcraft → Import from Guild Roster Manager**
accepts a SavedVariables `.lua` backup. Enter the exact source guild, realm and edition,
choose the source file, review record counts and omissions, and save a new text archive.
No Discord connection or running game is needed for conversion. The source file and
existing destination files are never overwritten. The browser companion does not offer
native file-dialog conversion; the local CLI below is also available.

The converter reads the current per-guild structures in `GRM_GuildMemberHistory_Save`,
`GRM_PlayersThatLeftHistory_Save`, `GRM_LogReport_Save` and `GRM_Alts`. It preserves names,
GUIDs, selected member fields, join/rank history, former members and alt groups as source
data. Unsupported member fields are counted as omissions. Unknown guild metadata is
not treated as a player. GRM groups do **not** establish Discord ownership or replace
Guilded's current main/alt identities, EP/GP or attendance records.

Private history is off by default: officer/custom notes and **all logs** are excluded
because even departure logs can embed private notes. The explicit option preserves
those fields and logs, and importing/viewing/exporting that archive requires current
private-note permission. Archives are plain readable data, not encrypted or authenticated;
the checksum detects accidental corruption only. Keep private exports on a trusted device.

The converter parses data literals without executing Lua. Limits: 16 MB source, 2 MB
archive payload, 2,000 current and 2,000 former members, 2,000 groups, 10,000 history
entries, plus depth/node/string bounds. A guild/realm mismatch is refused. Supported
schema is based on upstream source, not a promise to parse arbitrary GRM versions.

In game, copy the resulting `GGRM1:...` code into Roster admin, choose **Preview GRM**,
review scope/counts/omissions, type `IMPORT`, then **Import GRM**. Search by character
name in the confirmation/search box and choose **Search GRM history**. **Export GRM
archive** copies the imported archive. Type `UNDO IMPORT` and use **Undo GRM import**
to restore the previous local archive. Import receipts retain 20 operations; each guild
retains its current and previous archive. This is deliberately a local history migration:
source notes/ranks are not replayed as native guild actions or uploaded by the companion.

CLI alternative (run from the repository with its Node dependencies installed):

```powershell
node companion/grm-migration.mjs --input="C:\Backups\GRM.lua" --output="C:\Backups\Guilded-GRM-new.txt" --guild-key="My Guild-MyRealm" --guild="My Guild" --realm="My Realm" --edition="classic-era"
```

Add `--with-private-history` only when desired. The GRM source guild key uses the guild
name, a hyphen, then the realm with spaces/hyphens removed. Edition choices are `forever`,
`classic-era`, `classic-tbc`, `classic-mists`, `retail`.

### Edition buff coverage

The Ready page and Roster admin have **Buff coverage**. It reads current group auras
on demand and shows observed / not observed / unknown counts, plus potential class
providers. Positive evidence survives partial reads; hidden/offline auras remain unknown.
Class presence does not establish learned spells, talents, blessing choices or party range.
Classic families are not treated as universally required readiness checks.

- Era/TBC/Forever: Fortitude, Arcane Intellect, Mark/Gift of the Wild, Divine Spirit,
  Battle Shout, Kings, Might and Wisdom. Classic rank/greater spell IDs are recognized;
  later ranks may match names resolved by the current client, including French names.
- Forever explicitly displays **provisional Classic baseline**. Unpublished custom
  spells are not guessed. This is a supported-family catalog, not all possible buffs,
  world buffs, resistance auras, totems or consumables.
- Mists has a separate six-family catalog and alternative class providers.
- Retail keeps its existing six-family catalog and required-buff behavior.

Private team pages now show edition-specific potential providers for all five editions,
including alternative Mists providers. Only explicitly assigned active characters count;
benched/backup characters do not become extra players. Partial rosters keep absence unknown.
The shared source `companion/raid-buffs.mjs` generates `RaidBuffCatalog.lua`; regenerate with
`node scripts/build-raid-buff-catalog.mjs`. A regression test checks exact synchronization.
Client spell-name lookup is cached for 30 seconds. Bulk verification reads the roster once
per new roster event; a four-times-per-second timer only checks pending timeout/state.
No recurring web, database or Discord work was added.

## Claude integration

Rechecked `C:\Users\Kev\Desktop\qgb-claude-fixes` at `b9fd62cffeefff5bba22772f4b1ada245ef02c4d`.
Integrated that commit's three files (raid-loot reference, Onyxia price template and tests).
Its branch ancestry differs from the earlier `816c7af` fixes; applied the individual commit
patch instead of diffing branch tips, preserving the 15 previously integrated files.
The Onyxia list is explicitly an unconfirmed Classic baseline; `?` prices must be filled
before import. No Forever loot or prices were fabricated.

Coordination uses the existing `CODEX_LOCAL_REVIEW_HANDOFF.md` in Claude's checkout and
`backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md`. This records file ownership/status;
there is no new direct acknowledgement from Claude to claim.

## Evidence and remaining acceptance

Primary source review:

- Native operations/permissions: [Blizzard GuildInfo API definitions](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/GuildInfoDocumentation.lua)
  and [Classic roster UI](https://github.com/Gethe/wow-ui-source/blob/classic_era/Interface/AddOns/Blizzard_Communities/GuildRoster.lua).
- Migration structures: [GRM API](https://github.com/TheGeneticsGuy/Guild-Roster-Manager/blob/Retail/GRM_API.lua),
  [roster scanner](https://github.com/TheGeneticsGuy/Guild-Roster-Manager/blob/Retail/GRM_ScanRoster.lua),
  [log structure](https://github.com/TheGeneticsGuy/Guild-Roster-Manager/blob/Retail/GRM_Log.lua).
- Classic rank IDs: [LibClassicDurations](https://github.com/rgd87/LibClassicDurations/blob/master/classAbilities.lua).
  Later catalogs: [WeakAuras TBC](https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAurasTemplates/TriggerTemplatesDataTBC.lua),
  [WeakAuras Mists](https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAurasTemplates/TriggerTemplatesDataMists.lua).

Offline verification includes actual Lua modules against mocked game APIs, parser/converter
roundtrips, Unicode, rejected executable input, scope/permission changes, timeout/recovery,
GUID/rank/index handling, native file-dialog cancellation and exclusive save behavior.
The French companion form was exercised in a synthetic browser fixture, with no real
files, account, uploads or game API. The native dialog flow is covered by mocked tests.

Real-client acceptance still required across editions:

- Full roster enumeration and permissions on an actual officer account; native GUID and
  legacy operations, protected API behavior and combat transitions.
- Roster acknowledgements, timeout after a refused request, concurrent officer changes,
  recovery, guild switching and character-local SavedVariables across reloads.
- Import/paste usability with a real GRM backup; verify counts and omissions before import,
  private-note access changes and archive recovery on the client.
- Classic rank/localized aura matching, party-only effects, Mists alternatives, Retail
  hidden/secret data and Forever custom spells/names; English/French addon layout.
- Previously recorded dungeon, benchmark calibration and multi-client acceptance remain
  pending. No offline test certifies those game behaviors.

Final combined validation and package evidence are appended below after completion.

## Final local verification

- Complete suite: **292 files / 2,491 tests passed** in 143.10 seconds with two
  workers and 20-second test timeouts. Log: `backups/local-roster-grm-buffs-full.log`.
- Final TypeScript, ESLint, Guilded/Guilded Dungeons static validators and generated
  buff-catalog synchronization check passed. The browser companion build passed.
- Ten local edition ZIPs regenerated and checked against their manifest and current
  feature module bytes: `backups/local-review-2026-10-25/manifest.json`.
- Windows companion **unpacked** build succeeded under
  `backups/local-review-2026-10-25/companion/win-unpacked/`. Its ASAR and engine files
  match source. The packaged converter parsed a synthetic backup successfully;
  the actual CLI created a new archive and refused an existing destination without
  modifying either file. The companion executable was not launched or installed.
- The unpacked build shares the installed companion's app identity. Close the installed
  companion before manually reviewing it; this task did not change its account settings.
- French synthetic preview: `http://127.0.0.1:8804/?tab=wow&lang=fr`. The page exercises
  only the form and renders a clearly labelled fixture result, without file reads/writes.
  The native-dialog tests cover actual converter integration and cancellation semantics.
- Forever team preview: `http://127.0.0.1:8803/me/teams?guild=demo-forever&edition=forever&core=demo-team&lang=fr`.
  Full names, the provisional notice and eight families are visible; the benched priest
  does not count as a Fortitude provider.
- Claude left an explicit note in the shared coordination record identifying walkthrough
  PR #222 and raid-loot PR #223 as separate, unmerged work and asking that his tracked
  checkout remain untouched. That request was respected; only the handoff file was updated.

All source remains uncommitted on `main` at `a6466dd`. Review, intentional versioning and
publication are separate future steps; the latest owner instruction keeps this work local.
