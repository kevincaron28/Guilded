# Blizzard Armory roster sync (20 November 2026)

The bot reads each Discord server's in-game guild from Blizzard's Armory (Profile API, WoW Forever) and shows the whole
guild on the website's guild page. It is public data fetched with the bot's own Battle.net app (client credentials,
`docs/BATTLENET_SETUP.md`). Without `BATTLENET_CLIENT_ID` / `BATTLENET_CLIENT_SECRET`, or when Blizzard answers 403/404,
it does nothing (one log line).

## What it calls

- `GET https://us.api.blizzard.com/data/wow/guild//<slug>/roster?namespace=profile-forever-us&locale=en_US`
- `GET https://us.api.blizzard.com/data/wow/guild//<slug>?namespace=profile-forever-us&locale=en_US` (summary: faction, member count, achievement points)

The realm segment is empty (`guild//slug`); the `dynamic-forever-us` realm index is not served yet. The slug is the
lower-case guild name with spaces as hyphens, apostrophes removed and **accents kept** (`québec-gold`, URL-encoded). Never
strip the accent: `quebec-gold` is another guild (Alliance). A response is stored only when the guild name it reports equals
the server's in-game guild name (accents count).

Roster rows carry `character { name (first name only), id, level, playable_class, playable_race }` and `rank` (0..6 on
Québec Gold). Character profile, equipment and achievement endpoints were not probed or used.

## Which guild

The in-game guild name Guilded already knows for a server: registered `WowGuild` rows, else the guild name its companions
reported (`ownGuildNames` in `import-followup.ts`). Servers without a known name are skipped. No new setting.

## Schedule and storage

`src/main.ts`: first run 9 to 14 minutes after start, then every 6 hours plus up to 10 minutes of jitter; one guild at a
time, 2 s apart, calls spaced 100 ms and capped per hour; two retries on 5xx/429/network errors.

Migration `20270309120000_armory_roster`:

- `ArmoryGuild` (one row per server: guild name, slug, faction, member count, achievement points, fetch time)
- `ArmoryRosterEntry` (guildId, `blizzardCharacterId`, first name, level, class id, race id, rank, seenAt), replaced whole on every run
- `GuildRosterEntry.blizzardCharacterId` (nullable), written from the addon's GUID

## Matching: exact only

An Armory row is tied to a Guilded character **only through the Blizzard character id** taken from a player GUID that
the addon uploaded. There is no matching on first name, level, class or rank. Rows without a known id are shown on the
website as Armory-only entries (first name, level, class, rank, tagged "from the Armory"), never attached to a member
and never merged with a "First Last" character (tested: same first name, level and class, no GUID, not linked).

GUID to id: a player GUID is `Player-<realmId>-<hex>`; the API's `character.id` is the hexadecimal low part read as a
decimal number (`Player-4408-0A1B2C3D` is 169552957). This is the convention the community tools use for retail and
Classic; it is **not yet confirmed against a real WoW Forever upload**. As a guard, an id match is refused when the first
names differ, so a wrong conversion can only leave rows unlinked, never attach a stranger. First check after the first real
upload with the new addon: how many roster rows show "linked".

Pipeline: addon `Modules/GuildSnapshot.lua` reads the 17th return value of `GetGuildRosterInfo` (the GUID, kept only if it
matches `Player-<digits>-<hex>`) into `db.guildSnapshot.members[...].guid`; `companion/lua-export-content.mjs` passes it in
`guildRoster.members[].guid` (optional, backward compatible); `guild-data.ts` converts it with `guild-armory-id.ts` and
stores `GuildRosterEntry.blizzardCharacterId`, never erasing a known id when a later upload lacks it. Older addons simply
send no GUID. The id is not yet stored on `Character`; a character's id is reachable through its roster row.

## What the website shows

On `/g/<slug>/`, under the "rosters" section, a "Guild roster" table of the whole guild: character, level, class, rank, with
"N members. Updated <time> from the Blizzard Armory." Linked rows show the addon's full name, level, class and rank name;
rank names come from the addon's roster (else "Rank N"). The member count is the Armory summary's. The JSON read for the
app includes the same rows.

Privacy: members who hid their profile are left out (`profile-privacy.ts`): linked rows by full name, Armory-only rows by first
name, so a first name shared with a hidden character is hidden too. Armory data is Blizzard's public data and is replaced on
every run; it follows the guild, not Delete my data.

## Promotion hint

`armoryRankHint(db, guildId, blizzardCharacterId)` returns a character's Armory rank index. Nothing in the promotion plan
calls it yet.
