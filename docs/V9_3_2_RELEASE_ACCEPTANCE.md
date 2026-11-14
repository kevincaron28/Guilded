# 9.3.2 release acceptance

Status: published 14 November 2026. Nothing in 9.3.2 has been confirmed in a real game client yet.

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | v9.3.2 is the latest release (tag at 9d8b5b1d), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.2.exe` on the server and the R2 mirror. |
| CurseForge | upload pending (the website still points at the 9.3.1 files). |
| Microsoft Store | 9.3.2.0 package built, not submitted (Submission 13 certifying) |
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

## Checks owed (not yet seen in a real client)

- Carried duel records: an addon-only player's duel reaches the guild through a nearby player's companion; `/guilded carry off` and the officer switch.
- A dungeon run in a group with players from different guilds reaches each guild.
- The result line after every duel, a duel ending right after login, and saved card errors.
- Kill and death positions saved by the addon and sent by the companion; the public PvP map.
- Drowned City: the final boss ends the run.
- `/gdg` with both addons; the duel card preview.
- Companion update checks logged; a downloaded update installs when idle; the installer over a running companion.
- Final-commit CI, packaging hashes, install over 9.3.1.
