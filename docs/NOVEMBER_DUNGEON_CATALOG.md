# November 4 dungeon catalog — preparation

Prepared October 15, 2026. A draft separate from season rules: 35 entries grouped into 28 instance families. This counts wings separately and is not a guaranteed official total. English names are catalog references, not boss-detection aliases.

All 35 entries are planned for participation after verification. Ten are also proposed rating candidates; the other 25 are participation-only. No November rated route is activated. Competition proposal: level-60 characters, best eight routes. This remains a proposal and does not replace the level-30 beta Best 8. Targets, allowed bands and difficulty are unset. November 4 is the intended date, with no scheduled activation or UTC start time.

| Dungeon / wing | November plan | Presence evidence | Beta reference |
| --- | --- | --- | --- |
| Ragefire Chasm | Participation | Instance listed in beta | 389 |
| The Hall of Thanes | Participation | Instance listed in beta | 3065 |
| Ruins of Lordaeron | Participation | Instance listed in beta | 2999 |
| Wailing Caverns | Participation | Instance listed in beta | 43 |
| The Deadmines | Participation | Instance listed in beta | 36 |
| Shadowfang Keep | Participation | Instance listed in beta | 33 |
| Blackfathom Deeps | Participation | Instance listed in beta | 48 |
| The Stockade | Participation | Instance listed in beta | 34 |
| Excavation Site: Wetlands | Participation | Instance listed in beta | 2998 |
| City of Dalaran | Participation | Instance listed in beta | 2959 |
| Gnomeregan | Participation | Instance listed in beta | 90 |
| Razorfen Kraul | Participation | Instance listed in beta | 47 |
| Scarlet Monastery: Graveyard | Participation | Instance listed in beta | 189:graveyard |
| Scarlet Monastery: Library | Participation | Instance listed in beta | 189:library |
| The Drowned City | Participation | New dungeon announced | — |
| Scarlet Monastery: Armory | Participation | Instance listed in beta | — |
| Razorfen Downs | Participation | Instance listed in beta | 129 |
| Scarlet Monastery: Cathedral | Participation | Instance listed in beta | — |
| Krol'dok Stronghold | Participation | New dungeon announced | — |
| Uldaman | Participation | Instance listed in beta | 70 |
| Zul'Farrak | Participation | Community roster | — |
| Maraudon | Participation | Community roster | — |
| Alcaz Prison | Participation | New dungeon announced | — |
| Temple of Atal'Hakkar (Sunken Temple) | Participation | Community roster | — |
| Blackrock Depths | Participation + rating candidate | Community roster | — |
| Dire Maul: East | Participation + rating candidate | Community roster | — |
| Blackmaw Hold | Participation + rating candidate | New dungeon announced | — |
| Lower Blackrock Spire | Participation + rating candidate | Community roster | — |
| Dire Maul: North | Participation + rating candidate | Community roster | — |
| Dire Maul: West | Participation + rating candidate | Community roster | — |
| Scholomance | Participation + rating candidate | Community roster | — |
| Shaper's Terrace | Participation + rating candidate | New dungeon announced | — |
| Stratholme: Main Gate | Participation + rating candidate | Community roster | — |
| Stratholme: Service Gate | Participation + rating candidate | Community roster | — |
| Upper Blackrock Spire | Participation | Community roster | — |

## Gates before activation

- Confirm access in the launch client and retain date, build and run evidence.
- Record actual map ID, difficulty, observed levels and party size. JSON slugs are not game IDs; beta references do not prove launch compatibility.
- Verify starts, presence, final boss and replacements. Distinguish wings using reliable evidence. Current rating code classifies Scarlet wings only; Dire Maul, Stratholme and Blackrock Spire require additional implementation. Never award two completions from one ambiguous route.
- Define the required Blackrock Depths route and each wing. Partial visits, wings and full clears must not silently share a scoring standard.
- Calibrate candidates with several comparable crews, then freeze new-season targets and bands. Do not automatically carry forward beta timers or temporary access levels.
- Confirm the selection and exact start time, then use backed-up transactional season rotation. No script supplied here activates a season.

The ten candidates propose fixed-level competition that late starters can join. Dire Maul and Stratholme have multiple wings: review their weight and independence before freezing the selection. Upper Blackrock Spire remains participation-only pending verification of party size and format. November participation awards, weekly counters, helper rules and level bands must be frozen separately.

## Preservation and tools

This catalog changes no beta preset, database season, score, transaction or archive. Every launch-client check is pending. Do not import its JSON as season rules. No new boss ID, map ID, difficulty or timer was invented.

`/dungeon catalog` displays this plan in English/French after deployment and command registration. `/dungeon rules` continues to explain the active phase. Local generation publishes no Discord messages.

Regenerate: `npx tsx scripts/prepare-november-dungeon-catalog.ts`. Add `--check` to verify without writing. Machine-readable data: [data/november-dungeon-catalog.json](data/november-dungeon-catalog.json).

## Sources and uncertainty

The official announcement names nine new dungeons; beta notes establish early instance presence. The community roster supplies remaining Classic entries and wings. Listing an instance does not verify every wing. Published ranges differ between sources, so none are copied into proposed eligibility rules. No launch-client run has yet been verified.

- [Blizzard: nine new dungeons (September 15)](https://us.forums.blizzard.com/en/wow/t/krol%E2%80%99dok-stronghold/2349672)
- [Blizzard: beta updates (October 1 / October 8)](https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1)
- [Icy Veins: dungeon/wing roster (October 7)](https://www.icy-veins.com/wow-forever/dungeons-overview/)
