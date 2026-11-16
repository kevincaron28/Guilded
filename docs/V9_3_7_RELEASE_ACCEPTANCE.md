# 9.3.7 release acceptance

Status: published 16 November 2026. 9.3.7 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.7 is the latest release (tag at 690040bd). |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.7.exe` on the server and the R2 mirror. |
| CurseForge | files 9654361 (Guilded) and 9654362 (Guilded Dungeons) uploaded 16 November 2026, in review; the website keeps pointing at 9.3.6 until they are approved. |
| Microsoft Store | 9.3.7.0 package built; submitted after 9.3.4.0 (Submission 13) finishes certification. |
| Bot | deployed (card polish #1042 already live). |
| Website | `site/releases.json` (GitHub and installer) and the addon downloads point at 9.3.7; CurseForge stays at 9.3.6. |

## Published artifact hashes (SHA-256)

| File | SHA-256 |
| --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.7.exe` (122688406 bytes) | `f5d0cfd5bf2dcf74613bcb4a06e2c4b27ac6c46ef4185b8947f2ba0c00f3d5ae` |
| `Guilded-v9.3.7-forever.zip` | `fce3cf3758d76c068620c149e917eac969f55d20d3fa67afbad8ac7547d09d91` |
| `GuildedDungeons-v9.3.7-forever.zip` | `80827e055d7664039e7b089b3fade61a7af6a9bfccdaff6750dea20295881b20` |

Never overwrite a published download; these are the bytes that went out.

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
