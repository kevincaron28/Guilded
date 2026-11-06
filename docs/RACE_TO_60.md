# Race to 60 board (8.5, track B1)

A permanent leaderboard and Hall of Fame for WoW Forever (level cap 60), in the `race-to-60` channel.

- **The board** is the channel's first message, edited in place (the duel-board pattern): the top 25 guild
  characters by default (officers set 10-30 with `/character race action:top count:N`). Each line has rank, first and
  last name, class and race, level with a progress bar and its percentage of the way to 60 (the game does not give
  XP, so the percentage is level over 60), up to two professions with skill, last seen, and the linked Discord member
  (a mention that does not ping); level 60s show the date they got there. Below: the five biggest level gains this week
  and the count of 60s. The class-coloured bar image (`score-card.ts`, `race` layout) shows the top 14; the message
  text carries the full list.
- **The Hall of Fame** is one permanent message per character that reaches 60 ("#7 to reach 60": name, class, race,
  date, days since first seen in the guild, professions, linked member). Never edited or deleted.
  Each entry is a `RaceHallEntry` row (unique per character and per number), so history survives channel resets and a
  restart or re-sync never posts twice; a post that failed is retried on the next refresh. Characters already at 60
  when the Hall starts are stored in order of the member's recorded level-60 milestone date and announced in ONE summary
  message, not one each.
- **Hall of Fame mode:** `/character race action:end` (officers; `resume` undoes it), or every tracked character
  (at least three) reaching 60, switches the board message to a list of all 60s in arrival order. New 60s are still added.

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
over an unclaimed copy of the same name. There is no hide option (8.5: everything is shared); every guild character is on the board.

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
