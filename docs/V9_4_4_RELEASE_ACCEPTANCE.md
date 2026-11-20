# 9.4.4 release acceptance

Status: published 20 November 2026 (GitHub, website).

| Provider | State |
| --- | --- |
| GitHub | v9.4.4 is the latest release (tag at eee18935). |
| Installer | Guilded.Companion.Setup.9.4.4.exe and the fixed-name installer on the website (sha256 4a7673a5...). |
| CurseForge | not yet uploaded. |
| Microsoft Store | 9.4.4.0 after the pending certification. |
| Bot | already live (#1167–#1189). |

## Checked in game (20 November 2026, Lebowski Holyroller, officer, English client)

- `/guilded probe guids`: player GUID Player-6800-006A7BD5 reads id 6978517, equal to the Armory character.id; 341 of 341 roster rows carry a GUID; ids unique across the guild's realm numbers.
- Setup window: all five steps; sees the Discord link, the companion and the chat tab.
- Promotion window opens with the Alts and main changes section.
- Crafting: checkbox, recipe names in English, detail pane fits.
- Saved variables grew (3.64 MB to 3.71 MB) with every section kept; /guilded perf over 7 minutes: roster update 6.8 ms average, 14 ms max.

## Checks owed (real clients)

- A second member on 9.4.4: their roster and runs reach the bot with ids (run scripts/character-id-coverage.ts).
- A main/alt swap from the promotion window on a real pair.
- The setup window on a French client.
