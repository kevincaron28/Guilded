# Local feature review — 25 October 2026

**Superseded status:** the [integrated continuation](LOCAL_FEATURE_COMPLETION_2026-10-25.md)
adds the next features and integrates Claude's `816c7af` locally. The implementation
and test counts below describe the earlier bundle; use the continuation for current
validation, packages and remaining scope.

Kevin authorized continued implementation while away, with everything kept local
for review. This bundle is uncommitted and unshipped, based on `a6466dd` (7.3.2,
protocol 2). No version bump, database migration, production bot login, Discord
fixture changes, upload, release replacement or deployment was performed.

## Ready to review locally

| Feature | Implemented behavior | Surface |
| --- | --- | --- |
| Roster dashboard | Name/realm, class, race, profession, main/alt/unclaimed and level filters; separate character/member counts; unknowns, freshness, pagination and filtered CSV | `/me/roster` |
| Crafter lookup | Item name, item ID, item hyperlink and enchant spell-ID lookup; full names/realms; scan timestamps and stale labels | `/me/crafters` |
| Raid teams | Existing core schedules, configured role vacancies, independent trial/bench state, selected characters, mains and backups | `/me/teams` |
| Character history | Linked characters and member-wide attendance, loot and EP/GP history; raid-team attribution when recorded | `/me/history` from character links |
| Group posts | Existing open Discord guild groups, title/role-vacancy filters and original signup links | `/me/groups` |
| Main/alt review | CSV before/after plan; unknown/unlinked characters, realms, duplicates, and exactly-one-main checks; no apply endpoint | `/me/roster/review` |
| GRM review input | Narrow English current-member export: only Name, Main/Alt, Realm Name, comma-delimited with headers; unset status remains unknown | Same review page; maximum 50 rows |
| Availability | Explicit sharing and observation consent, manual role/free/busy/away, instance-busy detection, combat pause, expiring reports, full sender display names | Addon Guild tools → Availability; `/guilded free` |
| Activity heatmap | 7 × 24 UTC cells, sampled averages and tooltip counts; unobserved hours remain unknown; numeric copy view | Addon Availability |
| Retail owned keys | Separately enabled owned-key sharing, map/level display, missing/secret API values handled as unknown; no Classic/Forever Mythic Plus calls | Availability on Retail only |

The web views retain current officer authorization: an active Guilded membership,
fresh Discord role check and selected in-game guild/edition scope, including
several guilds on one Discord server. There is no automatic refresh loop.
Pages are private/no-store/noindex, with bounded field selections and generic
load errors. Officer notes, ledger reasons, credentials and Discord member IDs
are not exposed by the new data views. A partial roster cannot be exported or
used for a main/alt plan. POST previews require same-origin session CSRF checks.
International CSV names fit the dedicated bounded form limit; other forms keep
their previous limit. CSV is parsed as data and never executed.

Queries are bounded to 1,000 roster records; 200 recipe results; 50 teams with
80 displayed members per team; 100 records per history category; and 100 group
posts. Sample/partial notices explain truncation. Team counts are roster roles,
not inferred spell/buff coverage. History belongs to the linked member; an alt
is not falsely credited as the played character when the source lacks that fact.

## Availability, load and privacy

Sharing, local observation and Retail key sharing start off. Roles are manually
declared; this feature neither invites players nor creates native finder groups.
Reports use the existing paced addon channel, normally once per 30 seconds and
at least five seconds apart for changed status/consent. Reports pause in combat.
Peers expire after 90 seconds, including after disconnect, zoning or disable.
Only game-provided senders on the GUILD channel are accepted, with protocol and
edition checks and bounded payloads/peer count. Guild/edition changes clear the
in-memory peer list. Key details are memory-only and expire with the report.

Local observation runs at most once every five minutes, including across reloads.
It counts fresh opt-in character reports, not unique players or a complete guild
census. Its own character counts only when sharing is enabled. No offline gaps
are filled in. A sampled zero is distinct from an unobserved cell. Data is retained
for 28 days, with at most ten recent guild/edition contexts per character.

Consent and hourly aggregates use `GuildedPresenceDB` in
`SavedVariablesPerCharacter`, outside the account-level `GuildedDB` file read by
the companion. Aggregates contain counts and sample times, not player names,
individual histories, notes, positions or keys. Guild backups, ledger sync and
companion uploads do not include this separate store. Turning observation off
stops collection; Clear observations deletes the local aggregates. Sharing may
continue independently if explicitly enabled.

Useful commands:

```text
/guilded free share on|off
/guilded free observe on|off
/guilded free status free|busy|away
/guilded free role any|tank|healer|dps
/guilded free keys on|off          (Retail only; separate opt-in)
/guilded free activity             (copy numeric UTC observations)
/guilded free clear
```

## Offline preview

Run `npx tsx backups/preview-roster-dashboard.ts` if the existing preview is no
longer running. It binds only `127.0.0.1:8803` and uses invented characters in
Silver Lantern (demo), with no real account, bot, database or Discord connection.
Open `http://127.0.0.1:8803/me/roster?guild=demo-forever&edition=forever&lang=fr`
and follow the guild-tool links. This fixture server is not a production auth
test or a substitute for real-client checks. The source routes use production
authorization; tests exercise denials, demotion and edition isolation.

Browser checks completed: crafter item-ID lookup, stale labels, full Forever
names and separate Retail single names, language-switch filter preservation,
team trial/bench details, linked member history, group-role empty states, and
Guilded/GRM main-switch previews that leave the roster unchanged.
The review page fits the narrow desktop preview pane; tables scroll internally.

## Coordination with Claude

Claude's separate worktree is `C:/Users/Kev/Desktop/qgb-claude-fixes` on
`claude/walkthrough-fixes`. Its walkthrough fixes are now commit `816c7af`:
command acknowledgement/timeouts, raid-time handling and waitlist promotion.
Those command/raid/core files were inspected for overlap but not modified or
copied into this feature checkout. The local handoff is
`CODEX_LOCAL_REVIEW_HANDOFF.md` in that worktree, with the detailed shared record
in `backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md`. Receipt has not been confirmed.
The feature checkout has no file overlap with that commit; combined integration
and release verification should use both reviewed sets of changes later.

## Source review and remaining work

Retail key API signatures were checked against Blizzard's generated API source
in the [WoW UI source mirror](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/MythicPlusInfoDocumentation.lua),
with map labels from
[ChallengeModeInfoDocumentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ChallengeModeInfoDocumentation.lua).
The guarded APIs return owned challenge-map ID/level; they may return no value.
This is source verification, not a Retail client test.

The limited GRM input follows the upstream
[GRM export implementation](https://github.com/TheGeneticsGuy/Guild-Roster-Manager/blob/Retail/GRM_Export.lua).
It accepts only the documented three-column English export shape. It does not
import GRM SavedVariables, private notes, rank history, GUIDs, bans, account links
or arbitrary locale/delimiter combinations. Existing Guilded ownership must
already be established; GRM character grouping is not treated as Discord identity.

Still outside this completed local bundle:

- Real Forever/Classic/Retail checks: sender names, instance and combat transitions,
  message delivery/expiry, key detection, French layouts and per-character storage.
- Automated rank/note/kick actions and migration of GRM history. The review tool
  intentionally has no execution path; implementing these needs a separately
  specified audit/recovery and authorization workflow.
- Native Blizzard finder integration and raid buff coverage. The prior finder
  removal and retired raid-tools scope remain in force; this bundle does not
  reintroduce them under another name.
- Public/member-level web access or upload of availability history. Current pages
  retain officer scope; the addon observation store stays local.
- Production packaging/versioning, combined CI with Claude's fixes, approval and
  deployment after local review. Existing published downloads are untouched.

## Validation

- TypeScript: `npx tsc --noEmit -p .` passed.
- ESLint: `npx eslint .` passed.
- Both addon static validators passed, including Lua 5.1 syntax and shared-file
  synchronization; the shared locale was synced with `npm run dungeons:sync`.
- Final full suite: `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=20000`
  passed **285 files / 2,421 tests** in 153.90 seconds. Log:
  `backups/local-feature-bundle-vitest-reviewed.log`.
- New-feature coverage: 12 roster tests, 11 guild-tool tests, 14 real-Lua
  availability tests and 9 main/alt review tests. Existing French/window checks
  also pass. Test fixtures use invented data; no real-client, production database
  or two-PC pass is claimed.
- The earlier fork-pool image-test timeout remains recorded in the first-dashboard
  review. No image code or test assertions were changed to obtain these passes.
- `git diff --check` passed. Source and docs remain uncommitted; no CI, merge,
  deploy, package publication or live Discord test was run in this local pass.
