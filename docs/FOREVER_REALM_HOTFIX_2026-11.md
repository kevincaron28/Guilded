# WoW Forever 1.60.1 realm hotfix (20 November 2026)

## What Blizzard announced

For the 1.60.1 hotfix (WoWUIDev Discord, quoted by Wowhead, 20 Nov 2026), WoW Forever only:

- The realm ID in creature, vehicle, pet and game object GUIDs is obfuscated, like the server ID and spawn ID.
- APIs that return realm names or IDs return an empty string or zero: `GetRealmName`, `GetRealmID`, the `C_BattleNet`
  game-account realm returns, "but not limited to". We assume this also covers `GetNormalizedRealmName`, the realm
  returns of `UnitName` / `UnitFullName` / `GetUnitName(unit, true)` and the fourth `GetGuildInfo` result (the guild home realm).
  Player GUIDs are not listed; nothing may depend on their realm part anyway.

## The big risk and the fix

`GuildedDB.guildKey` is `"<guild name>-<compact home realm>"`. With no realm the key would become `"Québec Gold-"`,
which the addon would take for a guild switch: it parks the old data under `otherGuilds` and starts empty.

Rule now (`Core.lua` `currentGuildKey`, `GuildedDungeons/Main.lua`): on Forever, when the realm and the home realm are both
empty, zero, nil or secret, the stored key whose guild name equals the current guild is kept (the active `guildKey` first,
then a parked `otherGuilds` key). A brand-new guild with no realm gets `"<guild name>-"`. A real switch to another guild
still switches. Nothing is parked or reset because only the realm part disappeared.

## Every other realm consumer

| Place | Change |
| --- | --- |
| `Core.lua` ledger peer check | no `"name-"` with an empty realm |
| `Modules/OfficerBridge.lua` | realm-less clients match on the guild name; a sender key `"Guild-"` is accepted by clients that still have a realm |
| `Modules/Battleground.lua` | no longer returns nil with an empty realm (name alone keys the report); companion export accepts `realm: ""` |
| `Modules/Milestones.lua` | keeps using the existing `Name-<old realm>` record |
| `Modules/RosterTools.lua`, `GRMMigration.lua` | the roster scope and GRM archive match keep the stored scope (realm taken from it) |
| `GuildedGames/Core.lua` | no trailing dash |
| `Compat.lua`, `Duels.lua`, `Consumables.lua`, `Minimap.lua`, `Util.lua` | already accept `""`; reviewed, unchanged |

## GUIDs

- `SecretAchievements.lua` `sa.npcId`: the npc id is the second-to-last field; server, realm and spawn fields may be hex,
  non-numeric or empty. This is the only creature GUID parser in the addons (dungeon and boss detection use encounter ids).
- Player GUIDs: `Player-<anything>-<hex>`; the character id is the low hex part only (addon `Util.charId`, `Core.lua`,
  `GuildSnapshot.lua`, bot `guild-armory-id.ts`, `guild-data.ts`, companion `lua-export-content.mjs`).

## Companion and bot

- Companion `splitGuildKey("Guild-")` returns the guild with an empty realm (it returned nothing before).
- Bot: the unsigned-device upload takes `guild.realm: ""`; the addon-import schemas and battleground records accept an empty
  realm; a consumables scan with no realm lands on the character's existing row. Server matching was already by guild name
  (realm only a hint), `findCharacter` and `characterKey` on Forever already ignore the realm.
- Contract test `tests/forever-realm-hotfix.test.ts`: an old upload (realm "CAMWOW US2 Realm 2 PvP") and a new one (realm "")
  of the same guild land on the same server, guild and characters.

## Layer features

Layer invite and call for help never read layers, realms or creature GUIDs. They rely on "joining a group moves you to the
leader's layer", which Blizzard says stays. Header note added to `LayerInvite.lua`.

## To verify on the live hotfix

1. `/guilded diag`: the identity line shows `realm=(none)` and `GetRealmName=nil` or empty.
2. Log in on a character: no "Guild changed" or "Guild realm changed" chat line, `/guilded` data (roster, ledger) still there.
3. A brand-new install in the guild gets key `Québec Gold-` and the companion still finds the Discord server.
4. Officer bridge between an updated and a not yet updated PC; `/guilded sos` and `/guilded layer` still work.
5. Secret achievement "killed by" still fires on a real creature GUID.
6. Duel and battleground cards upload with an empty realm.
