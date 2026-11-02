# Achievements and badges

31 achievements, computed only from data Guilded already recorded. Nothing is self-reported, nothing
awards points, and nothing is posted to Discord automatically.

## Where things live

| Piece | File |
| --- | --- |
| Catalogue (id, EN/FR name and description, game, tier, metric, threshold) | `src/services/achievements-catalogue.ts` |
| Evaluation and storage | `src/services/achievements.ts` |
| Share card (WoW theme, `score-card.ts`) | `achievementsCard` in `src/services/end-cards.ts` |
| Discord | `/character achievements [member]` (`src/commands/achievements.ts`) |
| Website | `/me/` section and public player page (`src/services/achievements-web.ts`), card image at `/me/achievements.png` and `/players/<id>/achievements.png` |
| Tables | `MemberAchievement`, `PoeLevelReached` (migration `20261206000000_member_achievements`) |

## Where each metric comes from

| Metric | Source |
| --- | --- |
| WoW level | highest `Character.level` among the member's synced characters |
| Maximum level | characters at the cap of their edition (`WOW_LEVEL_CAP`: forever 60 (fixed, per Blizzard), era 60, TBC 70, Mists 90, retail 90) |
| Dungeon variety | first completion of each distinct dungeon (`DungeonRun.instanceId`) |
| Profession skill | highest `ProfessionSkill.skillLevel` (300 is the Era and Forever cap) |
| Dungeon runs | `DungeonRunPlayer` rows of valid, completed `DungeonRun`s |
| Raids attended | `RaidAttendance` PRESENT, LATE or BENCHED on a COMPLETED, non-test raid |
| Raid clears | those raids where every `RaidBoss` is KILLED |
| Active days | distinct days in `CommunityParticipationDay` with messages, reactions or voice |
| PoE2 level | `PoeLevelReached`, from the member's own client log ("is now level N") |
| PoE2 maps | distinct `PoeMapVisit` instances |

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

## Open item: PoE2 levels need a companion release

`PoeLevelReached` is filled through `POST /api/v1/poe/levels` (added to the Worker allow-list in
`worker/index.mjs`; Worker redeploy needed). The companion does not send levels yet: `companion/poe-events.mjs`
must parse the client-log line for a level-up and the engine must upload it like visits. Until then the four
PoE2 level achievements (75, 90, 99, 100) stay locked; the two map-count achievements work today. Verify the
exact PoE2 log wording against a real `Client.txt` before writing the parser.

## Adding an achievement

Add a row to `ACHIEVEMENTS`. Never reuse or rename an id. A new kind of measurement needs a case in
`measure()` and a fact in `gatherAchievementFacts()`.
