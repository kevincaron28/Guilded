# WoW Forever armory: spike findings (Track I0, 6 November 2026)

Research only. No product code changed. Checked in the owner's Chrome, signed out, read-only, no API key used.
Subject: `Lebowski Holyroller` and the guild `Québec Gold`.

## Recommendation

**(b) Links only.** Put an "Armory" link on character cards and in `/character`-style output. Do not fetch, scrape or
parse the armory, and do not call any Blizzard API for Forever until Blizzard documents a Forever namespace.

- (a) Official API lookups: not possible today. No Forever namespace is documented, and the Developer API Terms
  require an API key, which this spike did not use.
- (c) Nothing: unnecessary, because links cost nothing and break nothing.

The addon and companion stay the source of truth; the link is a convenience that fails gracefully if Blizzard moves it.

## What exists

| Item | Finding |
| --- | --- |
| Landing | `https://worldofwarcraft.blizzard.com/en-us/forever/us/armory` (regions `us`, `eu`, `kr`, `tw`; only `us` checked) |
| Search | `.../armory?q=Lebowski+Holyroller` (query as `+`-encoded). Lists characters (name, level, class, PvP flag, guild) and guilds |
| Character page | `.../armory/character/lebowski-holyroller` |
| Guild page | `.../armory/guild/qu%C3%A9bec-gold` (accent percent-encoded UTF-8) |
| Locale | `en-us` is a path segment; `/forever/us/armory/...` without it redirects to the locale |
| Realm segment | **None.** Forever is one realm per region, so the URL is region + slug only |

Name encoding: lowercase, spaces become `-`, first **and** last name both included (`lebowski-holyroller`), accents
percent-encoded for guilds. Unchecked: names with apostrophes or accents, and how two characters whose slugs collide
are handled.

Shown on the character page: level, race, class, PvP flag, stats (health, mana, strength, intellect, agility, stamina,
spirit, crit), equipped item icons, professions with skill (for example `15 / 75`), honorable kills and rank, an
"Export character image" button. Guild is shown in search results. No "last updated" value was visible.
Guild page ("Guild Summary") shows a roster with a link to each member's character page, plus Roster Overview and Class
Breakdown tabs. Characters appear from level 10 and require the owner's Battle.net login to list their own characters.

## Network behaviour

Character and guild data load with the page (server-rendered): no JSON or XHR data request was seen, only the HTML
document, static assets (`assets-bwa.worldofwarcraft.blizzard.com`), navbar and consent scripts, and images from
`render.worldofwarcraft.com/forever-us/...` (`character/<n>/<id>-avatar.jpg`, `icons/56/<id>.jpg`). There is no public
endpoint to call, so any lookup would mean reading HTML.

## What is allowed

- `robots.txt` (`worldofwarcraft.blizzard.com`) disallows only the `/<locale>/login` pages, no crawl-delay.
- Blizzard's Developer API Terms of Use prohibit data mining, scraping, crawling and automated queries against any
  Blizzard website except through authorized Developer API use (36,000 calls per hour cap, confidential key, refresh or
  delete stored data on request). Reading armory HTML from the bot would fall under that clause.
- The developer docs (`community.developer.battle.net`, WoW Classic profile page) mention no Forever namespace.
  Blizzard's Profile API also never covered Classic characters. A web search found nothing official either.
- Linking a user to a public page is ordinary and needs none of the above.

## URL patterns for armory links (cards and embeds)

```
character: https://worldofwarcraft.blizzard.com/en-us/forever/{region}/armory/character/{slug}
guild:     https://worldofwarcraft.blizzard.com/en-us/forever/{region}/armory/guild/{guildSlug}
search:    https://worldofwarcraft.blizzard.com/en-us/forever/{region}/armory?q={name+with+plus}
```

- `slug` = full name lowercased, whitespace runs replaced by `-`, then `encodeURIComponent`.
- `guildSlug` = same rule applied to the guild name (`Québec Gold` becomes `qu%C3%A9bec-gold`).
- `region` = `us` for this community (EU, KR and TW follow the same pattern but were not opened).
- Fall back to the **search** URL when a name has characters the slug rule might mishandle (apostrophes, accents) or
  when unsure; search is the safest link because Blizzard resolves it.
- Label it "Armory", open in a new tab, never show it as verification of ownership.

## Re-check when

Blizzard publishes a Forever API namespace or a developer-portal entry; then reopen option (a) as optional enrichment
(cached, off-by-default, with an officer switch), keeping links as the fallback.
