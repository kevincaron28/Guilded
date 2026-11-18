# 9.3.10 release acceptance

Status: published 18 November 2026 everywhere: GitHub v9.3.10, the website download, the bot, CurseForge (approved, files 9677628/9677629) and the Microsoft Store (9.3.10.0, Submission 15).

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published. |
| Installer | not yet built or published. |
| CurseForge | not yet uploaded. |
| Microsoft Store | serves 9.3.4.0; 9.3.8.0 certifying (Submission 14); 9.3.10.0 package to be built. |
| Bot | already live (#1093–#1096). |

## Checks owed (to be tested on real clients)

- Click Invite on a layer request: the player is invited with no blocked-action popup. If the game refuses: one popup, then the copy box from then on (GuildedDB.inviteDirect).
- `/guilded layer auto on`: a guildmate's layer request on the same continent is invited automatically, with the notice and no chat line; as a party member it falls back to the window.
- Minimap right-click: Guild invites shown for a rank that can invite and hidden otherwise.
- Drag the Guilded window: the Send to Discord button follows.
- Carried over from 9.3.9: addon-only carried runs on the leaderboard, quiet login, companion relaunch after a self-update.
