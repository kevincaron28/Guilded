# Race to 60 board (8.5, track B1)

A permanent board for WoW Forever (level cap 60): one bot message in its own channel, edited in
place (the duel-board pattern), with a class-coloured bar image from `src/services/score-card.ts`
(`race` layout) and text fields for the finish order, who is still racing and the week's best.

## On by default, off switch for officers

Owner decision (6 November 2026): the board is on in every server. It posts only once its channel
exists: `/setup` "Create missing channels" adopts a channel already named `race-to-60` / `course-au-60` or creates
one. `/character race action:board-off` stops it (`board-on` turns it back on, optionally with `channel:`).
Without a channel the bot creates
`race-to-60` (`course-au-60` in French), visible only to the server's member role and read-only;
if it cannot do that safely (no Manage Channels or no member role) it asks for a channel.
`board-off` stops updates and leaves the message.

## What counts

Every guild character with a reported level: linked characters (`Character.level`) and guildmates
nobody linked (`UnclaimedCharacter.level`, from an officer's addon upload). A linked character wins
over an unclaimed copy of the same name. Members hide their characters with
`/character race action:hide` (and `show`); hidden members are also removed from the unclaimed list
by name.

## Finish order and weekly gains

`LevelRaceEntry` (migration `20261219000000_race_board_pvp_channels`) remembers, per character name,
when the board first saw it at 60 (`reachedMaxAt`) and its level at the start of the current week
(Monday 00:00 UTC). Honest limit: levels arrive with uploads, so "reached 60" is the first
sync that showed 60, and characters already at 60 when the board is first switched on all get that
first sync's time. A level that goes down means the name was re-rolled and its history restarts.

## Updates

The board refreshes after every roster import (`followUpImport`), on the 30-minute board refresh and
at startup, through the `RACE_BOARD` Discord job. A restart never duplicates it: the saved message id
is reused, or an existing bot message with the footer marker `Guilded race board` in the channel is
adopted.

## Near your level

`/character race action:near` lists up to eight unfinished characters within three levels of the
caller's highest linked character (private reply). No whisper button yet.

## Needs a real check

Posting and editing in a live Discord channel, the card rendering with real class names, and a real
level-up flowing through companion upload to the board.
