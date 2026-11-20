# Exact character matching by ID (plan, 20 November 2026)

Owner decision: match characters by ID everywhere, so the system cannot confuse two "Lebowski"s, resurrect
"Xaldin Xaldin" or "Chad", or attach a level to the wrong row. Audit and plan only; no code changed.
Another worker is adding Armory roster sync and GUIDs to the addon's roster upload (branch
`feat/armory-roster-sync`); this plan builds on that and does not duplicate it.

## 0. The design in five lines (leanest that is still fail-proof)

1. **One canonical key: `wowId`, a `BigInt`** = the low part of the GUID (`Player-<realm>-<hexLow>`), the same
   number as Blizzard's Armory `character.id`. Chosen because the addon can always derive it from the GUID it
   already reads, the Armory returns it natively, and one number needs no parsing at lookup time. The realm part
   is not stored: every lookup is already scoped by `(guildId, gameEdition)`. (Unknown for Forever: whether low
   ids are unique across realms; the guild scope makes that irrelevant.) One column, never both forms; the GUID
   string is not stored.
2. **IDs are resolved once, at the door.** The bot's ingest (companion upload, device upload, addon import,
   Armory sync) turns "id and/or name" into one existing row with one helper; every table downstream keeps its
   current `character` name column, now guaranteed to be that row's canonical name. So only 6 tables get a new
   column (`Character`, `UnclaimedCharacter`, `GuildRosterEntry`, `DeviceCharacter`, `DungeonRunPlayer`,
   `PublicRunPlayer`), not the ~25 name-keyed tables.
3. **One shared matching rule, two tiny implementations of the same ~15 lines**: `resolveCharacter()` in
   `src/services/character-ref.ts` (bot; `companion/character-identity.mjs` re-exports it) and
   `ns.util.sameCharacter(a, b, idA, idB)` (addon). Per-feature `foreverSameName` / `foreverNameMatches` call
   sites become calls to it.
4. **Backfill from incoming uploads only.** No one-off DB job (the 19-20 Nov P2028 burst came from heavy
   scripts). A null `wowId` is filled the first time an upload carries both id and a name that matches that row
   uniquely. Never guessed.
5. **One migration, 3 stages.** Nullable columns plus unique indexes (Postgres allows many NULLs).

## 1. Inventory: where a character is identified or matched by name

API facts (Classic-family client; every "verify" is unprobed on Forever):
- `UnitGUID(unit)` for `player`, `partyN`, `raidN`, `target`, `mouseover`: works for any valid unit token. The
  addon already reads it: `addon/Guilded/Compat.lua:112` stores `guid` on every group member in `unitInfo()`
  (returned at `:142`), and nothing uses it (only `PugCheck.lua`, `SecretAchievements.lua` call `UnitGUID`).
  Guard with the existing `secret()` check.
- `GetGuildRosterInfo(i)` returns the GUID as its 17th value (since 8.0 / Classic 1.13.x). Verify on Forever.
- Chat events (`CHAT_MSG_*`) carry the sender GUID as arg12. `CHAT_MSG_ADDON` carries only the sender name, so
  addon-to-addon messages have no GUID. `GetPlayerInfoByGUID(guid)` maps GUID to name/class/race.
- Combat log events carry source and dest GUIDs (usable for PvP kills; not needed elsewhere).

### 1.1 Addon

| Where | Matches | Bug possible | GUID there? | Change |
|---|---|---|---|---|
| `Util.lua:230` `characterKey` | name to `First Last` key; `fullNameFor(first)` guesses a surname from a first name | a first name resolves to the wrong Lebowski; doubled names | n/a (key builder) | keep as display key; stop guessing surnames once ids exist; add `util.charId(guid)` (lowercase hex low part) |
| `Util.lua:350` `sameCharacter` | first name equals full-name prefix | "Lebowski" matches any "Lebowski X" | callers pass names only | signature `(a, b, idA, idB)`: both ids known => `idA == idB`; else exact name only (loose branch removed after sunset) |
| `Util.lua:364` `findCharacterKey` | scans a table for the unique loose key | ambiguous first names silently match or fail | via roster | look up `ns.idToKey[id]`, then exact name; no scan |
| `Util.lua:183-330` `learnFullName`, `fullNamesFor`, `migrateForeverNames`, `nameMigrationLines` | first-name to full-name book | wrong merges of first-name rows | roster id | dead after rollout (section 6) |
| `Util.lua:380` `unitKey` | `UnitName` plus surname | name only | yes `UnitGUID(unit)` | add `util.unitId(unit)`; callers that store a unit's data also store its id |
| `Compat.lua:112-142` `unitInfo` | party member record | none (already has `guid`) | already read | export it |
| `Modules/GuildSnapshot.lua:85` roster upload | rows keyed by name | first-name rows, doubled names, level on the wrong row | yes, 17th return | send `id` per row (in progress on the Armory branch). Also build `ns.idToKey` / `ns.keyToId` here: the one place the addon learns id-to-name |
| `Core.lua:348,2656,2897,2907` guild roster reads | rank/officer checks by name compare | wrong sibling | yes | compare ids when `keyToId[name]` is known |
| `Modules/Dungeon.lua:126,605-660` `run.players[name]` (level, spec, guild, faction, integrity) | party member by name | one player's level written onto a same-first-name row | yes `UnitGUID(partyN)` | store `players[name].id` when the player joins; the summary line carries it once per player |
| `Modules/Dungeon.lua:771,832,848,881-996`, `Modules/Carry.lua:64` peer and carry copies (`existing.players[sender]`) | sender name from an addon message | impersonation or first-name sender matches a stranger | no (addon messages carry no GUID) | exact-name sender check only; ids travel inside the carried payload |
| `Modules/LootRoll.lua:30-32`, `Modules/Attunements.lua:118` | `sameCharacter` vs roll/chat sender | first-name false positive | chat arg12 yes; roll events name only | use arg12 where present, else exact name |
| `Modules/Duels.lua` (6 `unitKey`, 2 roster reads) | duel winner/loser from `unitKey(target)` | wrong sibling scored | yes (`target`) | duel line carries `winnerId`, `loserId` |
| `Modules/Battleground.lua`, `WorldPvP.lua` | killer/victim names | same | combat log GUIDs | ids on kill lines |
| `Modules/Recipes.lua`, `RosterProfessions.lua`, `CraftOrders.lua` | crafter by roster row | profession/order on wrong row | roster id | key by roster id when present |
| `Modules/Promotion.lua:139`, `InviteQueue.lua`, `AutoInvite.lua`, `Util.lua:643,729` `partyInvite`/`inMyGroup` | roster/group by name | invites or promotes the wrong sibling | roster id | resolve name to id via `keyToId` for the record; the game's invite call stays name-based |
| `Modules/LedgerSync.lua`, `LedgerDigest.lua`, `LedgerRelay.lua` | ledger owner by name; 24-bit hash sync | row follows a first name | roster id | add `id` as a row field, outside the hash, so old clients still agree |
| `Modules/RaidSignup.lua`, `Reserve.lua`, `Bidding.lua`, `Council.lua`, `Loot.lua` | sign-ups, reserves, bids by name | same | roster id | store id beside the name when known |
| `Modules/GuildRelay.lua`, `Digest.lua`, `CallForHelp.lua`, `Sync.lua:87` | relayed rows, call sender | first-name merge | roster id | include id; receivers key by id when both sides know it |
| `Modules/ChatTab.lua`, `ChatTags.lua` chat bridge | sender name | mis-tag | arg12 | display only; none |
| `Modules/Minimap.lua:311,2564,2634`, `Tooltip.lua`, `Scores.lua` | target/mouseover lookups by name | wrong score under shared first name | `UnitGUID("target"/"mouseover")` | look up by id first |

### 1.2 Companion (`companion/`)

| Where | Matches | Bug | Change |
|---|---|---|---|
| `character-identity.mjs:12,20,32` `foreverSameName`, `foreverNameMatches`, `characterKey` | first-name prefix, lowercase key | any first-name match | thin wrappers over the shared rule (section 3) |
| `character-identity.mjs:39` `normalizeExportIdentities` | rewrites every `character`/`name` | name-only normalisation | pass `id` through; never rewrite an id |
| `device-sync.mjs:55-63` | "own character is in the party" decides trust | first-name sibling counts as the uploader | compare ids when both known |
| `lua-export-content.mjs`, `carry-content.mjs`, `personal-runs-content.mjs`, `run-report.mjs`, `known-runs.mjs`, `parked-runs.mjs`, `upload-split.mjs` | build payloads from SavedVariables | drop fields they do not know | copy `id` (hex string) with each character and run player |

### 1.3 Bot (`src/`)

| Where | Matches | Bug possible | Change |
|---|---|---|---|
| `character-match.ts:10,20,39,54` `selectedCharacter`, `findCharacter`, `looseForeverMatch`, `ledgerOwner` | `(name, realm)` with loose first-name fallback | ambiguous first name returns one of several; ledger "shared" guesses | `findCharacter(rows, {id?, name, realm})`: id first; loose branch deleted at sunset |
| `schema.prisma` `Character @@unique([guildId, gameEdition, realm, name])` | name + realm uniqueness | a rename creates a second row | add `@@unique([guildId, gameEdition, wowId])` |
| `character-pairing.ts:95,122` | `startsWith(first)` candidates, `foreverSameName` | links the wrong sibling | id equality when the uploader gave an id |
| `character-autolink.ts:107,178,182` | `name equals insensitive` | same | lookup by id first |
| `character-import.ts:102`, `dm-character-link`, `character-verify.ts`, `CharacterVerifyClaim.nameKey`, `character-move.ts`, `character-trust.ts`, `link-coverage.ts`, `me-characters.ts`, `commands/character.ts` | claims and verification by `nameKey` | a verify code heard from "Lebowski" verifies another | the verify event carries the speaker's id (addon `unitInfo` has it); claim stores `wowId`; trust needs id equality once both known |
| `companion-device.ts` (27 uses), `device-claim-offer.ts:49,92`, `upload-linking.ts`, `DeviceCharacter.nameKey` | zero-setup device matching, provisional characters | bridge provisional accounts, "Chad"/"Hulke" rows | `DeviceCharacter.wowId`; offers match by id when known |
| `companion-access.ts:51-55` | "owned row is the match (foreverSameName)" | uploader with two "Lebowski"s binds to the wrong one | require id match, or exactly one candidate and no id on either side |
| `companion-api.ts` (`addonCharacterSchema`, ~1327-1363) | upload schema | no id field | add optional `id` (hex, max 16 chars) to character, roster row, run player schemas |
| `guild-data.ts:164`, `forever-names.ts`, `roster-discovery.ts`, `roster-presence.ts:19` | roster rows to members; "left guild" detection | first-name roster row reads as left or present wrongly | key roster by `wowId`; presence = id in latest roster snapshot |
| `addon-import.ts`, `GuildRosterEntry @@unique(guildId, gameEdition, nameKey)` | roster ingest | doubled / first-name rows | upsert by `wowId` when present, else `nameKey` as today; an id-bearing row is never overwritten by a different id |
| `dungeon-import.ts:25,229-254`, `dungeon-rating.ts:308,425,491`, `run-trust.ts:107-122`, `public-runs.ts:123` `mergePlayerReports`/`playerKey`, `cross-guild-runs.ts`, `carried-records.ts`, `public-leaderboard.ts:81-87` `rosterKeysOf`, `guild-public-stats.ts:46` | run players merged and ranked by first-word key (`dungeon-import.ts:229`) or name; leaderboard filtered by roster name keys | two characters sharing a first word merge in rankings; levels on the wrong row (the #1171 class); a rename splits history | `DungeonRunPlayer.wowId`, `PublicRunPlayer.wowId`; `playerKey(p) = p.id ?? name`; merge reports only when ids equal, or one side has none and names are exactly equal; roster membership by id |
| `duels.ts:58,131`, `duel-global.ts:89` | `foreverNameMatches` for winner/loser | scores the wrong sibling | duel lines carry ids; resolve through `resolveCharacter` |
| `race-board.ts` (`LevelRaceEntry.nameKey`, `RaceHallEntry.nameKey`) | race and Hall of Fame by name key | a first-name entry duplicates the full-name entry | no new column: resolve to the canonical name at ingest (rule 2) |
| `invite-queue.ts`, `invite-prelink.ts`, `invite-name.ts`, `InviteRequest.nameKey` | invite requests by name | invites the wrong sibling | invite stays name-based (game API); the record resolves via roster id |
| nickname sync, rank roles, promotion planning (`Character.guildRank*`) | via `Character` rows fed by the roster | rank applied to the wrong row | follow from roster `wowId` |
| `craft-board.ts:187`, `recipes.ts`, `artisans-gallery.ts:45`, `RecipeKnown.character`, achievements | name equals / by name | wrong crafter, duplicates | resolve at ingest |
| `character-display.ts` (`loadFullNameBook`, `resolveCharacterName`), `dungeon-import.ts` `runFullName` | repairs first-name display to a full name | hides the data bug | dead after rollout |

## 2. Data model

```
-- one migration, plain ALTERs, all nullable (next timestamp after the latest folder)
ALTER TABLE "Character"          ADD COLUMN "wowId" BIGINT;
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "wowId" BIGINT;
ALTER TABLE "GuildRosterEntry"   ADD COLUMN "wowId" BIGINT;
ALTER TABLE "DeviceCharacter"    ADD COLUMN "wowId" BIGINT;
ALTER TABLE "DungeonRunPlayer"   ADD COLUMN "wowId" BIGINT;
ALTER TABLE "PublicRunPlayer"    ADD COLUMN "wowId" BIGINT;
CREATE UNIQUE INDEX ON "Character"("guildId","gameEdition","wowId");
CREATE UNIQUE INDEX ON "UnclaimedCharacter"("guildId","gameEdition","wowId");
CREATE UNIQUE INDEX ON "GuildRosterEntry"("guildId","gameEdition","wowId");
CREATE INDEX ON "DungeonRunPlayer"("wowId");  CREATE INDEX ON "PublicRunPlayer"("wowId");
```
Postgres unique indexes allow many NULLs, so no backfill is needed to create them and no partial index. Lookups
are one index probe, O(1). Keep the migration to ALTER and index builds only (no data statements) to avoid the
lock and timeout trouble seen on 19-20 Nov; check row counts first.
- **Wire format**: `id` = lowercase hex low part as a string (`"1a2b3c4d"`), sent once per character per upload
  (in the roster row; once per player in a run summary); about 9 bytes per row. One bot function
  `parseWowId(hex | decimal)` yields the BigInt and also accepts the Armory's decimal.
- **Rename / faction change / transfer**: the low id is stable across rename and faction change, so lookup by id
  finds the row and ingest rewrites `name` (rename = same row; the old name goes to `legacyName`/aliases that
  already exist). If a transfer changes the id on Forever (unknown) the new id is a new character: a safe failure,
  never a merge.
- **Same-name characters**: one realm cannot hold two identical names; characters sharing a first word are
  different ids, different rows, and the unique index plus the rule below refuse to merge them.
- **Backfill (no job)**: when an incoming record has `{id, name}` and no row has that id, the unique row with
  exactly that full name and `wowId IS NULL` adopts it. Zero or several matches: separate rows, logged once. A
  row that already has a different id is never touched. The Armory roster sync (other worker) fills the whole
  roster at its next run, which covers most rows alone.

## 3. The matching rule (everywhere)

```
resolve(rows, {id, name}):
  1. id given and a row has it   -> that row (a name difference is a rename: update the name)
  2. id given, no row has it     -> rows with wowId NULL and exactly that full name:
                                    exactly one -> adopt it (set wowId); otherwise -> new row
  3. no id given                 -> rows with exactly that name: one -> it. An id-bearing row accepts a
                                    name-only report only when it is the same exact full name and no other
                                    row shares it. A first-name-only report matches nothing once the sunset
                                    flag is on.
  never: two different ids merge; an id-bearing row never attaches to a different id.
```
Bot: `resolveCharacter` and `sameCharacterRef(a, b)` (pairwise use: run trust, `mergePlayerReports`) in
`src/services/character-ref.ts`. Addon: `ns.util.sameCharacter(a, b, idA, idB)` and `ns.idToKey`/`ns.keyToId`
built once per roster refresh in `GuildSnapshot.lua`. The companion re-exports the bot rule from its shared file.

## 4. Rollout (3 stages, 1 migration, about 3.5 days)

**Stage A, bot, additive (about 1 day, ~350 lines plus tests).** Migration; `parseWowId`; `character-ref.ts`;
optional `id` in the upload schemas (the Worker forwards body fields; no header change); ingest stores ids
(including the Armory worker's) via steps 1-3. Name-only old clients keep working (rule step 3). Deploy first.

**Stage B, addon + companion release (about 1.5 days, ~300 lines Lua, ~80 mjs).** Addon stamps ids where it can:
roster rows, run players (from the `guid` `unitInfo()` already reads), own character, duels, verify lines.
Companion copies `id` through. Protocol stays 2: ids are optional extra fields; old bots ignore them (check any
`.strict()` use in `addonCharacterSchema`). Old addons upload names only; peer copies between old and new addons
ignore ids. Ships with the Store companion submission as usual.

**Stage C, switch matching and delete (about 1 day, mostly deletions).** When a read-only count shows most rows
have ids, turn the sunset flag on (default off until measured), then delete the loose branches and name-repair
machinery (section 6). The Lua deletions need the next addon release.

## 5. Tests to add

- `tests/character-ref.test.ts`: the rule table (rename keeps the row; two ids never merge; adopt on a unique
  exact name; ambiguous gives a new row; an id-bearing row refuses a first-name report).
- Property test: the same roster uploaded in shuffled order, with and without ids, ends in identical rows.
- `tests/lua/`: `sameCharacter` with ids (equal, different, one missing); `unitInfo().guid` to hex; `keyToId`
  build; summary line round trip with `id`.
- Regression fixtures for the real bugs: "Xaldin Xaldin", "Chad", "Hulke", several "Lebowski X", the provisional
  bridge account, #1171 carried-run levels.
- Contract test: old payload (no ids) and new payload both accepted; unknown `id` never rejected.
- Migration test: columns exist, unique allows many NULLs, rejects a duplicate id within a guild.

## 6. Name heuristics that become dead once ids exist (Stage C)

`foreverSameName` loose branch and `foreverNameMatches` loose fallback (`companion/character-identity.mjs`);
`looseForeverMatch` and the loose parts of `findCharacter`/`ledgerOwner` (`character-match.ts`);
`util.sameCharacter` first-name branch, `findCharacterKey` scan, `learnFullName`/`fullNamesFor`/`fullNameFor`,
`migrateForeverNames`/`nameMigrationLines` (`Util.lua`); `loadFullNameBook`/`resolveCharacterName`/`runFullName`
(`character-display.ts`, `dungeon-import.ts:25`); the first-word merge key (`dungeon-import.ts:229`); the
`startsWith(first)` query (`character-pairing.ts:95`); loose arms in `device-claim-offer.ts`, `roster-presence.ts`,
`guildmate-relay.ts`, `run-trust.ts`; `bridge-provisional-revert.ts` and the `forever-names` backfill scripts once
nothing provisional remains. They stay only for rows whose `wowId` is still NULL, until the sunset flag flips.

## 7. Risks and verification

| Risk | Mitigation / check |
|---|---|
| Forever's `GetGuildRosterInfo` has no GUID, or `UnitGUID` returns secret values | Stage 0 probe (`/guilded probe guids`: GUID of player, party, first roster rows) on a real Forever client before Stage B; schema stays optional so nothing breaks if absent |
| Low ids not unique across realms | lookups scoped to `(guildId, gameEdition)`; probe guildmates of one realm |
| Armory id differs from the GUID low part | compare on one known character first; if different, use only one source for the stored id and the other only for adoption by exact name |
| Wrong adoption at step 2 | adopt only into NULL-id rows with an exact full "First Last"; never from a first name |
| Migration locks or timeouts | ALTER plus index only, off-peak, backup first, no data statements |
| Old addon payloads vs strict schemas | contract test in Stage A; ship the bot first |
| Payload growth | ~9 bytes per row, once per upload; ledger hashes untouched |
| Repeated roster scans in the addon | build `keyToId`/`idToKey` once per refresh |

Verification per stage. A: tsc, vitest, eslint, new tests, migration on a copy, then live after a backup. B: Lua
harness plus a real two-PC run (an uploader with several "Lebowski"s) confirming `wowId` fills. C: one read-only
count query of NULL `wowId` per table; flip the sunset flag only below an agreed share; keep the deletion commit
separate so it can be reverted.
