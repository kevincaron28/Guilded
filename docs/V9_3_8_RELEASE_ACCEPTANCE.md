# 9.3.8 release acceptance

Status: published 17 November 2026 (GitHub v9.3.8, the website download, the bot); CurseForge in review. 9.3.8 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.8 is the latest release (tag at 095452ef, 17 November 2026). |
| Installer | 9.3.8 on the website download (sha256 c5a63090...). Installed on the owner PC and started (Ready, signed in). |
| CurseForge | uploaded 17 November 2026: Guilded file 9665832, Guilded Dungeons file 9665833, in review. |
| Microsoft Store | serves 9.3.4.0; 9.3.8.0 package to be built and submitted. |
| Bot | already live (#1048-#1062, deployed 17 November 2026). |

## Checks owed (to be tested on real clients)

- A website install on 9.3.7 that stayed closed: running the 9.3.8 installer brings it back; a later self-update restarts it.

- Settings > Guilded setup: the window opens above the main window, can be dragged, stays on screen.
- Quiet login on, then /reload: no Guilded login lines; an error or a command answer still shows.
- Reach a milestone (skill 75/150, a level, an achievement): no ADDON_ACTION_BLOCKED; the Share bar appears out of combat; one click puts the line in guild chat; Not now and X work.
- Officer guild-wide announcements off: the Share bar does not appear.
- Carried over from 9.3.7: the companion log after a self-update, the Ready line wording, addon auto-update lines, a guild joined mid-session.
- Carried over from 9.3.6: one-click promote, secret, gold and auction achievements, French boss names, linking and hide my profile, Season 2 map ids before 9 December, two-PC duel and dungeon run.
