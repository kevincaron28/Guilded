# Website rankings: comparison with two reference sites (7 November 2026)

References for features and information design only. Nothing is copied: no text, art, layout code or branding.
Sources read: https://forever.raider.io/ (home page) and https://wowforevermeta.io/en/guilds (the fetch returned only
its title and tagline, so its guild table could not be inspected; the guild-leaderboard ideas below come from the
owner's brief, not from verified observation).

## What the references show

**Forever Raider.IO (home page):** a global search for characters and guilds; a top-10 overall list (rank, race
avatar, name, level, region and ruleset tags, guild tag, item level on some rows); one short top-5 per class with a
"view all" link; filters by region, ruleset and class (visible in the URL paths); a recent-activity feed; links to
an advanced search and an API.

**WoW Forever Meta (guilds):** per the brief, a ranked list of every public guild with faction, realm and edition
filters and dense columns. Not verified.

## What Guilded has and lacks

| Idea | Guilded today | Action |
| --- | --- | --- |
| Character ranking by season, class, role, realm filters | Yes: `/leaderboards/` (season, week, dungeon, bracket, class, role, realm, confirmed) | none |
| Class colours, score, best runs | Yes | none |
| Per-class top lists | Class filter only | later |
| Run detail pages | Yes: `/leaderboards/run/<id>` with a card image | none |
| Guild ranking per level bracket | Yes: `/leaderboards/guilds/` | medals added to the top three |
| One dense table of every public guild | Only a bullet list | **built here**: search, sort, columns |
| Guild columns from our data | Score, rated players | **added**: linked characters, best character, guild page and duel links |
| Faction and realm filters for guilds | No data on the public guild record | later: needs the guild's faction and realm exposed as public fields |
| Race to 60, Hall of Fame, PvP ladder points per guild | Discord boards only, no public web page | later: needs opt-in public routes first |
| Average level or number at 60 | Not public | later, same reason |
| Global search box | Guild search only | later: characters search |
| Pagination | Boards are capped at 50 rows | later |
| Gear score / item level | No gear data (armory spike pending) | **left out**: the page says so; no invented numbers |
| Recent activity feed | No | later |

## Rules kept

Only guilds that opted into public runs appear; counts come from the same rankings and active-member roster already
used for scoring; members who left or deleted their data are not in the roster; servers the public filter excludes
stay excluded (test servers: merge the server-hygiene flag before relying on it).
