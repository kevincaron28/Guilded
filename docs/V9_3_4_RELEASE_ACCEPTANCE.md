# 9.3.4 release acceptance

Status: prepared 15 November 2026, not yet published. 9.3.4 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published |
| CurseForge | not yet uploaded (9.3.3 files approved) |
| Microsoft Store | 9.3.4.0 package built, not submitted (9.3.3.0 in certification) |
| Website | still at 9.3.3 until the release is published |

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.

## Checks owed (to be tested on real clients)

- The Guild board tab is gone and the Layer invite entry shows in the minimap right-click menu.
- An addon-only duel record asks for a companion player at once and shows the waiting line.
- The companion shows its warning for a damaged parked-uploads record.
- A guild's Discord shows only runs and duels with one of its players.
- `/delete-my-data` and the public Delete my data page.
- The website without account tool pages, the small Discord sign-in and the My Guilded page.
- Carry between two real PCs, a real dungeon run and group relay across guilds (carried over from 9.3.3).
- The bot migration `carried_runs` applied on production before or with the bot deploy.
- Final-commit CI, packaging hashes, install over 9.3.3.
