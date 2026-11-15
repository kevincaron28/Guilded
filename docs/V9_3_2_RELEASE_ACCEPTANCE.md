# 9.3.2 release acceptance

Status: published 14 November 2026. Checked on two real PCs on 14 November 2026 (below); four checks are still owed.

## Confirmed on two real PCs (14 November 2026, 9.3.2)

- Both companions updated to 9.3.2 (one by its own update path) and both installed addon 9.3.2.
- No blocked-action warning at login.
- `/guilded carry status` answers on both sides.
- A duel was recorded on the winner and the loser side, each with the zone, the result line and the card.
- Duel records were carried through an unsigned companion and applied by the bot with no duplicate.
- Receipts cleared the waiting count after a reload.

## Still owed (not yet seen in a real client)

- A carried record from an addon-only guildmate through a signed-in guildmate's companion, after the bot fix #942 (the first attempt exposed that bug).
- The companion idle self-update on a real PC.
- A real dungeon run on this build.
- Group relay across guilds.

## Known in 9.3.2, fixed on main for the next release

- The duel card can show another character's class and level when two characters share a first name (#938).
- A stopped companion is trusted for 7 days (#941).

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | v9.3.2 is the latest release (tag at 9d8b5b1d), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.2.exe` on the server and the R2 mirror. |
| CurseForge | files 9620000 (Guilded) and 9620020 (Guilded Dungeons) approved; the website points at them (pointer #937). |
| Microsoft Store | 9.3.2.0 package resubmitted and in certification (the earlier Submission 13 was cancelled on the owner's instruction) |
| Website | `site/releases.json` and the addon downloads point at 9.3.2. |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.2.exe` | 122713694 | `b8af817adac3e4df26ad795eff96c10fee0092a5615aa8681f6b95c1bd5f3067` |
| `Guilded-v9.3.2-forever.zip` | 1572343 | `26a4a6d3e41de29c435812bb8f3395c2642c15243881ec292dd5cc5307be7c3b` |
| `GuildedDungeons-v9.3.2-forever.zip` | 919586 | `049447d765a25e7e21fa6eed156572b67fd7efdac5b66fb2de7c71297113deb0` |
| `Guilded.Companion.9.3.2.x64.STORE-SUBMISSION.msix` | 165433514 | `43a3e933196cdc6a9152d6f1cdabc9bcc65653f60dc20586fe2802944f87cf5c` |
| `Guilded-v9.3.2-Release-Notes.md` | 2665 | `5384c61e56ac76e80a0af704735e113b9431c138da61baab289c0dbfb13f8088` |

Never overwrite a published download; these are the bytes that went out.

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release build from 9d8b5b1d: `npm run release:prepare` passed (tests, audits, addon validator, companion installer, site build, verify-release-artifacts, clean source).

## Other checks not yet seen in a real client

- Carried duel records: an addon-only player's duel reaches the guild through a nearby player's companion; `/guilded carry off` and the officer switch.
- A dungeon run in a group with players from different guilds reaches each guild.
- The result line after every duel, a duel ending right after login, and saved card errors.
- Kill and death positions saved by the addon and sent by the companion; the public PvP map.
- Drowned City: the final boss ends the run.
- `/gdg` with both addons; the duel card preview.
- Companion update checks logged; a downloaded update installs when idle; the installer over a running companion.
- Final-commit CI, packaging hashes, install over 9.3.1.
