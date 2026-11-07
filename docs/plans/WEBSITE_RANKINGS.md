# Website rankings: what the reference sites show, and what we build

Owner request, 7 November 2026: use WoW Forever Meta (`wowforevermeta.io/en/guilds`) and Raider.IO's
Forever site (`forever.raider.io`) as references for our public pages: `/leaderboards/`,
`/leaderboards/guilds/`, the guild directory, `/g/<slug>/` and player pages.

**Reference means features and information design only.** We do not copy their text, art,
layout code or branding. Every number we show comes from Guilded's own data; nothing is invented.

## How this was researched

Both sites render with JavaScript. A plain fetch on 7 November returned only the page titles
("Real-Time Armory, Talent Builds & BiS Gear" for WoW Forever Meta; "Leveling Leaderboards,
Character Search and Profiles" for Raider.IO Forever). The rest of this comparison describes
these sites as they are generally known (Raider.IO's long-standing layout, and WoW Forever Meta's
guild list), not a fresh reading of today's pages. Check them in a browser before relying on a
detail.

## What they show

| Feature | WoW Forever Meta (guilds) | Raider.IO (Forever) |
| --- | --- | --- |
| Guild list ranked by a number | Yes: gear score | Yes: progress / score |
| Faction filter | Yes | Yes |
| Realm / region filter | Yes | Yes |
| Name search | Yes | Yes (global search box) |
| Roster size | Yes | Yes |
| Gear (item level / gear score) | Yes, the main column | Per character |
| PvP (kills / honour) | Yes | No |
| Character rankings | Armory pages | Rankings per class, role and realm, with rank column, class colours and score |
| Medals for top 3 | No | Gold / silver / bronze styling |
| Best runs per character | No | Yes, with the run's key, time and score |
| Pagination | Yes | Yes, numbered pages |
| Run detail page | No | Yes: party with class/role, time vs timer, deaths, score |
| Guild page | Roster, gear | Roster, top characters, recent runs, progress |
| Levelling race | No | Yes (Forever: levelling leaderboards) |

## What we had before this change

- `/leaderboards/`: top runs this week, top 25 characters per level bracket, dungeon records,
  top guilds; season, week, bracket, dungeon, class, role, realm and "confirmed" filters.
- `/leaderboards/guilds/`: guilds ranked by their five best members' scores per bracket, plus a
  plain list of guilds. No filters, no search, no other columns.
- `/leaderboards/character/<Name-Realm>`: score, role scores, next improvement, best run per
  dungeon, recent runs, score history, a share card.
- `/leaderboards/run/<id>`: one paragraph (time, score, party names) and a share card link.
- `/leaderboards/guild/<id>`: members' scores per bracket, recent runs, duels tab.
- `/recruitment/guilds/`: the guild directory (cards, name search, faction, language, recruiting).
- `/g/<slug>/`: what officers publish (cores, loot rules, rosters, EPGP ranking, recruitment),
  with links to the guild's dungeon and duel boards.

## What we lacked, and what this change adds

| Gap | Built here |
| --- | --- |
| Guild leaderboard with columns and filters | `/leaderboards/guilds/` now opens with one dense table of every listed guild: rank, guild, faction, realm, members, linked members, characters at 60 out of those with a known level, average level, best dungeon score, rated characters, public runs, dungeon records held, counted duels. Filters: name search, faction, realm, WoW version (the existing edition switch), and sort. The per-bracket tables stay below. |
| Character rankings with pagination | `/leaderboards/characters/`: every rated character in one bracket, 50 per page, with rank, top-3 medals, class colours, realm, role, score and the best runs that count (each linking to its run page). Class, role and realm filters as on the main board. |
| Run detail | `/leaderboards/run/<id>`: summary tiles (time, score, bracket, deaths, season), the party table (class colour, class, role, level, time present), evidence badges and the run card image drawn on the page. |
| Guild page dungeon section | `/g/<slug>/` shows, for a guild that publishes its runs, its top characters this season, its recent public runs and the dungeon records its members hold. |

## Kept out, on purpose

- **Gear score.** We have no gear data (an armory spike runs in another session). The guild
  table has no gear column and the doc of the page says so; add the column when the armory lands.
- **PvP kills / honour.** The battleground capture records outcomes, not kills, and the
  battleground ladder is a guild-only Discord board. The public table shows counted guild duels
  only, which the guild's public duel board already shows.
- **Names from guild-only boards.** The race to 60 board and battleground ladder name members in
  Discord only. The public table shows counts (characters at 60, average level), never names, and
  skips members who hid themselves from the race board and test members. Members who used "Delete
  my data" have no rows left to count.
- **Which guilds are listed.** Guilds that publish their runs (always on since 9.0) or published a
  guild page, and only servers the hosted pilot allows. Faction and realm come from the guild's open
  recruitment listing (we store no guild faction otherwise); realm falls back to the most common
  realm among members' characters.
- **Test servers.** When the server-hygiene session's test-server flag lands, the guild store
  filters on it (see the PR).

## Decision for the coordinator

Member counts, linked-member counts and level counts were not public before. They are
aggregates (no names) for guilds that opted into public pages. If the owner prefers them hidden,
drop the four columns in `guildOverviewTable` (`src/services/public-leaderboard.ts`).
