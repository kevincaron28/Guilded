# In-game guild board (9.1, Track H item 4)

Officers' news posts and the open Discord polls on a **Guild board** page of the Guilded window,
with voting from the game, mirrored both ways with Discord. Owner approved 7 November 2026. The idea
came from the Kinfolk comparison (ROADMAP Track H); Kinfolk is All Rights Reserved, so nothing of its
code, text, layout, art or name is used. Written from scratch on top of `/poll` and the Track K relay.

On by default in every server (ROADMAP rule 5). Off switches:

- **Officers (server-wide):** `/poll board enabled:False`. The feed then carries `board: { enabled: false }`,
  the page says the officers turned it off, and the bot ignores votes and news from the game.
- **Members:** the "new guild news" line at login: the **News alerts** button on the page, or
  `/guilded board alerts off`. Nothing is posted anywhere by that line; it is local chat text.

## Discord to game

- `/poll news text:` (officers) posts a news embed in the current channel and stores a `BoardPost`
  (migration `20270104000000_guild_board`). `/poll board remove:` takes one down (and deletes its message).
- `boardForAddon` (`src/services/guild-board.ts`) adds `board` to the **shared** part of the standings
  feed: the 5 newest news posts of the last 60 days (300 characters each) and the 5 newest open polls
  (question, up to 25 options, counts, how many voted, picks allowed, closing time). The **personal**
  part adds `boardVotes`, this member's own picks.
- Poll votes, closes, new polls and news call `markGuildChanged`, so long-polling companions refresh.
- The companion writes `GuildedBoard` into `Standings.lua` (`guildBoardToLua`); options and picks are
  numbered from 1 there, from 0 on the bot.

## Game to Discord

- A vote on the page (or `/guilded board vote <poll> <option>`) is saved in `db.board.votes[pollId]`
  as the member's full set of picks with the time. The companion uploads it (`boardVotes`); the bot
  sets that member's picks to exactly that set (`setBoardPicks`): open polls only, existing options
  only, at most the poll's number of picks, never over a newer Discord vote. Resending changes nothing.
  The Discord poll message is refreshed. The addon forgets the waiting vote once the feed lists it as
  the member's picks, once a newer board no longer lists the poll (closed), or after 14 days.
- Officers write news in the page's box (or `/guilded board post <text>`): `db.board.posts`, uploaded
  as `boardPosts` with a ref, stored once per ref and posted in the announcements channel
  (`notifyChannelId`; skipped quietly without one). The feed lists the ref, and the addon drops it.

## Members without the companion (Track K pattern)

- **Board down:** a client whose copy came from its companion shares it on GUILD 30 s after login
  (`GuildedBoard` prefix, `BOARD|stamp|part|total|payload`, 190-byte parts, at most 40), and answers
  `REQ|stamp` from guildmates with an older copy after a short wait (companion holders and officers
  first; quiet when someone else answered). The stamp is the feed's shared `updatedAt`. A relayed copy
  is display only; outsiders and older copies are ignored, and a stamp too far ahead is refused.
- **Votes up:** every vote is also said on GUILD (`VOTE|pollId|picks|at`), and waiting votes once more
  30 s after login. Every client keeps what it hears in `db.board.heard` under the game-reported sender
  (newest per poll and sender, 200 at most, 14 days). A companion uploads them as `boardRelayVotes`; the
  bot records each for the member who has that character linked in the guild, never for the uploader
  (their own votes are first-hand), skips unknown names, and applies the same rules as above.
- Trust: like Track K's relayed levels, a relayed vote rests on the uploader's saved file. The damage is
  bounded: counts only (no names), one vote per linked member, newer votes always win, and officers can
  close a poll or turn the board off.

## Still needs a real game client

1. Two Forever clients in one guild: A without the companion, B with it (paired member).
2. `/poll news` and `/poll create` in kevmister28's test Discord; B syncs: the Board page shows both.
3. A logs in: within a minute A's page shows "Shared by B". A votes; B stays online; B `/reload`s and
   syncs: the Discord poll shows A's vote. B votes on the page and syncs: counted once, changeable.
4. An officer posts from the page and syncs: the news appears in the announcements channel once.
5. `/poll board enabled:False`: after a sync the page says the board is off. Combat: open the page and
   vote during a fight (no taint, no errors).
