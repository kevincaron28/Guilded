# Forever-only removal plan

Status: **7 November 2026: phase 2 under way.** Merged: stage 1 (addons, #567), stage 2 (packaging,
#568), stage 3 (companion, #571), stage 4a (bot: Retail keystones, Battle.net discovery, other editions' dungeon
rules and calendars, #573), stage 4b (bot commands, labels and rules, #577). Stage 5 (website, Worker and the
bot's web filters) is the next PR; then stages 6, 7 and 8. The staged
PRs run one at a time, each from `origin/main` with the four checks in CLAUDE.md passing. No version bump in any of them.

Change while building (7 November): the shared data sources `companion/dungeon-catalog.mjs` and
`companion/raid-buffs.mjs`, `scripts/prepare-dungeon-catalog.py`, the launch-timing and calendar
scripts and `scripts/export-edition-rules.ts` moved from stage 2 to stage 4. The bot's per-edition
dungeon rules (`dungeon-edition-catalog.ts`, `public-score.ts`, `dungeon-launch-timings.ts`), the Retail
keystone rating and team composition read them, so they go in the same PR as that bot code. The addon
already ships Forever rows only (stage 1). The edition plumbing in `companion/character-identity.mjs`,
`lua-export-content.mjs` and `personal-runs-content.mjs` moves to stage 6, where `GAME_EDITIONS` narrows.

Owner request (7 November 2026): "Remove other versions of WoW from the code and references
everywhere. We only develop for the WoW Forever edition."

Today the other editions (Classic Era/Hardcore `classic-era`, TBC Anniversary `classic-tbc`, Mists
Classic `classic-mists`, Retail `retail`) are **hidden, not deleted**
([FOREVER_ONLY_FOCUS.md](../FOREVER_ONLY_FOCUS.md)): one switch, `ACTIVE_EDITIONS = ["forever"]` in
`companion/active-editions.mjs`, and tests that prove every surface follows it. This plan replaces
"hidden behind a switch" with "gone", without breaking stored data.

Scope is WoW editions only. PoE2 (`companion/active-games.mjs`) is a separate switch and is **not**
part of this work.

## Ground rules for every stage

1. **Data stays readable.** No Prisma column is dropped and no stored value is rewritten in stages
   1-6. `gameEdition` columns keep their `"forever"` default and their place in unique keys and
   indexes. Rows for other editions (if any exist) stay in the database, unread. Only stage 7 may
   touch data, and only after a read-only count and the owner's yes.
2. **Old SavedVariables stay loadable.** The addon keeps reading the `guildEdition` root key and
   `edition@guildKey` entries in `otherGuilds` (Core.lua `storageKey`), and old `gameEdition` /
   `interface` fields in exported runs. It just never writes a non-Forever value again.
3. **Old uploads get a clear answer, not a crash.** The bot keeps parsing `gameEdition` and
   `interface` in uploads and API calls. Missing means Forever (as today). Any other edition is
   refused with one plain message ("Guilded supports WoW Forever only"), never silently stored as
   Forever.
4. **Published files are never touched.** Edition zips already on GitHub/CurseForge stay as they are
   (CLAUDE.md: never overwrite a published download).
5. **Discord channels and roles are not deleted** (owner decision in FOREVER_ONLY_FOCUS.md stands).
6. **Edition calendars** ([EDITION_CALENDARS_2026-10-30.md](../archive/EDITION_CALENDARS_2026-10-30.md)): the
   `OfficialSeason` rows for other editions stay unchanged in the database; only the code that reads,
   initializes or edits them goes. That keeps the CLAUDE.md rule "keep selected edition calendars
   unchanged" true. The CLAUDE.md line itself is reworded in stage 8.
7. **Before each stage:** `git grep` the stage's patterns again on fresh `origin/main` (other
   sessions add edition code daily) and update the file list in the PR description.

The grep used for this inventory (outside `docs/archive/` and migrations):

```
git grep -n -iE "classic-era|classic-tbc|classic-mists|\"retail\"|'retail'|ACTIVE_EDITIONS|GAME_EDITIONS|gameEdition|heldEditions|isFolderOnHold|isEditionActive|activeEditions|WOW_PROJECT_ID|_retail_|_anniversary_"
```

It matched about 230 source files plus 78 test files on `origin/main` 5efeb629 (7 Nov).

## The one decision the owner must make first

**Battle.net character discovery has no Forever support.** `src/services/battlenet.ts` only knows
`BNET_EDITIONS = ["retail", "classic-era", "classic-tbc", "classic-mists"]` (Blizzard profile
namespaces), and its page says "Forever discovery is not enabled until its API is verified"
(`docs/BATTLENET_SETUP.md`). Removing the other editions therefore removes everything Battle.net
discovery can find. Options:

- **A (recommended): remove Battle.net discovery and autolink** (`battlenet*.ts`, `/me/battlenet`
  pages, `battlenet-autolink*`, `scripts/verify-battlenet-postgres.ts`, their tests, the setup doc),
  keeping the `BattleNetCharacter` table and the `BATTLENET_CLIENT_*` config keys readable, and keeping
  Sign in with Discord as the only web sign-in. Bring it back if Blizzard ever ships a Forever profile
  namespace.
- **B: keep it as dead code** behind the existing "not enabled" message until a Forever namespace is
  verified. Smaller change, but contradicts "remove everywhere".

Stage 4 is written for option A; with option B it skips the Battle.net files.

## Stages (one PR each, in this order)

The order puts the edition model last, so every earlier stage can still compile against
`GameEdition` while it deletes callers. Each stage lists **delete** (safe to remove), **keep** (data
compatibility) and **tests**.

### Stage 1: addons (`addon/Guilded`, `addon/GuildedDungeons`)

Delete:
- Both `.toc` files: `## Interface: 16001, 11509, 20506, 50504, 120105` becomes `## Interface: 16001`.
  After release the addon shows as "out of date" on other clients instead of loading.
- `Util.lua` (both addons): `util.gameEdition()` interface ranges for the four other editions; keep the
  function, returning `"forever"` for 16001 and `nil` otherwise (an unknown client), so callers and the
  validator keep working. `isForever()` stays.
- Every `gameEdition() == "retail" / "classic-*"` branch, collapsing to the Forever path:
  `Compat.lua` (C_ChallengeMode keystone reads, instance 189 classic-era/tbc clause),
  `Core.lua` 1154-1166 (enchant level and other per-edition defaults), `Modules/Presence.lua`
  (Retail keystone sharing, `C_MythicPlus`), `Modules/Battleground.lua` (`EDITIONS`,
  `HARDCORE_EDITIONS` tables), `Modules/ConsumableData.lua` (Retail raid buffs), `Modules/Ready.lua`
  (Retail providers), `Modules/Minimap.lua` (two Retail branches), `Modules/Milestones.lua`
  (`EDITION_CAP` → constant 60), `Modules/Loot.lua` (pricing edition check), `Modules/RunResults.lua`
  ("Check your edition's leaderboard"), `Modules/DungeonScorePanel.lua` (Retail score panel),
  `Modules/Dungeon.lua` (Retail challenge fields, the classic-only branch at 893), `Modules/RosterTools.lua`,
  `Modules/ClientTools.lua`, and the same files under `GuildedDungeons/Shared/`.
- `DungeonRoutes.lua` (both copies): the 135 rows with `edition="classic-era|classic-tbc|classic-mists|retail"`.
  Forever routes stay. Regenerate from `companion/dungeon-catalog.mjs` (stage 2) rather than hand-editing
  if the generator is the source.
- `Modules/RaidBuffCatalog.lua`: the `classic-era`, `classic-tbc`, `classic-mists` and `retail` catalogs.
  The Forever catalog stays (it is provisional and copies Classic Era spell ids, which is fine: it is
  Forever's own entry).
- Locale strings used only by removed branches (check `Locale.lua`, both English and French).
- `addon/Guilded/README.md`, `addon/GuildedDungeons/README.md`: edition lines.

Keep (SavedVariables compatibility):
- `Core.lua` `guildEdition` root key, `KEEP_AT_ROOT`, `storageKey(guildKey, gameEdition)` and the
  `otherGuilds["<edition>@<key>"]` reading, so an old file with parked non-Forever guilds loads and
  keeps them parked. Simplify only the writing side.
- Export fields `gameEdition` and `interface` in snapshots, runs and backups (`Core.lua` 867-905,
  `Modules/Backup.lua`, `Modules/Dungeon.lua` 185): the bot uses them to refuse non-Forever data.
- `Compat.lua` itself (it is the Forever API guard layer, not edition code).

Tests: `tests/lua/` files that set a non-Forever interface (battleground, character-names,
character-spec, client-tools, consumables, core, dungeon-scores, forever-dungeon-recovery, presence,
raid-buff-coverage, ready, roster-tools, run-results): delete the other-edition cases, keep Forever
ones, add one case "unknown interface → nothing edition-specific runs". `harness.ts` default interface
stays 16001. `validate-addon.mjs` (both) if it checks the Interface list.

Risk: Forever fell through to some Classic Era data (instance 189 in Compat.lua, the Forever buff
catalog). Before deleting a `classic-era` branch, check whether `isForever()` also reaches it; if it
does, keep the code and drop only the edition test. The release needs real-client checks on Forever
(owed list in ROADMAP.md).

### Stage 2: packaging and companion data (`scripts/`, `companion/` data files)

Built as: Forever-only `build-addon-editions.mjs` and `verify-edition-zips.mjs` (npm script names kept),
and the empty generated endpoint block in `DungeonRoutes.lua` replaced by a static `routes.sourced = {}`
with `scripts/sync-dungeon-catalog.mjs` and its CI check removed. The rest of this list moved to stages 4
and 6 (see Status).

Delete:
- `scripts/build-addon-editions.mjs`: `EDITION_INTERFACES` loses four entries, `--all-editions` and
  `--interface=<edition>:<n>` for other editions go; build only Forever zips. Rename the npm scripts only
  if nothing (release docs, CI) calls them by name; otherwise keep `addon:editions` /
  `addon:verify-editions` as names.
- `scripts/verify-edition-zips.mjs`: other-edition expectations.
- `companion/dungeon-catalog.mjs` (5,900 lines): the 135 non-Forever dungeon entries;
  `scripts/prepare-dungeon-catalog.py`: other-edition sources. Then regenerate `DungeonRoutes.lua`
  if stage 1 did not.
- `companion/raid-buffs.mjs`, `companion/lua-export-content.mjs`, `companion/personal-runs-content.mjs`,
  `companion/character-identity.mjs`: per-edition tables and branches.
- `scripts/validate-combat-log.mjs`, `scripts/export-edition-rules.ts`,
  `scripts/verify-edition-calendar-initialization.ts`, `scripts/configure-launch-timings.ts`: edition
  parts (delete whole scripts that exist only for other editions).

Tests: `addon-edition-packages.test.ts`, `verify-edition-zips.test.ts`, `dungeon-import.test.ts`,
`tests/lua/dungeon-catalog.test.ts` and catalog snapshot tests.

### Stage 3: companion (`companion/`, `companion-app/`)

Delete:
- `companion/active-editions.mjs`: `heldEditions`, `isFolderOnHold`, `editionList`, `ON_HOLD_NOTE` and
  the switch itself. Keep only `folderEdition()` if detection still needs to tell "this is not a
  Forever folder" (it returns `forever` or `null`; `_classic_era_`, `_anniversary_`, `_retail_` become
  "not Forever, ignored").
- `companion-app/detect-wow.cjs` (`isHeld`, the "only held editions" scan), `companion-app/main.cjs`
  (the `isFolderOnHold` export, the held-files count at ~1157, the "another edition in this folder"
  note at ~439), `companion-app/renderer/app.js` and `index.html` (on-hold note), `companion-app/ipc-security.cjs`.
- `companion/addon-install.mjs`, `companion/live-folder.mjs`, `companion/sync-status.mjs`,
  `companion/presentation.mjs`, `companion/loot-history-import.mjs`, `companion/grm-migration.mjs`,
  `companion/profiles.mjs`, `companion/profile-engine.mjs`, `companion/personal-runs.mjs`: edition
  branches.
- `store-review/handler.mjs` and `store-review/fixture-export.json`, `store-review/Guilded.lua`: the
  Microsoft Store reviewer sandbox answers `gameEdition: 'retail'`. Switch it to `forever`. **Risk:**
  the Store certification depends on this sandbox; change it in a release that is re-submitted anyway,
  and run its test.

Keep: `companion/engine.mjs` still passes `gameEdition` from the saved file to the bot (the bot
refuses non-Forever); saved companion configs with `gameEdition` load unchanged.

Tests: `active-editions.test.ts` (delete), `companion-*` tests, `forever-only-focus.test.ts`
(companion parts), `edition-port.test.ts`.

### Stage 4: bot services and commands (`src/`)

Largest stage; may split into 4a (commands, member-facing text) and 4b (services, rules).

Delete whole files (other editions only):
- `src/services/dungeon-edition-catalog.ts` (`editionDungeonRules` for non-Forever),
  `src/services/initialize-edition-calendars.ts` (`INITIAL_EDITIONS` = the four others),
  `src/services/challenge-guild.ts`, `challenge-leaderboard.ts`, `challenge-rating.ts`,
  `challenge-rating-rules.ts` (Retail keystone / Mythic+ rating; every entry point requires
  `gameEdition === "retail"`), and their callers in `dungeon-rules.ts` (`run.challenge`),
  `dungeon-import.ts`, `dungeon-card.ts`, `dungeon-announce.ts`, `dungeon-rating.ts`.
- Battle.net (option A): `battlenet.ts`, `battlenet-store.ts`, `battlenet-page.ts`,
  `battlenet-autolink.ts`, their routes in `web-app.ts`, `companion-api.ts`, `companion-devices.ts`,
  `member-data.ts`, `character-link-prompt.ts`, `web-loot-lists.ts`.

Collapse to Forever (keep the file):
- `src/commands/wow.ts`: `/wow create` loses its `edition` option (always Forever); the
  "several editions can share this server" wording goes. **Keep** the multi-guild `WowGuild` scopes:
  one Discord server can still host several Forever guilds.
- `src/commands/owner-season.ts`, `src/commands/battleground.ts`, `battleground-record-ui.ts`,
  `roster.ts`, `race.ts`, `uninstall.ts`, `promotion.ts`, `core-planning.ts`, `character.ts`: edition
  choices and labels. Command choice removal changes Discord's command list: re-check
  `tests/commands-shape.test.ts` size limit (it only gets smaller) and French entries in `src/i18n-fr.ts`.
- `src/services/achievements-catalogue.ts`, `achievements.ts`, `achievement-badges.ts`,
  `achievements-web.ts`: `WOW_EDITIONS`, `WOW_LEVEL_CAP`, `PROFESSION_STEPS`, glyph/colour maps →
  Forever only. **Keep** `RETIRED_ACHIEVEMENT_IDS` (members' earned rows stay in the DB and must stay
  hidden).
- `raid-presets.ts` (ERA/TBC/MISTS presets), `world-buffs.ts` (`WORLD_BUFF_EDITIONS`), `dps-kind.ts`
  (Retail Survival/Outlaw rules), `team-composition.ts`, `readiness.ts`, `raid-core.ts`,
  `raid-night-check.ts`, `raid.ts`, `epgp.ts`, `cooperative-goal.ts`, `pug-requests.ts`, `pug-discord.ts`
  (edition labels), `game-events.ts` (`EVENT_GAMES` loses the four `WOW_*` other-edition values for
  **new** boards; **keep** parsing stored values), `official-seasons.ts`, `official-periods.ts`,
  `dungeon-season*.ts`, `dungeon-timing-policy.ts`, `dungeon-november-rules.ts`,
  `dungeon-launch-timings.ts`, `public-runs.ts` (36 hits), `public-leaderboard.ts` (24),
  `public-score.ts`, `public-run-merge.ts`, `player-profiles.ts`, `guild-data.ts`, `guild-directory.ts`,
  `guild-page.ts`, `character-match.ts`, `character-verify.ts`, `character-pairing.ts`,
  `character-import.ts`, `character-autolink.ts`, `addon-import.ts`, `guildmate-relay.ts`,
  `guild-tools-store.ts`, `companion-hub.ts`, `companion-manage.ts`, `web-store.ts`, `roster-*.ts`,
  `duels.ts`, `duel-board.ts`, `bg-ladder.ts`, `battleground-*.ts`, `race-board.ts`, `nickname-sync.ts`,
  `forever-names.ts`, `prelaunch-cleanup.ts`, `simulation.ts`, `promotion.ts`, `site-header.ts`,
  `owner-console.ts`, `diagnostic-privacy.ts`, `self-export.ts`, the rest of the grep list.
- `src/companion-api.ts` (23 hits): edition query parameters accept only `forever` (or absent).
- `src/integrations/addon.ts`: snapshot `gameEdition`/`interface` stay in the schema.

Keep:
- `src/services/game-edition.ts` and `assertSnapshotEdition` (stage 6 narrows the type).
- `src/services/edition-context.ts` until stage 6 (it becomes a constant `"forever"`).
- Every Prisma query's `gameEdition: "forever"` filter. Do **not** drop the filters even though only
  Forever is written: they keep any old non-Forever rows out of Forever boards.

Tests (about 60 bot test files touch editions): delete cases for other editions (challenge-port,
challenge-presentation, challenge-rating-v2, dungeon-edition-catalog, battlenet*, edition-api,
raid-presets, world-buffs, team-composition, public-*), keep and simplify the rest. Add one test per
entry point that a non-Forever upload or API edition is refused with the plain message.

Postgres verify scripts: `scripts/verify-game-editions-postgres.ts` (rewrite as "non-Forever is
refused"), `verify-battlenet-postgres.ts` (delete with option A), `verify-roster-gaps-postgres.ts`,
`verify-season-calendar-postgres.ts`, `verify-raid-pricing-postgres.ts`, `verify-postgres.ts`,
`verify-dungeon-observed-postgres.ts`, `verify-battleground-*.ts`, `verify-public-evidence-postgres.ts`,
`verify-player-directory-postgres.ts`, `link-coverage.ts`.

Deploy note: needs a bot deploy; Discord command list changes on start.

### Stage 5: website and Worker (`site/`, `worker/`, `wrangler.jsonc`)

Delete:
- `site/editions.mjs`: the four other `WOW_EDITIONS` entries (download cards, folder help).
- `site/nav.mjs`: `EDITION_SECTIONS` other than `/forever/`, `editionSection` for them.
- `site/focus.mjs`: `keepPage` edition filter and `ALL_EDITIONS` (`GUILDED_ALL_PAGES` no longer builds
  other editions).
- `scripts/build-site.mjs`: per-edition hub/leaderboard/recruitment/player pages for other editions.
- `site/releases.json`: other-edition entries (they describe already-published files; keep the files,
  drop the listing). `site/creator/index.html`, `site/atelier.css`, `site/README.md` edition bits.
- `site/pages/start*.md`, `site/pages/officers*.md`: edition wording.

Keep:
- `worker/index.mjs`: redirects from `/retail/`, `/classic-era/`, `/tbc/`, `/mists/` (and their
  sub-paths) to the Forever equivalents, so old links and search results still land somewhere. The
  `guilded_edition` cookie can be ignored but reading it must not break.

Tests: `site-editions.test.mjs`, `site-nav.test.ts`, `worker-routing.test.ts` (keep the redirect
cases), `web-availability.test.ts`.

Deploy note: merge triggers the Cloudflare site build; the Worker change needs its own deploy.

### Stage 6: the edition model itself

- `companion/game-edition.mjs`: `GAME_EDITIONS = ["forever"]`; `editionFromInterface` returns
  `"forever"` for 16001 and `null` otherwise; `gameEditionOf` keeps "missing → forever" and throws the
  plain "WoW Forever only" message for any other stated or observed edition. `GameEdition` type becomes
  `"forever"`. Every leftover `Exclude<GameEdition, "forever">` or edition switch then fails to compile,
  which is the checklist for anything stages 1-5 missed.
- `src/services/edition-context.ts`: `currentEdition()` returns `"forever"`; remove `withEdition`
  callers.
- Delete `companion/active-editions.mjs` if stage 3 did not, `docs/FOREVER_ONLY_FOCUS.md` edition
  half (the PoE2 half stays or moves into `docs/archive/`), `tests/forever-only-focus.test.ts` edition
  cases, `tests/active-editions.test.ts`, `tests/game-edition.test.ts` (rewrite for the new rules).
- `mobile/src/api.ts`, `mobile/src/sample.ts`, `mobile/src/api.test.ts`: sample data for other
  editions; keep the `gameEdition`/`edition` fields in the API types (the bot still sends them).

### Stage 7 (optional, owner yes required): data

Read-only first: count rows with `gameEdition <> 'forever'` (and `edition <> 'forever'` on
`CooperativeGoal`, `PugRequest`) in every table listed below, plus `GameEvent`-style rows with
`WOW_CLASSIC_*`/`WOW_RETAIL`, `WowGuild` rows of other editions and their scope `Guild` rows. The
30 October inventory found zero such guilds and runs; `OfficialSeason` rows for other editions were
created then.

Then, only if the owner wants it: archive (pg_dump of those rows to `backups/`) and delete them in one
transaction per table. **Not** recommended for `OfficialSeason` (calendar rule above) or for anything
with a non-zero count the owner has not looked at.

Columns stay. Dropping `gameEdition` would change ten unique keys and indexes for no member-visible
gain; leave it as a constant `"forever"` column.

| Model | Field | In key or index |
| --- | --- | --- |
| Guild | gameEdition (default forever) | no |
| Character | gameEdition | `@@unique([guildId, gameEdition, realm, name])` |
| WowGuild | gameEdition | unique + index |
| OfficialSeason | gameEdition | two uniques |
| UnclaimedCharacter | gameEdition | no |
| BattleNetCharacter | gameEdition | unique (table unused after option A) |
| WebCharacter | gameEdition | unique |
| PlayerCard | gameEdition | unique |
| PublicRun | gameEdition | index |
| WebAvailability | gameEdition | index |
| CooperativeGoal | edition | no |
| BattlegroundReport | gameEdition | index |
| PugRequest | edition | no |
| DuelResult | gameEdition | index |
| MemberMilestone | gameEdition | unique |
| GuildRosterEntry | gameEdition | unique |
| GuildEventEntry | gameEdition | no |

### Stage 8: docs

- Rewrite: `README.md`, `CLAUDE.md` (status line's "Both addons keep Forever, Era, TBC, Mists and
  Retail builds in source", the "Forever-only focus switches" line, the edition calendars rule),
  `ROADMAP.md`, `docs/GETTING_STARTED.md`, `docs/QUICK_START.md`, `docs/MEMBER_INSTALL.md`,
  `docs/AI_SETUP_HELP.md`, `docs/RELEASE_CURSEFORGE.md` (publish one Forever zip per addon),
  `docs/curseforge/*.md`, `docs/store-submission/REVIEWER_NOTES.md` and `listing.json`,
  `docs/ACHIEVEMENTS.md`, `docs/PRIVACY.md`, `docs/LOOT_HISTORY_IMPORT.md`, `docs/PUG_BOARD.md`,
  `docs/ROSTER_AND_AVAILABILITY.md`, `docs/MILESTONES_AND_DUELS.md`, `docs/OWNER_CONSOLE.md`.
- Move to `docs/archive/` (history, not deleted): `docs/EDITION_CALENDARS_2026-10-30.md`,
  `docs/BATTLENET_SETUP.md` (option A), `docs/raid-loot/RAID_PRESETS_BY_EDITION.md`,
  `docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md`, `docs/DUNGEON_SEASON_RATING.md` if Retail-only,
  `docs/FOREVER_ONLY_FOCUS.md` (replace with a short note pointing here).
- Leave release records (`V8_*`) and dated plans as they are: they are history.
- `CHANGELOG.md`: one entry under the next version the coordinator picks.

## Risks

- **Concurrent work.** ~230 files: every stage conflicts with something. Run each stage only after
  the coordinator's go, rebase right before opening, keep the PR small enough to merge the same day.
- **Silent fall-through.** Forever reuses some Classic Era data (instance 189, world buffs, the buff
  catalog). Delete by edition name only after checking `isForever()` / `"forever"` paths do not reach
  it. Stage 6's type narrowing catches TypeScript leftovers, not Lua ones; stage 1 needs the Lua
  harness plus a real Forever client check.
- **Store sandbox** answers Retail today (stage 3); changing it touches certification.
- **Discord command list** changes in stage 4 (choices removed); a stale client may send a removed
  choice once: handle as "unknown edition" error, not a crash.
- **Old companions** (before the release that ships stage 3) still send `gameEdition`; rule 3 covers
  them.
- **Old links** to `/retail/...` etc.: kept as Worker redirects (stage 5).
- **Battle.net** removal (option A) removes a sign-in-adjacent feature some members may have used for
  Classic characters; their `BattleNetCharacter` rows stay.
- **Tests that pin counts** (dungeon catalog size, command size, achievements catalogue version): expect
  to update snapshots; bump `ACHIEVEMENT_CATALOGUE_VERSION` only if the visible catalogue changes (it should not:
  it is already Forever-only).

## Test changes summary

- Every stage: `npx tsc --noEmit -p .`, `npx vitest run`, `npx eslint .`,
  `node addon/Guilded/validate-addon.mjs` (and the GuildedDungeons validator).
- Delete: `active-editions.test.ts`, `challenge-*.test.ts`, `dungeon-edition-catalog.test.ts`,
  `battlenet*.test.ts` (option A), edition cases in `forever-only-focus.test.ts`,
  `site-editions.test.mjs`, `edition-port.test.ts`, `edition-api.test.ts`.
- Rewrite: `game-edition.test.ts` (Forever or refused), `addon-edition-packages.test.ts` and
  `verify-edition-zips.test.ts` (Forever zip only), `worker-routing.test.ts` (redirects kept).
- Add: one "non-Forever upload/API call is refused with the plain message" test per entry point
  (upload, pairing, companion API, public runs import), and one Lua test that an unknown interface runs
  no edition-specific code.
