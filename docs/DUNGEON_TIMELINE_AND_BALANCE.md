# Dungeon presentation and competition review — 13 October 2026

## Delivered behavior

Run posts reuse Guilded's existing class and specialization emojis, with new
application emoji for healer, tank and DPS. Unicode role icons remain available
if an emoji cannot be loaded. Only linked guild members appear in player results.
An observed specialization is captured in the run; a fallback from the linked
character profile is marked with an asterisk rather than presented as historical
fact.

The timeline distinguishes elapsed time from the first pull and actual boss fight
duration. ENCOUNTER_START and ENCOUNTER_END provide start/end pairs; BOSS_KILL is a
fallback milestone. Failed attempts remain visible, and duplicate kill events are
collapsed. Without a start event, the post explicitly says the fight was not timed.
It never treats the time between two kills as boss combat time. Old runs may have
kill timestamps but no starts. Missing or malformed optional timeline metadata
does not change points or invalidate a run. Raw metadata remains in the original
addon import payload; no database migration is needed.

The companion now exports encounter metadata, including WoW's numbered-table
SavedVariables format. The addon also relays optional metadata to officers within
the existing 20-chunk limit. Old peers remain compatible; relayed timelines can be
partial when the message budget is exhausted. A direct companion upload preserves
up to 100 encounter attempts. Existing compact, out-of-combat popup behavior stays.

The standings message gains a separate fastest-clear board: one record per dungeon
and difficulty in the current season, with guild-member names only. Repeated runs
do not accumulate entries. Invalid and simulated runs are excluded; equal times
retain the earliest clear. The existing season-points ranking remains alongside it.

## Live scoring findings

The owner's guild currently uses the defaults: completion 50; deaths 0/1/2 award
25/15/5; first-ever dungeon completion 25; personal record 15; guild record 25;
full-guild party 20; under-target 20. There are **no target times configured**, so
the target bonus is currently inactive. Weekly repeat shares are **100%, 50%, 0%**
for each member and dungeon, shared across alts and difficulties. All award rules,
including records, use the repeat share, with rounding per rule. The Tuesday reset
is 15:00 UTC (11 a.m. Toronto on this date).

Read-only production evidence: Highpriest's Hall of Thanes clears earned 90 points
(34:59, one death, first completion), then 59 (22:25, deathless, personal/guild
record, half rewards). A later 27:02 clear earned 75 because it finished after the
weekly reset. The three clears span two scoring weeks. No existing points were
changed during this work.

For ordinary deathless clears without other bonuses:

| Activity within one scoring week | Points |
| --- | ---: |
| First run of an already-known dungeon | 75 |
| Second run of that dungeon | 38 (25 + 13 after rounding) |
| Third and later runs of that dungeon | 0 |
| Two different already-known dungeons | 150 |
| First-ever clears of two different dungeons | 200 |

This already rewards variety more than repeats within a week. It is not a balanced
skill rating: more active weeks still add points, easier/shorter dungeons pay the
same completion amount, record opportunities depend on guild history, death
coverage depends on addon reporting, and a full-guild group is a social bonus.
It is appropriate as a participation measure, not a definitive player-skill rank.
Three production clears in one dungeon are insufficient to calibrate target times.

## Recommendation before changing awards

Keep two clear purposes: **fastest clear per dungeon/difficulty** for competition,
and the existing **season participation points** for community activity. This is
implemented without resetting anyone's history.

If a single competitive total is desired next season, use the sum of each member's
best result across a fixed eligible dungeon pool. A proposed starting model is
100 for a valid clear plus 0–25 for beating a fixed, published target time. An
improvement replaces that dungeon's contribution; it does not add another full
award. Repeating one dungeon can improve its contribution only up to 125, while
two different dungeons contribute at least 200. Targets must be calibrated per
dungeon/difficulty and then frozen for the season; they should not move with the
guild record. Require comparable level/route/difficulty and reliable completion
evidence before treating this as a competitive rating. The current payload does
not establish every such eligibility condition.

Do not add death, guild-group, or first-record bonuses to the competitive total:
retain those as badges or participation rewards. This avoids penalizing someone
because another party member lacks the addon or because they joined the season
late. Do not retroactively replace current points. Announce and start a new season
only after the owner chooses the model.

| Option | Benefit | Tradeoff |
| --- | --- | --- |
| Two boards, unchanged points (implemented) | Immediate, understandable, preserves history | Participation total still grows over weeks |
| One rewarded clear per dungeon/week | Smaller rule change; more variety | Still favors time played over many weeks; first clear may be mediocre |
| Best-per-dungeon seasonal rating (recommended future model) | Repeats cannot inflate rank; improvement and breadth matter | Needs fixed targets, eligibility rules, a new season and calibration |

## Research and validation boundary

- Blizzard's [encounter event definitions](https://raw.githubusercontent.com/Gethe/wow-ui-source/classic/Interface/AddOns/Blizzard_APIDocumentationGenerated/EncounterInfoDocumentation.lua)
  expose start, end and kill events with encounter IDs. Actual event coverage still
  needs a real Forever-client run. No restricted combat-log event is registered.
- Discord's [emoji API](https://docs.discord.com/developers/resources/emoji) supports
  application-owned emoji; [message documentation](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)
  defines the embed limits. Names remain text-readable when custom emoji fail.
- Blizzard's [2021 explanation of dungeon rating](https://worldofwarcraft.blizzard.com/en-us/news/23686103/learn-about-the-mythic-dungeon-rating-in-chains-of-domination)
  supplies the design precedent of improving a dungeon's best contribution rather
  than adding every run. Its old affix rules are not copied into Forever.

Offline tests cover start/end timing, wipes, duplicate events, saved-state reload,
legacy officer summaries, bounded relay/export, unknown durations, guild filtering,
emoji fallback, per-difficulty season records and Discord size limits. Deployment
and local installation evidence belong in the dated delivery receipt. A real run
after updating the addon and companion remains the acceptance test for fight timing.
