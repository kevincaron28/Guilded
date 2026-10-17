# Guilded 6.3.1 — Whispers reach WoW Forever players

Patch release, October 16, 2026. Addon, bot and Windows companion move together to 6.3.1;
protocol remains 2. It fixes one problem found during the last in-game check of the evening
and records that check's results ([checklist](V6_2_GAME_ACCEPTANCE.md)).

## Addon

- **Whispers reach the player.** On WoW Forever every character has a first and a last
  name, and a whisper to the first name alone fails ("No player named 'Naomine' is
  currently playing"). Guilded now answers with the name the game gave, so these arrive:
  - the "a newer Guilded is out" notice;
  - **the guild's module settings sent to a member at login** (members did not get them
    before on Forever);
  - the loot council's answer list sent to officers in the group.

## Checked in game (16 October, two PCs)

- **Soft-reserve roll-off (G9): PASS.** Reserves by whisper to the list keeper, SR+ carried
  over a cleared list (+10), roll-off between the reservers, winner with the bonus, award
  recorded once. Full first and last names in `/roll` messages are read correctly. A tie
  cannot be forced in game; the tie re-roll is covered by an automated test.
- **Guild map: PASS** both ways between two PCs, outside a party (name, level and zone on hover).
- Small known gaps: SR+ shows only on the keeper's reserve list; `/guilded chat off` leaves
  the Guilded chat tab open.

## Bot and companion

No changes besides the version number.

## Database

No new migrations.
