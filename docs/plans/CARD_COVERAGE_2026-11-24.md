# Card coverage and badge audit — 24 November 2026

Owner request: "make sure all emblems, badges etc. are optimal and we have cards for every message that can or should use one, complete anything you think is missing."

Method: every `.send(`, `enqueueDiscordJob(... "MESSAGE" ...)`, `notify*` and DM call in `src/` was listed and classified, and every `ScoreCard` builder (`export function ...: ScoreCard`) was traced to its caller. This replaces the card list of `docs/plans/CARD_AUDIT_2026-11-16.md` (the old framed layout it complains about is gone: recap, roster, stats, unlock and empty cards all use the banner or body layouts of `card-next*.ts` now).

Legend: **Card** = a card is drawn today. **Added** = added by this change (24 Nov). **Text** = plain text or an embed is the right form. **Gap** = should have one, left out (reason given).

## Cards that exist (about 40 builders, all wired)

| Message | Builder | Where it is sent | Background |
|---|---|---|---|
| Dungeon run result | `dungeonRunCard` | dungeon announce, receipts | the dungeon's painting (every one of the 39 dungeons has one) |
| New guild record | `recordCard` | import follow-up | dungeon painting |
| Duel result / duel summary | `duelResultCard`, `duelSummaryCard` | duel cards job | `board/duel` |
| Duel ladder, battleground ladder, world PvP board, crafters, dungeon season board, community board, race to 60 | `duelBoardCard`, `bgLadderCard`, `worldPvpCard`, `craftLadderCard`, the card in `dungeon-leaderboard.ts`, `communityBoardCard`, `raceCard` | board jobs | one painting each |
| Hall of fame (reached 60) | `hallCard` | race board | `board/hall-of-fame` |
| Battleground end | `battlegroundEndCard` | `/battleground` | per map (3 of 6 maps) |
| Raid end report | `raidEndCard` | raid report | per raid (3 raids + default) |
| Raid night check | `raidNightCard` | readiness job and `/readiness` | `raid/night-check` (missing, falls back) |
| Daily recap, server stats, member trend | `dailyRecapCard`, `serverStatsCard`, `memberTrendCard` | daily job, `/stats` | recap dawn/day/night, `board/server-stats` (missing, falls back) |
| Weekly report, weekly dungeon card, weekly records | `weeklyReportCard`, `weeklyDungeonCard`, `weeklyRecordsCard` | WoW weekly job | `board/weekly`, recap scenes |
| Weekly honors, MVP, rookie of the week | `weeklyHonorsCard`, `weeklyMvpCard`, `weeklyRookieCard` | community honors | `board/hall-of-fame`, `rookie-of-the-week` |
| Personal weekly recap | `personalWeeklyRecapCard` | personal recap | `board/weekly` |
| Season end, season start (dungeons) | `seasonEndCard`, `seasonStartCard` | season rotation | `season-end`, `season-start` |
| World PvP weekly recap | `worldPvpRecapCard` | PvP recap job | `world-pvp-recap` |
| PvP group call | `pvpGroupCard` | PvP finder post | battleground default |
| Welcome | `welcomeCard` | join (DM and channel) | `board/member-welcome` |
| Promotion congratulations | `promotionCard` | promotion job | one painting per rank tier |
| Guild bank donor thank-you (one donor, combined, past donors) | `donationCard`, `combinedDonationCard` | bank donations job | donor scene |
| Achievements list, achievement unlocked | `achievementsCard`, `achievementUnlockedCard` | `/achievements`, unlock job | `board/achievements`, `achievement-unlocked` |
| Server anniversary | `serverAnniversaryCard` | anniversary job | `board/anniversary` (missing, falls back to community) |
| Roster picture | `rosterVisualCard` | `/guild-health roster` | `roster/default` |
| Profession link card | `profession-link-card` | profession links | none (item icons) |

## Gaps found and filled in this change

| Message | Before | Now | Background |
|---|---|---|---|
| Community badge milestone ("Congratulations ... 300 community points") | one text line | **Added**: `communityMilestoneCard`, the badge as a hero (painted tier frame + coin pouch), the member's avatar when available, text kept | `board/achievement-unlocked` |
| `/community badges` (a member's season shelf) | text list only | **Added**: `communityShelfCard`, up to 8 painted badges and a count, attached to the reply; the text list stays | `board/achievements` |
| Monthly community season rotation ("season is over / new season starts") | one text post | **Added**: `communitySeasonStartCard`; the text keeps only the line about the season that ended | `board/season-start` (falls back to `dungeon-season`) |
| Monthly honors ("Top 3 of the season" + monthly rookie) | embed only, while the weekly post has a card | **Added**: `communityFinalCard` in the community podium layout; the text keeps the congratulations line, the notes and the rookie field | `board/community` (falls back to `season-podium`) |
| Guild bank weekly summary (officer log) | embed only | **Added**: `guildBankWeekCard` (gold now and change, log lines, open requests, top depositors, a low-stock pill); the embed keeps the per-member lines and the low-stock list | `board/guild-bank` (missing, falls back to `community`) |

All five keep the old text as the fallback: if the renderer cannot draw, the old post goes out unchanged. No new setting and no new automatic message: each replaces or enriches a message that already existed, and each follows the switches that already governed it.

## Text is the right form (no card)

- Errors, confirmations, "Done", permission refusals, ephemeral command replies.
- Officer and owner logs: message edit and delete log, moderation warnings, owner console, error report, bug inbox, sync-health alert, update notice, version announcement, trial reminders, channel archive.
- Short reminders and notices: raid reminders, game reminders (DM), cooldown-ready DM, Season 2 reminder (DM), invite flow lines (`/ginvite` notices, do-not-invite, invite expiry), craft order lines and thread closing, outbid and promoted/bumped DMs, device claim offer, link conflict DM, companion link DM, 9.3.7 notice DM, pilot approval DMs.
- Raid started, raid ended, boss killed, loot awarded, EP/GP changed, decay applied (one line each; the raid end report and loot item previews carry the visuals).
- Panels that are interactive embeds with buttons: polls and news, weekly question, raid sign-up and team posts, PUG posts, gaming-night announcements, nomination review cards (officer-only buttons), guild bank low-stock alert and bank requests, application cards, recruiting kit, setup guide posts, onboarding panels (they already carry painted panel pictures).
- Rank-roles digest, promotion log line (`promotionLogLine`): a one-line log. The promotion itself has its card.
- Starboard repost, farewell line, item preview embeds.

## Gaps left on purpose

- **Loot awarded / raid boss killed**: could be cards, but they are one-liners posted many times a night; a picture each would flood the channel. The raid end report card summarises them.
- **Guild bank low-stock alert**: an actionable alert with an item list; text is faster to read.
- **Crafting "Crafted by X"** closing line: thread housekeeping.
- **Companion linked DM**: private confirmation; text is right.

## Badges and emblems audit

Checked: all 116 achievements resolve to a painted emblem (none falls to the old SVG badge); every emblem named in `FAMILY_EMBLEM`, `METRIC_EMBLEMS` and `ITEM_EMBLEMS` exists in `site/badge-art/emblems` at 128 and 256 px; all six tier frames exist at both sizes; every emblem file is exactly its stated size; the 9 class emblems and 3 role emblems exist (64 px for a 20 px display: 3x, sharp); the 3 role badges used on dungeon cards exist at 128 px (drawn at 38 px); all 39 dungeons have a painting; 24 board/battleground/raid/recap/promotion/roster backdrops exist.

Problems found:

1. **Gold and auction badges drew a war horn** (`goldTier` 4, `auctionSoldTier` 3, `auctionProfitTier` 3: 10 achievements on `guild-horn`, the family fallback). **Fixed here**: they now use the coin pouch (`guild-pouch`), the closest existing emblem. A dedicated one is on the art list below.
2. **Four emblems are never drawn**: `seasons-attendee`, `seasons-helper`, `seasons-organizer`, `seasons-laurel`. They were made for the community badges (helper, attendee, organizer, legacy) which had no picture anywhere. **Fixed here**: the new shelf and milestone cards use them (`community-cards.ts`, covered by `tests/community-cards.test.ts`).
3. **`ingame-*` emblems look unused** in a static count only because the in-game (generated) achievements are loaded at run time; they are wired (`generatedEmblem`).
4. **Role badge art has no 256 px size**: fine today (drawn at 38 px), noted in case a hero role badge is ever wanted.
5. **Fallback paintings** (a card asks for a key whose file is missing and silently falls back): `board/anniversary`, `board/server-stats`, `raid/night-check`, plus the new `board/guild-bank`. They draw well on the fallback; see the art list.
6. **Battleground and raid coverage**: only Alterac Valley, Arathi Basin and Warsong Gulch have their own painting (Eye of the Storm, Strand of the Ancients, Isle of Conquest fall to `battleground/default`); raids: Molten Core, Onyxia's Lair and Blackwing Lair have one, every other raid falls to `raid/default` (the 9 December launch raids need checking).
7. Several metrics share their family emblem (dungeon runs, raid attendance and EP, honorable kills, duel wins, level and profession tiers). That is intentional (the tier frame tells them apart) and not a defect.

## Art needed (for the art session)

| Subject | Size and place | Why |
|---|---|---|
| Gold coins / coin stack emblem, painted metal medallion style like the others | `site/badge-art/emblems/guild-coins-256.webp` and `-128.webp`, transparent, then add to `METRIC_EMBLEMS` for `goldTier` | gold achievements currently use the community pouch |
| Auction house emblem (scales, hammer or ledger) | `site/badge-art/emblems/guild-auction-256.webp` and `-128.webp` | `auctionSoldTier` and `auctionProfitTier` |
| Guild bank scene (a vault or chest room) | `site/card-art/board/guild-bank.jpg`, 1200x630 | the new weekly bank card (falls back to `community`) |
| Server anniversary celebration (banners, fireworks) | `site/card-art/board/anniversary.jpg`, 1200x630 | anniversary card (falls back to `community`) |
| Server statistics (a map room or observatory) | `site/card-art/board/server-stats.jpg`, 1200x630 | stats card (falls back to `community`) |
| Raid night preparation (raiders gathering before a portal) | `site/card-art/raid/night-check.jpg`, 1200x630 | raid night check (falls back to `raid/default`) |
| Eye of the Storm, Strand of the Ancients, Isle of Conquest | `site/card-art/battleground/<map-slug>.jpg`, 1200x630 | battleground end card (falls back to `default`) |
| One painting per launch raid not yet covered | `site/card-art/raid/<slug>.jpg`, 1200x630, plus a pattern in `raidArtKey` (`end-cards.ts`) | raid end card |
| Optional: role badges at 256 px | `site/badge-art/roles/<role>-256.webp` | only if a hero role badge is wanted |

Backdrops are darkened and contrast-checked by `card-backdrop.ts`; art for cards with text on the left should keep the left third calm.
