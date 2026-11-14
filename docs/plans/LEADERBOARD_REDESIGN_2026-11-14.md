# Leaderboard redesign research (14 November 2026)

Goal: learn how the best public ranking sites present data, then decide what the Guilded
website leaderboards should show. Research note, not a release record. Some sites refused
automated fetches (Warcraft Logs, speedrun.com, wowprogress, which answered 403), so those
sections rest on help pages and search summaries and are marked "partial".

## 1. Site by site

### Raider.IO (read directly)
- First screen: a game-version switcher, one search box for characters and guilds, then stacked
  ranking blocks (raid progress, top characters, Mythic+ leaders by role, top runs, spec
  rankings, team tiers) and a strip of recently published recruitment profiles.
- Filters: season, region/realm, role or spec, difficulty, recruitment tags. Boards have a
  "this week" variant next to the season one.
- Player and guild pages: profile with score, best runs, progress per raid; guilds list their
  raid progress and members; teams get their own pages and tiers.
- Sticky: live "recent runs" and "recent progress" feeds, weekly boards, an addon that shows
  the score in game tooltips, Discord alerts, streamer showcase.

### Warcraft Logs (partial)
- First screen: zone/encounter picker; the core idea is a percentile rank per fight.
- Filters: zone, boss, spec, difficulty, region/server, time partition; "rankings" (best per
  player) versus "parses" (every attempt).
- Player page: best percentile per boss with colour tiers (grey to gold), an "all partitions"
  tab, and a marker for results that can still change.
- Guild page: kills, speed and execution rankings; historical view by default, today's values
  for zone boards.
- Sticky: colour-coded percentiles people screenshot, per-boss detail that explains the number.

### WoW Armory and PvP ladders (partial, from general knowledge)
- First screen: a bracket picker and a plain ranked table (rank, name, class, realm, rating, W/L).
- Filters: bracket, region, sometimes class/spec; search by name.
- Player page: gear, rating per bracket, achievements; guild page is a roster.
- Sticky: tied to the real character; the season reset makes the table fresh every few months.

### wowprogress (partial)
- First screen: realm or region table of guilds with progress counts per difficulty.
- Filters: region, realm, tier, faction/class on member boards; add-or-search box.
- Guild page: progression per tier, rank at realm/region/world level, raid teams inside a guild.
- Sticky: three rank scopes (realm, region, world) so a small guild can still be "first on its
  realm"; one commenter says some rankings are seen as off, so explaining the method matters.

### Check-pvp style sites (general knowledge, not fetched)
- First screen: a name box; result is a character card with rating, gear and talents.
- Value is the lookup, not the ladder: people paste a name before a match. Fast, link-friendly URLs.

### op.gg and u.gg (partial)
- First screen: search by name and region, champion tier list, a leaderboard link.
- Profile: rank card, win rate, most-played picks with KDA, tabs for stats and the live game.
- Sticky: the profile answers "how am I doing and what should I play" in one view; a refresh
  button and automatic updates keep it current. No confirmed rank-movement history.

### chess.com and lichess
- Lichess leaderboard page: one top-10 table per variant side by side, rows of rank, title,
  name, rating; an online-players list and a most-active list; no arrows or graphs on that page.
- Chess.com: one board per game type; a scope drop-down switches between global, friends,
  clubs and country; the player's own rank also appears on their stats page.
- Sticky: personal scopes (friends, club, country) make a huge ladder feel local; profile
  rating history charts keep people checking back.

### speedrun.com (partial)
- First screen: games with their top times; a game page has one leaderboard per category.
- Filters: category, variables (platform, version), verification status; a history tab lists
  every world record with how long it stood.
- Pages: runs have a detail page with video; players have a profile with their personal bests.
- Sticky: world record history, outdated runs kept as history, moderation notes, forums.

## 2. What we can show that they do not

Data Guilded already stores and that is public by owner decision (character names, guilds,
levels, classes, scores). Strongest differentiators are marked **[A]**.

- **[A] Guild plus Discord community link**: every ranking row can lead to a guild page with a
  join link; no other site ties the ladder to a community.
- **[A] Dungeon run route and deaths per run**: a run page showing the path through the dungeon,
  deaths and who died where; Raider.IO shows a time, not a story.
- **[A] Parties and who ran with whom**: a "ran with" list on player pages and a party card per run.
- **[A] Next best improvement**: each player page names one concrete target (boss, dungeon or
  role) that would raise the score most.
- **Role scores**: separate tank, healer and DPS scores on one player page.
- **[A] Records and 35 painted badges**: records board with who holds each and for how long,
  badges shown on rows, pages and share cards.
- **[A] Duels with rating and head-to-head**: rating curve, last results and a "you vs them"
  page for any two players.
- **World PvP stats**: kills, deaths, K/D and deadliest zones.
- **Race to 60**: a live board for the launch period, with a Hall of Fame afterwards.
- **Professions**: who crafts what, linked to craft requests.
- **Guild activity**: runs, duels and kills per week per guild, a guild of the week.

## 3. Recommended design

Landing page and navigation
- Season banner at the top: season name, start date, days left or countdown to the next weekly reset.
- Top-3 podium per board (Dungeons, Duels, World PvP, Guilds), each with class colour, guild tag
  and a "see full board" link.
- Live strip: latest runs and latest duels, newest first, each linking to its page.
- "Biggest climbers this week" and "Records broken" blocks, with the previous holder named.
- "Guild of the week" card with the Discord link.
- Tabs: Dungeons, Duels, PvP, Guilds, Players; one search box (character or guild) in the header.

Boards
- Filters for class, role, guild, dungeon or bracket and period (this week, season, all time),
  all kept in the URL so views can be shared and bookmarked.
- Rank-movement arrows against the previous week; a small trend bar or sparkline per row.
- Class colours on names; a badge or two on each row, no more.
- Empty states that say how to get on the board (install the addon and companion, run a dungeon
  or duel, link the character), with a link to the guide.

Pages
- Player page: score and rank per board, role scores, next best improvement, best runs with
  routes, duel rating and head-to-head, PvP stats, badges, professions, guild link.
- Guild page: roster with scores, activity of the week, records held, Discord link, guild badges.
- Run and duel pages: shareable, one card each.
- Share cards for runs, duels, records and weekly climbs, generated from the same data as the pages.

### Priority
**Must**
- Landing page with season banner, podiums, latest strip, climbers.
- Tabbed boards with search, URL filters, class colours, movement arrows.
- Player page and guild page with the Discord link.
- Empty states with onboarding steps.

**Should**
- Trend bars, records broken, guild of the week.
- Run page with route and deaths; duel head-to-head.
- Next best improvement and role scores on the player page.
- Share cards and badges on rows.

**Later**
- Rating history charts and personal scopes (friends, guild).
- Race to 60 Hall of Fame view and profession boards.
- Notifications (weekly digest in Discord) tied to the same data.

## Sources
- https://raider.io/ (fetched)
- https://lichess.org/player (fetched)
- https://articles.classic.warcraftlogs.com/help/rankings-and-parses
- https://support.chess.com/en/articles/8705280-what-are-leaderboards
- https://www.speedrun.com/news/94vwp28y-welcome-to-the-new-speedrun
- https://www.speedrun.com/support/learn/moderation-rules
- https://www.wowprogress.com/post/198_Introducing_Raid_Teams
- https://www.wowprogress.com/pve/eu/nordrassil
- https://u.gg/lol/profile/euw1/leonin%20-otp/overview
- https://www.wombocombo.gg/blog/summoner-lookup/opgg-vs-ugg-comparison
