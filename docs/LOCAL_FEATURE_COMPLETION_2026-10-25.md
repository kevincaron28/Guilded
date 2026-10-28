> Historical implementation checkpoint. Delivered features are included in the published 8.0 release; original local/draft/version statements below describe that earlier stage. See [the current final audit](FINAL_LAUNCH_AUDIT_2026-10-28.md) for boundaries and remaining evidence.

> Updated continuation: [roster bulk actions, GRM migration and edition buff coverage](LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md) now implements the three areas listed as deferred below. This document records the earlier bundle and its earlier validation.

# Integrated local feature candidate — 25 October 2026

This is the current continuation of [the first local bundle](LOCAL_FEATURE_BUNDLE_2026-10-25.md).
Kevin explicitly requested continued implementation and integration of Claude's
fixes, with all changes kept local for review. HEAD remains `a6466dd`; changes
are uncommitted. Published 7.3.2 files, production services and live Discord
messages have not been changed by this work. No database migration is needed.

## Claude integration

Applied the complete diff of Claude's commit
`816c7afa9dcf7186f8b8e5b5256619e870f3231e` after `git apply --check` succeeded.
The command/raid/core files did not overlap the local feature edits. Integration
is in the working tree, not a cherry-pick or merge. Claude's separate source
checkout remains unchanged; its local handoff file records the integration.

Included fixes: acknowledge slow raid commands before Discord work; respect
deferred EP replies; promote waitlisted members when role/Maybe changes free a
slot; use server display names; parse the time before an arrow; recognize English
and French core-channel names during rename/uninstall; localize size confirmation;
enable weekly reports when setup chooses a report channel.

Coordination records: `backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md` and
`C:/Users/Kev/Desktop/qgb-claude-fixes/CODEX_LOCAL_REVIEW_HANDOFF.md`. The observed
Claude branch still ends at `816c7af`. A written handoff is not confirmation that
Claude has read it. No duplicate live bot or Discord test was started.

## Additional features completed locally

| Feature | Behavior and boundary |
| --- | --- |
| Availability filters | Filter fresh reports by full name, declared role, free status and minimum shared Retail key. Filters affect the view, not observation totals or message frequency. |
| Recorded characters | Copy this installation's existing characters for the active guild and edition, with full Forever display names and capture dates. This does not claim live alts or another sender's account ownership. |
| Blizzard finder shortcut | Availability button and `/guilded finder` open the existing native finder when supported and usable. Unsupported clients receive an explanation. Combat/API checks run before opening. No queueing, invitations, signup automation or duplicate finder UI. |
| Profession-window lookup | A Guilded crafters button attaches once to loaded modern/legacy profession windows. It reads the selected output item or enchant spell, then uses the existing guild recipe lookup. Missing selection falls back to Guilded's Crafting search. Creation and actions are deferred/blocked in combat. |
| Forever crafter names | Recipe results, item tooltips and cooldowns display the known first and last name while preserving existing identity keys. Blizzard realm disambiguation remains intact. |
| Team composition | Selected teams show class counts and assigned character names. Trials count; bench, backups and unassigned linked mains do not. Duplicate assignments and unknown classes are explicit. |
| Retail buff planning | Shows potential class providers from the existing Retail buff catalog. Incomplete rosters cannot claim a missing provider. This is planning, not evidence of learned spells or active auras. |
| Readiness edition correction | Classic/Forever no longer inherit Retail's buff requirements. Unsupported buff coverage stays unknown; existing food/flask/readiness checks continue. Class composition remains available across all editions. |
| Broader GRM review | Exact English three-column current-member exports support comma, semicolon, tilde, double-colon, double-pipe, literal backslash-t or actual tab delimiters. Header detection is allowlisted; private-note and extra columns remain rejected. |
| Review receipts | Download a JSON before/after main/alt receipt containing guild/edition, timestamp, proposed changes and conflicts. Access, CSRF and the current complete roster are revalidated on download. It records `applied: false` and cannot be executed/imported as authority. |

New strings and team class labels have French translations. The separate Guilded Dungeons locale copy
was regenerated. Existing privacy and guild/edition authorization boundaries from
the first bundle remain: no automatic web refresh, no presence history upload,
no new account linking, no access granted to ordinary members by these pages.

## Local review outputs

- Browser: `http://127.0.0.1:8803/me/roster?guild=demo-forever&edition=forever&lang=fr`.
  This is an invented-data fixture only. Teams and review pages are linked there.
- Addons: `backups/local-review-2026-10-25/`, ten ZIPs for Guilded and Guilded
  Dungeons across Forever, Classic Era, Classic TBC, Classic Mists and Retail.
- `manifest.json` records the base commit, dirty candidate status, Claude commit,
  interfaces, package sizes and SHA-256 hashes. Every ZIP is labelled LOCAL-REVIEW
  and contains `LOCAL_REVIEW.txt`. Published release ZIPs were not overwritten.
- Source version remains 7.3.2 intentionally; these are **not** the published
  7.3.2 bytes. Choose a new version only after reviewing this candidate.
- Companion logic did not require new changes for these views; the existing
  edition-specific uploads supply their data. This is not a new installer release.

## Verification

Focused integration: Claude's 44 raid/core/time tests passed. The expanded feature
selection passed 104 tests; the final client/window follow-up passed 31 tests.
Final stable-source verification:

- `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=20000`: **287 files /
  2,441 tests passed**, 132.94 seconds. Log: `backups/local-integrated-feature-reviewed.log`.
- `npx tsc --noEmit -p .`: passed.
- `npx eslint .`: passed.
- `node addon/Guilded/validate-addon.mjs`: Guilded and Guilded Dungeons passed.
- `git diff --check`: passed (Git reports expected CRLF normalization notices).
- All 15 integrated files match Claude's `816c7af` contents after line-ending
  normalization. Claude's branch was rechecked and has no newer commit.
- All ten review ZIP hashes match their manifest. New/changed candidate Lua
  modules in the five Guilded ZIPs match the final source bytes.

An intermediate suite ran while the French class normalization change was in
progress and failed that new test. Its log is preserved in
`backups/local-integrated-feature-suite-final.log`; it is not the final validation.
The stable-source run above passes that test and the entire combined suite.

Browser verification used invented data: French Retail team composition counts
the mage and trial warrior, excludes the benched priest, and displays potential
providers; a semicolon-delimited Forever main switch preserves full names and
shows two proposed changes with nothing saved. The review receipt control is
visible; its download/access/conflict semantics are tested through the route.
The narrow preview layout was visually checked.

Source review:

- Native finder calls follow Blizzard's
  [PVE frame source](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_GroupFinder/Mainline/PVEFrame.lua).
- Modern selection reads the schematic form shown in Blizzard's
  [profession crafting source](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_Professions/Blizzard_ProfessionsCrafting.lua).
  Legacy lookup uses the selected-item APIs already used by Guilded and the
  [Classic profession window](https://github.com/Gethe/wow-ui-source/blob/classic_era/Interface/AddOns/Blizzard_TradeSkillUI/Vanilla/Blizzard_TradeSkillUI.lua).
- Delimiters and the limited header contract follow the
  [upstream GRM exporter](https://github.com/TheGeneticsGuy/Guild-Roster-Manager/blob/Retail/GRM_Export.lua).
- Retail planning uses Guilded's existing `ConsumableData.lua` catalog. It is not
  presented as a Classic or custom Forever spell catalog.

## Remaining acceptance and scope

Game-dependent acceptance: actual per-edition installation/load; protected-frame
and combat behavior; native finder availability; profession selection on each
client; Forever sender names; guild changes; opt-in packet delivery/expiry; key
API values; French layout; saved variables across reloads; two-client sync and
the previously recorded dungeon/benchmark checks. Static Lua and mocked APIs
cannot certify these. Provisional dungeon benchmarks still require calibration.

The broader candidate list also contains ideas that are **not completed features**:
automated rank/note/kick batches, wholesale GRM history migration, arbitrary
localized GRM formats and verified Classic/Forever buff-coverage catalogs.
This candidate provides a bounded main/alt review workflow, not those mutation or
migration systems. Public availability dashboards and uploaded activity history
are not enabled. The removed raid-leader tools remain in Pullscript's scope.

Release work remains local review, any requested revisions, intentional versioning,
CI and publication. Do not treat this record as deployment authorization.
