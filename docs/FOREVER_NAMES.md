# WoW Forever full names (8.5)

Found in a live two-PC test on 6 November 2026: on WoW Forever `UnitName("player")` returns the
first name and the **surname** ("Blunt", "Cruising"), and one player's alts often share the first
name (the owner's "Lebowski Holyroller", "Lebowski Highspirits", "Lebowski Greenleaf",
"Lebowski Soulblaze"). Until 8.5, Guilded keyed every Forever character by the first word only, on
purpose ("legacy accounting key"), so those alts were one character everywhere.

## What collapsed (before this change)

| Layer | Where | Key before | Effect for "Lebowski X" alts |
| --- | --- | --- | --- |
| Addon key | `util.characterKey`, `util.unitKey` (Util.lua), Core `normalizeName` / `playerName` | First word | One key "Lebowski" |
| EP/GP ledger | `db.epgp[name]`, LedgerSync | key | One account for all alts |
| Roster, guildmates' digests, readiness | `db.roster`, `db.peerRoster`, `db.readiness` | key | One row; the last digest wins |
| Own characters | `db.myCharacters`, `db.character.name` (`bareName`) | key / first word | One alt exported |
| Display names | `db.displayNames[key]` | key | Shows whichever alt was seen last |
| Dungeon runs, duels, milestones, recipes, attunements, reserves, scores, call for help, relay carriers | per module, through `ns.normalizeName` | key | Shared between alts |
| Whisper addresses | `util.rememberAddress` | key | Whispers go to the last alt seen |
| Companion export | `lua-export-content.mjs` | the addon's key as `name` | Same collision |
| Bot characters | `Character` unique (guild, edition, realm, name) | "Lebowski" | One row; `displayName` flips |
| Bot keys | `characterKey` (forever = lowercase name): `UnclaimedCharacter`, `CharacterVerifyClaim`, `LevelRaceEntry`, `RaceHallEntry` | "lebowski" | One entry, race board shows one alt |
| `/ginvite` lines | `roster-gaps.ts` (`inviteName` from the stored display name) | display name | Only the alt seen last |

Blizzard editions (Retail, Classic) were not affected: they key by name AND realm.

## What changed

**Addon (Util.lua).** A Forever key is now the full "First Last", each word capitalized; a
`-Realm` suffix is dropped. `util.unitKey` joins UnitName's two values. A first name alone (old
saved data, a 8.4 guildmate, a bot row from before the fix, a typed command) resolves to the full
name only when exactly one known character has that first name (`util.fullNameFor`, fed by the
roster, guildmates heard, own characters and display names); otherwise it stays as typed and is
never guessed. `util.sameCharacter` lets an older guildmate's digest or attunement, or a soft-reserve
roll, count for the sender when the first name matches; data is always stored under the sender's
full name.

**Saved-data migration (Util.lua `util.migrateForeverNames`, run after each roster load).** The
roster lists every guild member's full name, so "only one Lebowski in this guild" is a fact, not a
guess. Then a first-name key moves to the full name in: roster, guildmates' digests, readiness,
display names, own characters, attunements, crafters seen, recipe book, cooldowns, scores, relay
carriers and the officer list; descriptive rows merge into an existing full-name row, keeping the
earliest first-seen/joined date. EP/GP accounts and reserves move only when the full-name key is
empty: they are **never merged**. A first name shared by several characters, or an account under
both keys, stays untouched and is listed in `db.nameMigration.flagged`; officers get one line after
the roster loads and `/guilded names` lists them. Nothing is deleted.

**Bot.**
- Migration `20261226000000_forever_full_names` is additive only: a nullable `legacyName` column on
  `Character` and `UnclaimedCharacter` (the pre-8.5 first name a row had before it was renamed).
  It changes no row.
- Backfill: `scripts/forever-names.ts` (`npm run names:forever`), **preview unless `--apply`**. A
  Forever row whose `name` is one word and whose `displayName` is two words starting with it takes
  that full name (old name kept in `legacyName`), with its verify claims and race-board entries,
  only when no other character of the guild shares the first name. Rows sharing a first name are
  listed (REVIEW) and left as they are; nothing is deleted or merged; running it twice changes
  nothing the second time. Logic in `src/services/forever-names.ts`.
- `findCharacter`: an exact name first; otherwise a pre-8.5 first-name row still matches "First Last"
  (and the reverse) when it is the single candidate and its known display name is not another alt's.
  8.4.x addons keep working during the rollout.
- EP/GP and DKP belong to a **member** in Discord, not a character, so alts of one player never lose
  points. A ledger row named only "Lebowski" (an 8.4 addon) goes to the member when every
  "Lebowski …" character is theirs (`ledgerOwner`); when several members have one, the row is held
  as `SHARED_FIRST_NAME`: the "legacy account" an officer assigns. It shows in the officer log after
  the sync and in `/import held`; the officer links that name to the right member with
  `/officer character link`, and the next sync imports it. Nothing is guessed.
- `linkPairedCharacter`: the member's own upload renames their own first-name row to the full name
  (old name in `legacyName`), so their next alt with the same first name becomes a new row.
- Personal uploads (`personalSnapshot`), duels, milestones and relayed runs accept a pre-8.5
  first-name row for the uploader's own characters (the PC's character and alts only). A duel naming
  a first name two members share is refused, not guessed.

**In game.** The addon's own EP/GP ledger (`db.epgp`, in-game-only guilds) keeps a shared
"Lebowski" account as it is: it is listed in `/guilded diag` and `/guilded names` until an officer
sorts it out by hand.

## Owner steps on the server (dry run first)

After the 8.5 deploy (the deploy runs `npm run db:update`, which adds the `legacyName` column):

1. Backup first, as for every data change (`docs/DEPLOY_ORACLE.md`).
2. Preview, on the server in the bot folder (nothing changes):
   ```bash
   npm run names:forever
   ```
   One block per guild: how many rows would be renamed, how many share a first name (REVIEW lines,
   left as they are) and how many have no full name yet (their own next upload renames them).
   `-- --guild <Discord server id>` limits it to one server.
3. If the list looks right, apply it:
   ```bash
   npm run names:forever -- --apply
   ```
4. For each REVIEW line and each `SHARED_FIRST_NAME` row in `/import held`, an officer decides:
   link the first name to the member it belongs to (`/officer character link`) or dismiss the entry.
5. Undo, if ever needed: a renamed row has its old name in `legacyName`
   (`UPDATE "Character" SET name = "legacyName" WHERE "legacyName" IS NOT NULL AND ...`).

A first-name row that collapsed several alts before 8.5 cannot be split automatically: its history
(EP/GP, runs) belongs to whichever alt did it, which nothing recorded. The member's own next upload
gives the row the full name of the alt they log in with; the other alts get their own rows.

## Needs a real client check

1. Two alts with the same first name on one PC: `/guilded status` and the companion upload show two
   characters; Discord shows two characters after the next sync.
2. A PC with pre-8.5 saved data where the first name is unique: after the roster loads, EP/GP and
   roster rows move to the full name (`/reload`, check the SavedVariables file).
3. The owner's "Lebowski" alts: `/guilded names` lists the shared EP/GP key; nothing moved.
4. Whispers (ledger sync, call for help) reach the right alt.
5. An 8.4.7 guildmate and an 8.5 guildmate see each other's readiness and attunements.
