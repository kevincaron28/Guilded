# 9.3.4 release acceptance

Status: published 15 November 2026. 9.3.4 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | v9.3.4 is the latest release (tag at 6bc7c755), six assets. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.4.exe` on the server and the R2 mirror. |
| CurseForge | files 9632579 (Guilded) and 9632613 (Guilded Dungeons) uploaded 15 November 2026, in review; the website points at them. |
| Microsoft Store | 9.3.4.0 submitted 15 November 2026, in certification as Submission 13 ("Guild Sync Companion") |
| Website | `site/releases.json` and the addon downloads point at 9.3.4 |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.4.exe` | 122725296 | `605b3772805f9fc304d1cdcedf4b8ced7bea168684b1a74e92fbbb290bdc411c` |
| `Guilded-v9.3.4-forever.zip` | 1573913 | `a9c39cb7b3097c302ced5ffebe243921e186cf0e44963ba9cb745c6b7bcbaa9e` |
| `GuildedDungeons-v9.3.4-forever.zip` | 924906 | `39b24a9ef4dad622b565e9bfa2c96b25c8ad8fc51449628385f5dc81e0a20e47` |
| `Guilded.Companion.9.3.4.x64.STORE-SUBMISSION.msix` | 165448061 | `f003783a62efce97a4d8155100640761919f621e259785625086bf8504979eaa` |
| `Guilded-v9.3.4-Release-Notes.md` | 2427 | `9eb331cbcf73006ed22f9db3abc7ba3d9275c192b1c4886dcfee6022df60c9d8` |

Never overwrite a published download; these are the bytes that went out.

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.
- Build from 6bc7c755: `npm run release:prepare` passed on the first run (707 test files, 6942 tests passed, 28 skipped), addon editions verified, Store package built.

## Checks owed (to be tested on real clients)

- The Guild board tab is gone and the Layer invite entry shows in the minimap right-click menu.
- An addon-only duel record asks for a companion player at once and shows the waiting line.
- The companion shows its warning for a damaged parked-uploads record.
- A guild's Discord shows only runs and duels with one of its players.
- `/delete-my-data` and the public Delete my data page.
- The website without account tool pages, the small Discord sign-in and the My Guilded page.
- Carry between two real PCs, a real dungeon run and group relay across guilds (carried over from 9.3.3).
- The bot migration `carried_runs` (20270222000200) was already applied on production on 15 November 2026 (bot cc7dd3de); nothing to apply for 9.3.4.
- Install over 9.3.3.
