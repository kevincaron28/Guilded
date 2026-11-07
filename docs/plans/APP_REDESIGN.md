# Phone app redesign plan (Track M, 7 November 2026)

Status: **plan plus a first slice (the News tab and its server feed).** PR #507 (guildmate map) has merged; the tab restructure is slice 2 and is its own PR, because it relocates the screens #489, #496 and #507 built.

## Owner goals (7 November)

See the guild roster and map; see guild stats; see my profile; the TCG game and the badges; help, dungeon and raid notifications; maybe a Blue post or Wowhead news section.

## Where the app is today

| Tab | What it does | From |
| --- | --- | --- |
| Home | This week's season, rated runs, top runs, links to the website | first version |
| Ranks | Public leaderboards, tap a guild for its public page (class mix, cores) | #489 |
| Guild | Sign-in, then chips: Characters, Reserves, Wishlist, Raids, Album, Alerts (+ Map once #507 lands) | first version, #496, #507 |
| Profile | Text and two website links | first version |

Problems: Guild is a seven-chip junior app inside a tab; the roster the owner asked for is hidden behind Characters/Raids; Profile is empty while the badges live in Guild; Home and Ranks overlap; there is no place for news; reminders sit in the same chip row as wishlists.

## Proposed structure: five tabs

| Tab | Contains | Source |
| --- | --- | --- |
| **Guild** | Roster (cores, classes, roles, rank), Map (last seen, heat map, help pins), Raids (next raid, sign-up status) | hub, standings, guild-map (#507) |
| **Stats** | Public leaderboards, my guild's standings (EP/GP), class mix, season summary (today's Home and Ranks merged) | #489, standings |
| **Me** | Profile (my characters, ratings), Badges + Album (#496), later the TCG; language, sign-out, privacy switches (share my position) | hub, companion/achievements |
| **Alerts** | One list: raid reminders (on-device today), dungeon and help-call alerts (waiting for #345 push), per-type switches | notify.ts, #345 |
| **News** | Headlines with links to Wowhead and Blizzard; nothing copied | new, below |

Rules: a member who is not signed in sees Stats and News (public) and a sign-in card in place of Guild, Me and Alerts. The sample-guild preview stays and covers all five tabs. Sign-out lives in Me only. The Windows companion keeps desktop-only work.

### What changes in each existing screen

- **#489 PublicBoards** moves unchanged into Stats as its first section; Home's season summary becomes Stats' header card.
- **#496 AlbumScreen** moves from a Guild chip into Me, under a Badges heading (progress bar plus the album grid). Same component, same endpoint.
- **#507 MapScreen** becomes the second segment of Guild (Roster | Map | Raids). Same component and endpoint.
- **GuildScreen** is split: the sign-in flow, Characters/Reserves (the roster) and Raids stay in Guild; Wishlist moves to Me (it is per character); Alerts becomes its own tab. Nothing is deleted, and storage keys and the session are untouched.
- **Home** is retired once Stats has its card; the first tab opened is Guild when signed in, Stats otherwise.

## Visual direction

Keep the existing dark palette (`#0b0c0b` ground, `#151714` panels, gold `#d5ad57`, green `#9fbd83`), which already matches the website, and tighten it:

- one header: GUILDED wordmark left, a small sync dot and the guild name right; no big hero titles per tab;
- bottom tab bar with line icons (text-only today), gold for the selected tab, 44 px targets;
- segmented control (pill row) for the sections inside a tab, the same chip style as now;
- cards with a 3 px top edge in the item's colour (tier colour on badges, class colour on characters), the language already used in the album;
- WoW class colours for names, item-quality colours (Common to Legendary) for rarity, as the TCG plan proposes;
- no Blizzard art; Guilded's own glyphs and original drawings only;
- text sizes: 13 body, 11 secondary, 20 section titles; EN/FR everywhere.

### Components (shared, in `mobile/src/ui/`)

`Screen` (scroll plus pull to refresh), `SegmentedTabs`, `Card` (optional colour edge), `StatTile`, `ProgressBar`, `Medal` (the badge medal from the album), `ClassName` (coloured name), `EmptyState`, `RetryCard`, `Row` (rank, name, sub, score). Today each screen redefines these styles; extracting them is the bulk of the work and removes about 150 duplicated style lines.

## News: Wowhead and Blizzard

Goal: headlines with links, nothing more. The app never shows or stores article text.

| Source | What exists | Plan |
| --- | --- | --- |
| **Wowhead** | A public RSS 2.0 feed at `https://www.wowhead.com/news/rss/all` (checked 7 November: valid, `ttl` 30 minutes, title, link, date per item). Its terms page (`/tos`) says nothing about feeds or reuse. | Fetch server-side, keep **title, link, date only**, show "Wowhead" as the source, link out. Cache 30 minutes (the feed's own ttl), one fetch per bot, never one per phone. |
| **Blizzard** | `news.blizzard.com` is a normal site; no feed or public JSON found on the WoW page. | No scraping. A fixed "Blizzard news" button that opens `news.blizzard.com/en-us/world-of-warcraft`. If Blizzard publishes an official feed later, add it as a second source. |

**Terms status: not confirmed.** Wowhead's terms are silent, which is not permission. Headlines plus links with attribution is what any feed reader or aggregator does and sends traffic to the source, but the owner should decide whether to email Wowhead before launch. The feed is behind a kill switch (`NEWS_FEED_ENABLED`, default on; off hides the section and the app shows only the Blizzard button) so it can be removed in one setting. Not used: article bodies, images, summaries, comments.

Server: `GET /news/headlines.json` on the public site (read-only, no credential, `cache-control: public, max-age=300`) returns `{ source, fetchedAt, items: [{ title, url, publishedAt }] }`, 20 items, links only to `https://www.wowhead.com/`. On a fetch failure it serves the last good list for up to 24 hours, then an empty list. Titles are plain text, length-capped, and the app opens links in the system browser.

## Notifications (stays a hook)

The Alerts tab lists what exists: on-device raid reminders. Dungeon-ready and help-call alerts are drawn as switched-off rows labelled "needs push" until PR #345 and Firebase land; the hook is `onHelpCallStored` in `src/services/guild-map.ts`. No new push infrastructure here.

## Slices

1. **This PR:** this plan, the news feed and a News tab in the current app (the tab bar becomes Home, Ranks, Guild, Profile, News; it is replaced by the five-tab bar in slice 3).
2. Next PR (#507 has merged): extract `mobile/src/ui/`, move Album/Map/Wishlist as above.
3. Five-tab shell, sample guild across all tabs, retire Home.
4. TCG tab inside Me (option 2 of `APP_TCG.md`), Alerts rows turned on with #345.

Risks: the restructure touches three recently merged screens; keep each move a pure relocation with its tests unchanged. Wowhead could change or close the feed: the kill switch and the empty state cover it.
