# 9.3.6 release acceptance

Status: published 16 November 2026. 9.3.6 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.6 (filled in after publishing). |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.6.exe` on the server and the R2 mirror (after publishing). |
| CurseForge | uploaded after publishing; in review. |
| Microsoft Store | 9.3.6.0 package built; submitted after 9.3.4.0 (Submission 13) finishes certification. |
| Website | `site/releases.json` and the addon downloads point at 9.3.6 after publishing. |

## Tested so far

- The merged pull requests (#1015 to #1034) passed CI on main, each after an independent review.
- 16 November, owner's PC (English client, build 16001), addon from main: two clean reloads with no new blocked-action records; `/guilded probe auctions` works (statistics 919, 329, 330, 332, 334, the auction sold message and invoices exist; the owned list needs the auction house open); the Ready to promote panel opens with the rule line and "Promote next".

## Checks owed (to be tested on real clients)

- Promotions: a real one-click promote by an officer, no "blocked action" popup, the officer-log line after the next roster upload, an Alt-rank member never offered.
- Secret achievement: death by the Son of Arugal unlocks it once.
- Gold tiers and auction achievements: a real sale, the format of statistics 919 and 334.
- French client: dungeon and boss names (Gandling included), wing names on cards.
- Linking: sign-in lists only matching servers; the one-click claim card and DM.
- Hide my profile: hidden on the website within about 6 minutes, unhide restores.
- Season 2 maps: Krol'dok Stronghold, Alcaz Prison, Blackmaw Hold and Shaper's Terrace need one run each for their map ids before 9 December.
- Carried run and duel records between two real PCs (carried over), install over 9.3.5.
