# 9.3.3 release acceptance

Status: published 15 November 2026. 9.3.3 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.3 is the latest release (tag at f849e748), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.3.exe` on the server and the R2 mirror. |
| CurseForge | files 9624204 (Guilded) and 9624207 (Guilded Dungeons) uploaded 15 November 2026, in review; the website points at them. |
| Microsoft Store | 9.3.3.0 submitted 15 November 2026, in certification; the 9.3.2.0 submission was cancelled |
| Website | `site/releases.json` and the addon downloads point at 9.3.3. |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.3.exe` | 122723382 | `7a43eefc815f1979dc4b088000761ca98e1f3f4d049705ef824508f088b5e554` |
| `Guilded-v9.3.3-forever.zip` | 1578992 | `4caeff6e09e0e24703b4c2e1d7003b8266e7bccf21d5616a1637c10ae961c988` |
| `GuildedDungeons-v9.3.3-forever.zip` | 924192 | `f75c556a7a911ced574459ef592ab007e60aa97523a074b40f4316a8b1a47fe3` |
| `Guilded.Companion.9.3.3.x64.STORE-SUBMISSION.msix` | 165445334 | `3059587915cb5e4770060a9c23d73299e6155a54b446f132d6798107839299f2` |
| `Guilded-v9.3.3-Release-Notes.md` | 2695 | `27ef78d776b034a7a9b7e3812c208d3dd17fad861a96d3308c0da9185ffae126` |

Never overwrite a published download; these are the bytes that went out.

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.
- Build facts: three earlier attempts on 57fb60ea failed (missing phone-app packages in the build folder, then two tests that turned out to be real faults, fixed in #954 and #955). The final build from f849e748 passed 703 test files on the first run (`npm run release:prepare`, addon editions verified, Store package built).

## Checks owed (to be tested on real clients)

- The duel card names the character you dueled, including two characters that share a first name.
- A carried record from an addon-only guildmate through a signed-in guildmate's companion reaches the bot once.
- The companion heartbeat: a stopped companion stops holding other players' records.
- The Start with Windows box shows and changes the real startup entry.
- The companion idle self-update, and a waiting addon update installing when WoW is closed.
- A real dungeon run on this build, and group relay across guilds.
- Parked guilds: a parked guild's runs are not sent twice after a sync.
- The two phone-alert migrations (`mobile_devices`, `mobile_receipts`) were already applied on production on 14 November 2026; nothing to apply for 9.3.3.
- Install over 9.3.2.
