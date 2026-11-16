# 9.3.6 release acceptance

Status: published 16 November 2026. 9.3.6 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.6 is the latest release (tag at e2997f82), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.6.exe` on the server and the R2 mirror. |
| CurseForge | files 9649625 (Guilded) and 9649626 (Guilded Dungeons) approved 16 November 2026; the website points at them. |
| Microsoft Store | 9.3.6.0 package built, not yet submitted (9.3.4.0 still certifying as Submission 13) |
| Bot | deployed 9.3.6 (e2997f82) after a verified backup |
| Website | `site/releases.json` (GitHub and installer) and the addon downloads point at 9.3.6; CurseForge stays at 9.3.5 |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.6.exe` | 122688214 | `4ffaca9f5dfdfff51c2a52f36b5ac522cfea4530b26fb97ed1a7e77bd341bdae` |
| `Guilded-v9.3.6-forever.zip` | 1627532 | `b39257f24ddecbc59b01471aa0c776bc34261a55ca1457eae4920fe4740e42ac` |
| `GuildedDungeons-v9.3.6-forever.zip` | 953374 | `5816ae971c919b0bf3ebad44bb776c911f073025b2662c139561520ec87965b2` |
| `Guilded.Companion.9.3.6.x64.STORE-SUBMISSION.msix` | 165426822 | `ef29611e5524326d885febb0a824d525b862962ab6c2c44307dffb63f5dc9382` |
| `Guilded-v9.3.6-Release-Notes.md` | 2804 | `eb2e407c1888579832c1bb0ff18a588ccea1754bc9d900af982ced994752c00a` |

Never overwrite a published download; these are the bytes that went out.

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
