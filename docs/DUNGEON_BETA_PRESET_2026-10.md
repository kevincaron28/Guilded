# October beta competition: researched ranges and provisional targets

Prepared October 13, 2026. Owner explicitly chose provisional targets so the short
season can start. This supersedes the earlier requirement to wait for calibrated
times in DUNGEON_SEASON_RATING.md. No reliable published full-run timer set was
found for this beta. **Every timer below is a guild design choice, not an official
timer or an empirical average.** The preset and UI label them provisional.

## Frozen preset

| Dungeon / wing | Competitive party levels | Target |
| --- | --- | --- |
| Ragefire Chasm | 13–18 | 20 min |
| The Hall of Thanes | 13–20 | 25 min |
| Wailing Caverns | 15–24 | 40 min |
| Ruins of Lordaeron | 15–22 | 35 min |
| The Deadmines | 17–26 | 40 min |
| Shadowfang Keep | 20–30 | 30 min |
| The Stockade | 24–30 | 20 min |
| Blackfathom Deeps | 24–30 | 40 min |
| Razorfen Downs | 25–30 | 40 min |
| Excavation Site: Wetlands | 26–30 | 35 min |
| Scarlet Monastery: Graveyard | 26–30 | 15 min |
| City of Dalaran | 28–30 | 45 min |
| Gnomeregan | 29–30 | 45 min |
| Razorfen Kraul | 29–30 | 35 min |
| Scarlet Monastery: Library | 29–30 | 25 min |
| Uldaman | 30 | 50 min |

Normal difficulty is **0**, observed in this client's actual exported runs. This
is intentionally different from old test fixtures using difficulty 1. All party
members, including outsiders and replacements, must remain inside the band;
missing level evidence makes the run unranked. These are competitive eligibility
bands, not claims that the game prevents entry outside them. Characters leveling
above a dungeon's upper bound retain earlier earned scores but cannot improve
that dungeon with an overlevel run. Alts share the linked member's best result.

The baseline scale gives short wings 15–25 minutes, medium routes 30–35, and long
routes 40–50. This is a starting balance decision. Local Hall exports contained
two automatic clears of 27:02 and 22:25, but no levels; they support plausibility
only and are not eligible calibration samples. Other timers lack measured guild
validation. Group composition and gear still confer an advantage inside a level
band; carry protection is not a perfect normalization of character strength.

## Evidence and discrepancies

- [Blizzard development notes, updated October 8](https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1): October 1 raises the cap to 30; RFD is available at 25+, Uldaman at 30+, Excavation at 26–31; October 8 adds Dalaran.
- [ForeverDB dungeon catalogue](https://foreverdb.net/dungeons), client build 1.60.1.70338, checked October 13: current client Group Finder ranges and map IDs. These supply most minimums/maximums; maximums above the beta cap are clipped to 30. The catalogue's RFD 37–46 and Uldaman 41–51 conflict with the beta server notes, so the explicit server unlocks take precedence.
- [Blizzard beta announcement](https://worldofwarcraft.blizzard.com/en-us/news/24304160/) originally lists Hall 13–18 and Ruins 15–20. The newer client catalogue expands these to 13–20 and 15–22. This preset uses the newer client ranges; those discrepancies remain documented, not silently represented as universal official recommendations.
- [Wowhead's authored Scarlet Graveyard overview](https://www.wowhead.com/forever/guide/scarlet-monastery-graveyard-dungeon-overview-location-rewards) lists wing recommendations including Graveyard 26–36 and Library 29–39. The common map 189 catalogue and locally installed journal disagree on wing levels. We explicitly choose 26–30 and 29–30 as guild challenge policy for the short beta; these are not verified hard access limits. Armory/Cathedral are not given competitive targets at this cap.

The owner requested through October 22, Toronto time. The exclusive cutoff is
`2026-10-23T04:00:00.000Z`. Blizzard describes October 21 as the last full beta day;
the server may close before the guild's requested cutoff. We preserve the owner's
date, without promising game availability on October 22.

## Scoring and timing

`round(200 × targetSeconds / elapsedSeconds)`, clamped to 50–400 for an eligible
completion. At target: 200. At 80% of target: 250. At two-thirds: 300. At half:
400. At four-thirds: 150. The season total sums each linked member's best result
per dungeon/wing, not all runs. Clearing all 16 at target totals 3,200; the maximum
is 6,400. Faster boss kills have separate records and add no rating points.

Existing timing starts at the first observed combat activation and ends on the
detected final boss. Travel before first combat and optional post-final cleanup
are outside it. At least 80% presence is required. The automatic completion and
level evidence requirements still apply: setting a target does not bypass them.
For dungeons without a verified fallback, native journal final-boss detection
must work; if it does not, manual completion remains unranked. Real-client final
boss detection across this catalogue remains an acceptance check, not a claimed
passing test.

Scarlet map 189 has separate `189:graveyard` and `189:library` keys, distinguished
by successful Thalnos/Doan encounter evidence. English/French event names are
supported without inventing encounter IDs. Unknown locales, missing names or
mixed-wing evidence remain unranked. Exit and re-enter between wings. Boss records
and archives retain the wing key, so they cannot overwrite each other.

Targets/ranges are copied into season rules at launch and stay fixed. The next
season can use eligible guild medians (same build, route, difficulty and level
band), with repeated crew/day samples limited. Review samples and route completion
before choosing new targets; no automatic mid-season adjustment is implemented.

## Combined-update handoff

All work is isolated in branch `codex/guild-dungeon-scores`, worktree
`C:\Users\Kev\.codex\worktrees\guild-dungeon-scores\Quebec Gold Bot`.
Earlier feature commits: `f07c522`, `ffaf73c`; the preset is the subsequent commit
on this branch. Combine this branch with the other session's final changes before
release checks. Do not overwrite that session's bridge work. OfficerBridge.lua
and SeasonSync.lua were not edited here. Version remains 6.0.0.

The other session owns push/deployment/installation. Follow the release handoff
gates, including final combined-commit CI, PostgreSQL migration/restore, backup,
Windows packaging and real-client checks. Apply migration
`20261113090000_dungeon_competition_evidence` and regenerate Prisma. Deploy bot,
companion and addon together; the older detail relay cannot read all new fields.
Never start a second Discord bot.

After deployment, from the authenticated checkout, preview the exact guild/season:

```powershell
node scripts/with-env.mjs npx tsx scripts/start-beta-dungeon-season.ts --guild-id <DATABASE_GUILD_ID> --guild-name "<EXACT_DATABASE_GUILD_NAME>"
```

Use the actual database guild ID (not the Discord server ID). Resolve that ID and
exact name from existing setup/database records; never select the first guild.
Review all 16 targets and the previous season ID printed by dry-run. After taking
and verifying the normal deployment database backup and preserving SavedVariables:

```powershell
node scripts/with-env.mjs npx tsx scripts/start-beta-dungeon-season.ts --guild-id <DATABASE_GUILD_ID> --guild-name "<EXACT_DATABASE_GUILD_NAME>" --expected-season <ID_FROM_DRY_RUN> --backup "<VERIFIED_DATABASE_BACKUP_PATH>" --apply
```

The launch script requires an exact guild name/ID match, exactly one active season,
an expected previous ID, a future cutoff and an existing non-empty backup file.
The file check does not prove backup recoverability. Rotation acquires the same
guild transaction lock as imports and checks the expected ID again. Retrying an
already active matching preset is a no-op. A concurrent rotation causes a refusal.
The script archives old standings and creates an empty season; no old run, other
guild data, participation ledger or SavedVariables are deleted. Delayed old runs
cannot earn new-season rating because the time boundary is enforced.

Verify a zero new-season board, all target cards, current/past navigation, guild-only
ranking, one in-band completion, an overlevel guest yielding unranked, both Scarlet
wings separately, and two-PC detail delivery. A real-client visual/layout check is
still required. No live reset, deployment, installation or push was performed here.

## Offline validation

October 13: TypeScript, all 174 Vitest files / 1,433 tests, ESLint, addon static
validation and diff whitespace checks passed. The addon ZIP (41 files) and browser
companion build passed. The updated local candidate is
`dist/Guilded-dungeon-scores-candidate-2026-10-13.zip`. Tests include isolated Scarlet
wing scoring and boss records, immutable archives, a complete zero-run catalogue,
officer-to-member relay, English/French automatic wing completion, carry exclusion,
and exact preset/cutoff installation under the expected-season transaction guard.
PostgreSQL and real-client acceptance are not claimed by these offline results.
