# Achievements and badges

125 rows (117 can be earned; 8 are legacy, see below), computed only from data Guilded already recorded. Nothing is self-reported, nothing
awards points, and nothing is posted to Discord automatically.

## Where things live

| Piece | File |
| --- | --- |
| Catalogue (id, EN/FR name and description, game, tier, metric, threshold) | `src/services/achievements-catalogue.ts` |
| Evaluation and storage | `src/services/achievements.ts` |
| Share card (WoW theme, `score-card.ts`) | `achievementsCard` in `src/services/end-cards.ts` |
| Badge artwork (SVG glyphs, tier frames, locked silhouettes) | `src/services/achievement-badges.ts` |
| Discord | `/character achievements [member]` (`src/commands/achievements.ts`) |
| Website | `/me/` section and public player page (`src/services/achievements-web.ts`), card image at `/me/achievements.png` and `/players/<id>/achievements.png` |
| Activity counters | `ActivityBuffer` / `createActivityTracker` in `src/services/activity-totals.ts`, wired in `src/main.ts` |
| Tables | `MemberAchievement`, `PoeLevelReached` (migration `20261206000000_member_achievements`), `MemberActivityTotal` (migration `20261210000000_member_activity_totals`) |

## Where each metric comes from

| Metric | Source |
| --- | --- |
| WoW level (per edition) | highest `Character.level` among the member's synced characters of that `gameEdition` |
| Maximum level / alts (per edition) | characters of that edition at its cap (`WOW_LEVEL_CAP`: forever 60 (fixed, per Blizzard), era 60, TBC 70, Mists 90, retail 90) |
| Dungeon variety | first completion of each distinct dungeon (`DungeonRun.instanceId`) |
| Profession skill (per edition) | highest `ProfessionSkill.skillLevel` on a character of that edition (Forever and Era 300, TBC 375, Mists 600; Retail has none because its skill is per expansion) |
| Dungeon runs | `DungeonRunPlayer` rows of valid, completed `DungeonRun`s |
| Raids attended | `RaidAttendance` PRESENT, LATE or BENCHED on a COMPLETED, non-test raid |
| Raid clears | those raids where every `RaidBoss` is KILLED |
| Active days | distinct days in `CommunityParticipationDay` with messages, reactions or voice |
| PoE2 level | `PoeLevelReached`, from the member's own client log ("is now level N") |
| PoE2 maps | distinct `PoeMapVisit` instances |
| Messages sent | larger of `MemberActivityTotal.messages` and the sum of `CommunityParticipationDay.messages` |
| Voice hours | larger of `MemberActivityTotal.voiceSeconds` and `CommunityParticipationDay.voiceMs`, in whole hours |
| Reactions given | larger of `MemberActivityTotal.reactionsGiven` and the participation reaction awards where the member is the actor |
| Reactions received | larger of `MemberActivityTotal.reactionsReceived` and `CommunityParticipationDay.reactions` |
| Community points | sum of `CommunityPoint` AWARD and REVERSAL rows across the guild's seasons (the leaderboard sum), never below 0 |
| EP earned | sum of positive `EpgpTransaction.epAmount` of type EP_AWARD |

## Behaviour

- **Trigger.** Viewing: `/character achievements`, the signed-in `/me/` page, or the card image there.
  The public player page and its card only read stored rows. There is no scheduled job.
- **Idempotent.** `@@unique([guildId, memberId, key])` plus `createMany(skipDuplicates)`; an earned row is
  never changed or removed, so an achievement stays earned if the underlying data later shrinks.
- **Dates.** Counted achievements use the date of the Nth recorded event; PoE2 levels use the log's own
  time; WoW levels keep no history, so they are dated when first seen.
- **Default on.** `GuildSettings.achievementsEnabled` defaults true (existing guilds too, via the migration `20261207000000_achievements_default_on`); it is only a kill switch, with no command yet. The command and website skip a guild where it is false.
- **No automation.** No DMs, channel posts or points. An announcement would be a separate per-guild opt-in
  (see `docs/archive` and `opt_in_automation`); not built.
- **Web privacy.** Only members of guilds the site serves (`hostedPilot.allows`), only for public
  profiles; a hidden profile shows nothing publicly.

## WoW achievements per edition

Level, level-cap and profession rows exist once per edition (`wow-<edition>-level-N`, `-alts-3`,
`-profession-N`; editions `forever`, `classic-era`, `classic-tbc`, `classic-mists`, `retail`) and read only
characters whose `gameEdition` matches, so a Retail 90 earns nothing for Forever. Levels step by 10 up to the
edition's cap, so none is unreachable: **WoW Forever is fixed at 60** (Blizzard: growth is horizontal;
`docs/archive/PRE_RELEASE_AUDIT_2026-10-22.md`), Era 60, TBC 70, Mists 90, Retail 90. There is no Wrath
edition in Guilded, so no level 80 row. Each edition has its own badge colour and glyph and names itself
("Forever: Level 40" / "Forever : niveau 40"). The website lists them in one section per edition.

Dungeon runs, raids, Discord activity and the other guild rows stay common: runs and raid attendance do not
record an edition, and they describe the guild, not a character.

**Legacy rows.** The first WoW rows ignored the edition (`wow-level-20/40/60/80`, `wow-max-level`,
`wow-max-level-3`, `profession-150/300`). They are flagged `legacy`: never awarded again, but a row a member
already earned stays earned (never deleted, never re-announced) and is still listed on the website
("earlier achievements") and the card. `ACHIEVEMENT_CATALOGUE_VERSION` is 3, so the first hourly pass after
deploy records what history already earns for the new rows silently in every guild that announces.

The website tiles are expandable without script (the CSP forbids it): a hidden checkbox plus label, so a tap,
click or Space toggles the panel; with a mouse, hover or keyboard focus also shows it.

## Activity totals and long progressions

Season participation is a capped lower bound (10 messages a day, a five-minute cooldown, tracked channels
only, and only while a Discord season with participation is on), so it cannot show a real "messages sent"
number. Guilded therefore keeps one small counter row per member (`MemberActivityTotal`): messages, reactions
given and received, and voice seconds. It stores numbers only, never message text, needs no privileged intent
(a message event carries its author without Message Content) and counts only guilds with achievements on.

- **What counts.** Messages from people (not bots, webhooks or system messages; bursts under 2 s count once),
  in any channel the bot can see. Reactions added by people, once per message and person (toggling does not
  repeat), as given for the reactor and received for the author (not on your own message, not on a bot's).
  Voice: each minute, everyone in a voice channel with at least one other person, not deafened and not in the
  AFK channel, is credited the time since the last check.
- **Only from deploy onward.** The counters start at zero when this release is deployed. Earlier history counts
  only through the season participation record (the larger of the two is used), so long-time members may start
  with less than they really did. Voice and reaction totals before then are not recoverable.
- **Cost.** Increments are buffered in memory and written about once a minute (one upsert per active member).
  A restart can lose up to a minute of counts. A failed write keeps its counts for the next flush.
- **Dates.** Totals keep no event history, so these achievements are dated when first seen at the threshold
  (the next view or the hourly pass when announcements are on).
- **Long progressions.** `ladder()` in the catalogue builds them: messages (10 steps, 100 to 250,000), voice
  hours (8, 1 to 1,000), reactions given (7), reactions received (5), community points (7) and EP (4). The
  badge shows the step as pips under the glyph; tiers now run bronze, silver, gold, platinum, epic, legendary.
  The card and the website "next up" strip show only the top earned and the next unearned step of a ladder.
- **No flood on announcing guilds.** `ACHIEVEMENT_CATALOGUE_VERSION` is bumped when rows are added that history
  already satisfies. A guild that announces is baselined once, silently, by the next hourly pass
  (`GuildSettings.achievementBaselineVersion`); nothing is announced for it until then.

## Open item: PoE2 levels need a companion release

`PoeLevelReached` is filled through `POST /api/v1/poe/levels` (added to the Worker allow-list in
`worker/index.mjs`; Worker redeploy needed). The companion does not send levels yet: `companion/poe-events.mjs`
must parse the client-log line for a level-up and the engine must upload it like visits. Until then the four
PoE2 level achievements (75, 90, 99, 100) stay locked; the two map-count achievements work today. Verify the
exact PoE2 log wording against a real `Client.txt` before writing the parser.

## Badge artwork

Generated from `achievement-badges.ts`: tier picks the frame and metal (bronze circle, silver hexagon, gold shield, platinum octagon, epic spiked star with gem, legendary sunburst with gem; long progressions add rank pips), game picks the plate and glyph colours (WoW blue and gold, guild green, PoE2 ember on dark red), and `GLYPH_BY_ID` picks the glyph. Locked badges are dark greyscale. The same SVG is drawn on the share card and inlined on the website (decorative, with name, tier and status kept as text). All artwork is original.

## Adding an achievement

Add a row to `ACHIEVEMENTS` and a glyph in `GLYPH_BY_ID` (a test fails without it). Never reuse or rename an id. A new kind of measurement needs a case in
`measure()` and a fact in `gatherAchievementFacts()`.

## Sharing and announcements

- **Share.** `/character achievements` replies privately with a "Share to channel" button. One click posts the same
  card in the current channel as the member who clicked (no pings, 2 minute cooldown per member). The clicker must
  be able to post and attach files there, and another member's card is not shared if their profile is hidden.
- **Announcements (opt-in, default off).** `/config achievements announce:true channel:#...` turns on celebration
  posts (`GuildSettings.achievementAnnounceEnabled`, `achievementChannelId`). Switching on first evaluates every
  active member and marks everything already earned as announced, so nothing is backfilled. After that an hourly pass
  (and any `/character achievements` view) evaluates members, and each member's new unlocks become ONE queued
  `MESSAGE` job (`route: "achievements"`, so delivery is retried and rate-limited, and re-checks the setting). Only
  that member is mentioned. A member with a hidden web profile is skipped (their rows are marked announced). The claim
  is a transaction on `MemberAchievement.announcedAt`, so a restart or concurrent pass cannot post twice. A posting
  failure never blocks evaluation. Turning it off posts nothing and keeps recording.
