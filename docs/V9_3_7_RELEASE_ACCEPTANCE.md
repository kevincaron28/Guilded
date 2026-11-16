# 9.3.7 release acceptance

Status: prepared 16 November 2026, not yet published. 9.3.7 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published. |
| Installer | not yet built or published. |
| CurseForge | not yet uploaded. |
| Microsoft Store | 9.3.7.0 package to be built; submit after 9.3.4.0 (Submission 13) finishes certification. |
| Bot | no deploy needed (card polish #1042 already live). |

## Checks owed (to be tested on real clients)

- Companion log continues after a self-update on a website install (startup.log keeps writing after the Ready line and across the restart).
- The Ready line wording: no "restarted by Microsoft Store" on a website install; correct wording on a Store install.
- Addon auto-update: an install shows no "not needed: busy" line beside it.
- Guild join mid-session: join a guild on the second PC, and the new guild shows after the next upload without a reload.
- Carried over from 9.3.6: a real one-click promote by an officer with no blocked-action popup, the officer-log line, an Alt-rank member never offered.
- Secret achievement: death by the Son of Arugal unlocks it once.
- Gold tiers and auction achievements: a real sale, the format of statistics 919 and 334.
- French client: dungeon and boss names (Gandling included), wing names on cards.
- Linking: sign-in lists only matching servers; the one-click claim card and DM.
- Hide my profile: hidden on the website within about 6 minutes, unhide restores.
- Season 2 maps: Krol'dok Stronghold, Alcaz Prison, Blackmaw Hold and Shaper's Terrace need one run each for their map ids before 9 December.
- Leave-guild drop on race to 60 after the next officer roster upload; a duel and a dungeon run between the two PCs.
- Carried run and duel records between two real PCs, install over 9.3.6.
