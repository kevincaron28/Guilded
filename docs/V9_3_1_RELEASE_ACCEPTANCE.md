# 9.3.1 release acceptance

Status: 14 November 2026, 9.3.1 not yet published. The 9.3.1 fixes themselves are not yet verified in a real game client.

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | not yet run |
| Installer | not yet run |
| CurseForge | not yet run |
| Microsoft Store | 9.3.1.0 package built, not submitted (Submission 13 certifying) |
| Website | not yet run |

## What was seen on a real client before 9.3.1

A tour of 9.3.0 on the owner's main PC on the evening of 13 November found the problems that 9.3.1 fixes (list in `Guilded-Art/ui-polish/REAL_CLIENT_TOUR_2026-11-13.md`, outside the repository). It also saw working: login without a blocked-action popup, the main window pages, the options tabs with descriptions, the chat tab online/offline lines, the To invite window, the end-of-duel card and the dungeon result card, and French pages. The save-button fix (#874) was not installed on that PC yet.

## Checks owed (not yet seen in a real client on 9.3.1)

- Save button in combat.
- Duel rating from 1000, season ladder, duels outside the guild.
- A character without a guild: no Officer page; `/gdg` and `/guilded dungeons` open the dungeons window.
- Opaque result card and options panel; French pages without overlaps.
- To invite window: marks after a reload, copy box position, list age line.
- Runs for another guild waiting for that guild's server.
- Installer run by hand over a running companion; uninstall entry.
- Test results after the build (tsc, vitest, eslint, addon validator): to be added.
