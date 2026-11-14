# 9.3.2 release acceptance

Status: 14 November 2026, 9.3.2 not yet built or published. Nothing in 9.3.2 has been confirmed in a real game client yet.

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | not yet run (v9.3.1 is the latest) |
| Installer | not yet run |
| CurseForge | not yet run |
| Microsoft Store | 9.3.2.0 package built later, not submitted (Submission 13 certifying) |
| Website | `site/releases.json` still at 9.3.1 |

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release build results (tsc, eslint, addon validator, vitest, verify-release-artifacts): to be added after the build.

## Checks owed (not yet seen in a real client)

- Carried duel records: an addon-only player's duel reaches the guild through a nearby player's companion; `/guilded carry off` and the officer switch.
- A dungeon run in a group with players from different guilds reaches each guild.
- The result line after every duel, a duel ending right after login, and saved card errors.
- Kill and death positions saved by the addon and sent by the companion; the public PvP map.
- Drowned City: the final boss ends the run.
- `/gdg` with both addons; the duel card preview.
- Companion update checks logged; a downloaded update installs when idle; the installer over a running companion.
- Final-commit CI, packaging hashes, install over 9.3.1.
