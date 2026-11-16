# 9.3.5 release acceptance

Status: published 15 November 2026. 9.3.5 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.5 is the latest release (tag at 57c07a23), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.5.exe` on the server and the R2 mirror. |
| CurseForge | upload pending; the website still points at 9.3.4 files |
| Microsoft Store | 9.3.5.0 package built, not yet submitted (9.3.4.0 in certification as Submission 13) |
| Website | `site/releases.json` (GitHub and installer) and the addon downloads point at 9.3.5 |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.5.exe` | 122827553 | `a954916091e5ca73c969697d4b17fefd5124af874049cd009b67cd4685b4d6f4` |
| `Guilded-v9.3.5-forever.zip` | 1594699 | `fc7bd11f4bf7cb3cffffe578145003edef732b169fc09096c972c2feeb1e1808` |
| `GuildedDungeons-v9.3.5-forever.zip` | 931042 | `cac7f4c27f2c0add9000f986295bd8a6774b77e205e8fa62f14af22f1853525e` |
| `Guilded.Companion.9.3.5.x64.STORE-SUBMISSION.msix` | 165582695 | `acbd620f5bf341f3a5b30a53ca88403a20dd27609541f30ee88046d80467f6c9` |
| `Guilded-v9.3.5-Release-Notes.md` | 2712 | `86d20dc5c3333f85d3abaa77215984c5e589401855de7b1e77f53920b23530d9` |

Never overwrite a published download; these are the bytes that went out.



## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.
- Build from 57c07a23: `npm run release:prepare` passed (717 test files, 7047 tests passed, 28 skipped), addon editions verified, Store package built.

## Checks owed (to be tested on real clients)

- In-game dungeon result card: the columns show each player's level, guild, score gained and season total from the bot's receipt, in a real run.
- Scarlet Monastery: the wing name shows in game and on the Discord card.
- The "last saved" line (sidebar tooltip, `/guilded sync`) and the one-time `/reload` reminder after a run or a duel (never in combat, only for your own duels, off switch works).
- Digest (D1) and packed summaries (Z1, #998: run batches over 255 bytes compressed, fallback for older addons) with mixed versions: a 9.3.5 addon with a 9.3.4 guildmate and the reverse; no run lost, no repeated replay.
- The new logo in game (addon icon and minimap) and in the companion (window, tray, installer, Store tile).
- Carried run and duel records between two real PCs (carried over from 9.3.4), a real dungeon run and group relay across guilds.
- Install over 9.3.4.
