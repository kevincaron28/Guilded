# WoW Forever dungeon catalog audit — 15 October 2026

## Findings

The current Best 8 Discord card is a **level-30 beta competition selection**, not
a complete WoW Forever catalog or the November launch rotation. Hall of Thanes
and Ruins of Lordaeron are already configured in Guilded. They disappeared from
that card because `bestEightBetaRules()` selects only old catalog bands ending at
30. Ragefire Chasm, Wailing Caverns and Deadmines are excluded by the same filter.
All five remain participation routes under the frozen phase rules.

The original catalog has 16 scoring keys representing 15 dungeon instances:
Scarlet Monastery contributes two wings. Blizzard's October beta notes identify
all 15 instances. This verifies their presence in Forever beta, **not** every
wing, completion detector, timer, access level or launch rule in our preset.

No score, target, eligibility band, season boundary, transaction or archive is
changed by this audit. The revised guide makes the omitted participation routes
visible and separates guild targets from official game information.

## Current catalog, checked individually

Every target below is an existing frozen guild estimate, not an official timer.
“Rating” means a candidate for this beta's level-30 Best 8, with all existing
eligibility requirements. It does not assert successful end-to-end game testing.

| Guilded entry | Current phase | Guild target | Presence evidence |
| --- | --- | --- | --- |
| Ragefire Chasm | Participation only | No current rating target | A |
| The Hall of Thanes | Participation only | No current rating target | A, B |
| Wailing Caverns | Participation only | No current rating target | A |
| Ruins of Lordaeron | Participation only | No current rating target | A, B |
| The Deadmines | Participation only | No current rating target | A; local recorded run |
| Shadowfang Keep | Rating | 30 min | A |
| The Stockade | Rating | 20 min | A |
| Blackfathom Deeps | Rating | 40 min | A |
| Razorfen Downs | Rating | 40 min | A: beta access 25+ |
| Excavation Site: Wetlands | Rating | 35 min | A, B |
| Scarlet Monastery: Graveyard | Rating | 15 min | A confirms instance; exact wing policy is ours |
| City of Dalaran | Rating | 45 min | A: October 8 addition; B |
| Gnomeregan | Rating | 45 min | A |
| Razorfen Kraul | Rating | 35 min | A |
| Scarlet Monastery: Library | Rating | 25 min | A confirms instance; exact wing policy is ours |
| Uldaman | Rating | 50 min | A: beta access 30+ |

**A. [Blizzard beta development notes, October 1 and October 8](https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1).**
Use Kaivax's dated updates within the thread, not player replies. These are beta
access statements. In particular, do not carry the temporary RFD/Uldaman access
levels into November as official recommended ranges. Scarlet is listed as an
instance; the post does not certify our Thalnos/Doan wing classifier.

**B. [Blizzard's nine new dungeon list, September 15](https://us.forums.blizzard.com/en/wow/t/krol%E2%80%99dok-stronghold/2349672).**
This first-party announcement establishes the nine new names. It lists Hall at
13–18 and Ruins at 15–20; our older client-derived competition/participation
bands are different and must remain labeled guild rules. Its Excavation range
24–29 is superseded for beta access by A's October 1 range of 26–31. Recheck the
launch client rather than presenting either as an immutable November rule.

## Missing from the beta catalog but announced for Forever

Blizzard's list B also names five higher-level new dungeons that are not in our
current preset:

| Announced dungeon | September 15 announced band | Guilded status |
| --- | --- | --- |
| The Drowned City | 35–40 | Not configured for current beta competition |
| Krol'dok Stronghold | 40–45 | Not configured for current beta competition |
| Alcaz Prison | 48–53 | Not configured for current beta competition |
| Blackmaw Hold | 55–60 | Not configured for current beta competition |
| Shaper's Terrace | 58–60 | Not configured for current beta competition |

These are announced game content, not verified live launch availability as of
this pre-launch audit. Do not invent map IDs, final encounter IDs or timer targets
for them. Hall and Ruins are the two earlier new dungeons omitted from the
rating-only display; the unnamed dungeon the owner recalled is not established.

The broader Classic roster also needs launch verification: Zul'Farrak, Maraudon,
Temple of Atal'Hakkar, Blackrock Depths, Lower/Upper Blackrock Spire, Dire Maul,
Stratholme and Scholomance, plus the other Scarlet wings. These are a **research
and client-verification backlog**, not entries certified by the beta notes above.
Avoid claiming a definitive total from community lists: counts differ by wings.

## November recommendation

Keep a complete discovery/participation catalog separate from the rated rotation.
Show three explicit statuses: “rated this phase”, “participation only”, and
“announced — awaiting client verification”. Never imply an omitted rated route
does not exist in Forever. Do not add low-level Hall/Ruins to a level-30 speed
rotation with their old timers: overgeared clears could hit 400 too easily.

Before creating official season rules, establish the intended competition level,
verify launch access and route completion for each selected dungeon, then measure
comparable runs and freeze the target set. The current level-30 beta selection
and provisional timers should not automatically become the November season.
Preserve the beta archive and all earned participation history.

## Validation limits

Research confirms names and dated announcements. Source inspection confirms the
16-key catalog, 11-key Best 8 filter and separate participation bands. Automated
tests check guide rendering and immutable rules; they cannot establish launch
availability, full-clear routes, in-game final-boss detection or calibrated timers.

The English/French scoring guide now includes the five participation-only routes.
Live Discord pin publication and bot deployment must be recorded separately from
source changes; updating a pin does not deploy the `/dungeon rules` handler.
