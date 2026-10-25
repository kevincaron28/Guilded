> **25 October release decision:** the owner explicitly authorized publication before
> the unavailable game/two-PC tests. Earlier hold instructions below are superseded.
> Tests remain pending follow-up, not passes; targets remain provisional. See
> [release decision](RELEASE_DECISION_2026-10-25.md) and [current notes](V7_3_2_RELEASE_NOTES.md).

# Guilded multi-edition port — 25 October 2026

## Scope and status

The connected candidate covers Forever, Classic Era/Hardcore, TBC Anniversary,
Mists progression Classic, and Retail. One Discord server can contain multiple
in-game guilds, including multiple guilds in the same edition. This is version
7.3.2 candidate / protocol 2, on `codex/game-editions` in draft PR #216, stacked
on #215 and #214. It is not a public release or a production deployment.

The previous foundation-only limitation has been removed: edition selection,
guild sync, bot workflows and native/browser companion profiles are implemented.
Game acceptance and calibrated dungeon competitions remain explicit release gates.

## Implemented

- `/wow add`, `/wow list`, `/wow use`, `/wow channel`, and `/wow roles` configure
  independent in-game guilds. Each gets its own Guild ID, settings, members,
  character links, raids, cores, loot, ledger, imports and companion credentials.
- Existing Forever records stay in the `default` guild. Migration retains their
  IDs, history and credentials. Shared community and PoE commands use that default.
- Saved channel/category bindings take precedence over personal selection.
  Existing setup/core channels resolve their owning guild. Raid, application,
  dungeon-group, poll and craft buttons retain their entity's guild.
- Permissions use separate role IDs per child guild, including class leaders.
  Optional member roles restrict access. Companion requests re-fetch Discord
  membership and roles. Credentials choose the guild; request parameters cannot
  override it. Setup creates separate channels and roles. Child uninstall/reset
  stays within that guild; deleting the default is refused while child guilds exist.
- Character identity includes guild, edition, realm and name. Blizzard references
  retain realm-qualified names through addon messages, ledgers, raid exports and
  imports. Pickers reject ambiguous bare names. Forever retains legacy accounting
  keys and authentic first/last display names across addon, companion and bot.
- Public runs, characters, player cards, caches, season calendars, frozen rules,
  recruitment and leaderboards are separated by edition. Site selectors and links
  retain the edition. Other guilds in the same Discord can appear on raid boards.
- Raid readiness uses level 60 for Forever/Era, 70 for TBC and 90 for Mists/Retail.
  Raid presets are filtered by edition; Retail supports flexible 10–30-player
  rosters and cross-realm signups (unless a core explicitly restricts its realm).
  Enchant slots are client-specific. Attunements remain configured quest/reputation
  checks; no unverified quest IDs are supplied.
- Native and browser companions save separate connection profiles with credentials
  and file/folder selections. Switching stops the old connection and clears its
  upload acknowledgements and state. Legacy settings become Original connection.
- Wrong-edition uploads are rejected before character linking, ledger or import
  writes. Native/browser companions show the conflict as an error, not a duplicate.
- `npm run addon:editions` builds ten ZIPs: Guilded and Guilded Dungeons for all
  five targets. Each has one interface target, an edition label, no guild standings,
  parsed Lua, checked TOC contents, and a SHA-256 entry in the manifest.
- The Windows companion includes the edition and profile modules. CI packages
  the same source and rehearses PostgreSQL migration, isolation and dump/restore.
- Retail Mythic+ keeps the native challenge map, key level, affixes, millisecond
  timer, time limit, in-time status and practice/score eligibility through reloads,
  peer summaries, both companions, guild imports and public uploads. Conflicting
  native results dispute the public run. `/dungeon keystones` and the Retail public
  leaderboard rank each character's highest in-time key, then official time,
  separately by dungeon and affix set. They require 80% wall-time presence and
  exclude practice, overtime, simulations and missing native evidence. They do
  not manufacture Blizzard rating points or mix keys into ordinary fastest clears.
  A separate, explicitly provisional Guilded rating now sums each character's best
  dungeon scores using Raider.IO-inspired bases and a documented Guilded speed bonus.
- Result cards show native key/time data and authentic Forever full names.
  Non-Forever cards never estimate a score from Forever's local target table.

## Configure a server after deploying the candidate

1. Keep the existing Forever setup as `default`. For each additional guild, an
   administrator runs `/wow add edition:<edition> name:<guild> realm:<realm>`.
   Choose its officer role and, if access should be restricted, member role.
2. Copy its ID from `/wow list`. Select it with `/wow use guild:<id>` or bind a
   dedicated channel/category using `/wow channel guild:<id> channel:<channel>`.
   Bindings override personal choices. An officer cannot take over another
   guild's configured channel without authority in that guild; admins can reassign.
3. Run `/setup start` in that guild's context. Assign its generated roles and
   review Discord Settings > Integrations visibility for officer/leader commands.
   Role labels include the guild name; authorization follows the stored IDs.
4. Link characters or run `/character pair` in the same context. Prefer addon
   capture or import so edition, realm and Forever surnames come from the client.
5. In the companion's connection selector, add a named connection for each guild.
   Sign in with Discord and select the exact guild/edition, or use its pairing
   code. Select that edition's own saved file and addon folder. Save and connect.
   Only the selected connection syncs. Keep PoE on the original shared profile.
6. Switch connections to change edition/guild. Never copy credentials between
   profiles. For two guilds in one client, select each guild's relevant character
   data/files and confirm its guild filter before uploading.

## Dungeon competition and completion limits

Runs and activity can be imported for every edition. Forever's rules are preserved.
The candidate now includes 135 source-reviewed provisional routes across Era, TBC,
Mists and Retail, plus the eight-map Retail Midnight Season 2 keystone rating pool.
Details, sources, benchmark policy and client acceptance are in
`DUNGEON_CATALOG_2026-10-25.md`. NPC-only Classic completion evidence is transported
through both addons and companions without confusing NPC and encounter IDs.

Generate ready-to-import files with `npx tsx scripts/export-edition-rules.ts`.
The bot owner can schedule `/guilded-season next edition:<edition>`, then attach
`dist/edition-rules/<edition>.json` with `/guilded-season rules edition:<edition> file:<json>`.
The command can replace only a future season. Existing frozen targets stay fixed;
provisional recalibrations apply prospectively. Old snapshots without a keystone
rating never gain one retroactively. Source review is not real-client verification.

Retail challenges wait for `CHALLENGE_MODE_COMPLETED`; killing the final boss
alone does not finish the run. Challenge resets/restarts produce separate attempts.
The keystone leaderboard described above uses native completion evidence. Missing
or restricted APIs leave an activity record, without guessing a ranked result.
Ordinary calibrated dungeon ratings remain separate. Guilded does not claim to
reproduce Blizzard's seasonal Mythic+ rating formula. Native challenge ranking
has automated coverage but still needs real-client acceptance. The API contract
and millisecond timer were checked against Blizzard's generated documentation/UI:
https://github.com/tomrus88/BlizzardInterfaceCode/blob/master/Interface/AddOns/Blizzard_APIDocumentationGenerated/ChallengeModeInfoDocumentation.lua
https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_ChallengesUI/Mainline/Blizzard_ChallengesUI.lua

Migration `20261125150000_challenge_evidence` adds nullable public native evidence;
historical rows retain their existing scores. Guild native evidence lives in the
existing competition JSON. Public and private keystone boards keep edition,
guild, season, member and visibility restrictions.

## Build and test evidence

- Latest full local regression run: 279 files / 2,357 tests passed
  (`backups/port-catalog-final-suite.log`). New HTTP tests cover concurrent guild contexts,
  role revocation, wrong-server credentials and wrong-edition rejection before writes.
- Catalog tests resolve and score all 135 routes, reject missing checkpoints and wrong
  difficulties, preserve frozen rules, and cover NPC transport and keystone aggregation.
- TypeScript, ESLint, both addon validators and Worker dry-run build passed; shared
  standalone Lua was regenerated. Native challenge tests cover wall/native clocks,
  reload/peer export, malformed/restricted/mismatched evidence, realm/affix separation,
  public disputes, guild-scoped queries and English/French result presentation.
  The final source commit and CI run are recorded in PR #216 and the artifact
  validation file; earlier green CI on `dde4707` predates native challenge support.
- The Windows installer built successfully. Final packages are rebuilt after commit
  so source revision and package hashes are reviewable.
- PostgreSQL rehearsal now provisions six guild contexts in one server (all editions
  plus a second Retail guild), uses identical character names in each, verifies
  separate settings/credentials, rejects wrong-edition characters and duplicates,
  then verifies everything after dump/restore. It runs in CI's disposable database.
- Local tests use a deliberately unreachable test DATABASE_URL; no test suite should
  use the production credentials in `.env.local`.

## Artifacts and release gates

Candidate ZIPs: `dist/editions/Guilded-v7.3.2-<edition>.zip` and
`dist/editions/GuildedDungeons-v7.3.2-<edition>.zip`.
Source revision, dirty flag, interfaces and hashes: `dist/editions/manifest.json`.
Native installer: `dist/companion/Guilded Companion Setup 7.3.2.exe`.

Packaging baselines are Forever 16001, Era 11500, TBC 20506, Mists 50500 and Retail
120105. They do not certify the installed client's current Interface number.
Supply an observed value with `npm run addon:editions -- --interface=classic-era:<number>`.
The builder rejects an interface from a different edition.

Before public promotion:

1. Both exact-head quality jobs must pass, including disposable PostgreSQL
   migration/dump/restore and Windows packaging.
2. Observe each target's actual GetBuildInfo interface and package that interface.
   Test login, reload, messages, full names/realm identities, professions/readiness,
   loot/raid sync, companion upload and acknowledgements in each real client.
   Test Retail restricted values during combat and Classic missing APIs.
3. Complete the existing two-PC/native/French checklist in
   `V7_3_2_GAME_CHECKLIST.md`. Add mixed-edition same-Discord permission tests,
   same-name/different-realm characters, channel selection, pairing and profile switches.
4. Confirm the prepared Classic/Retail endpoints and calibrate provisional benchmarks in game.
   Validate complete, partial, reset, duplicate, wipe and disbanded runs against
   each target; verify native key, affixes, official timer and in-time/practice flags
   against the Retail client. Mists challenge activity has no Retail keystone ranking.
5. Rehearse deployment with a fresh backup, then deploy migrations and matching bot,
   companion and addons together. Record exact commit, hashes, build, language,
   testers and results. Publish only accepted assets and then update public metadata.

The local directory contained Forever 1.60.1.70532 and Retail 12.1.5.70575; no
installed Era/progression target was found. Those are filesystem observations,
not game tests. Forever's beta is closed until the recorded November launch.
No game acceptance result is invented. No production migration, public asset
publication, installed companion replacement or live bot restart occurred here.
See `LAUNCH_READINESS_2026-10-24.md` for the existing deployment/public-release hold.
