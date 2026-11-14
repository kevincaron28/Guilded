# 9.3.1 release acceptance

Status: published 14 November 2026. Most 9.3.1 fixes were seen working on a real client on 14 November; the items under "Not verified" were not.

## Where it is published (14 November 2026)

| Provider | State |
| --- | --- |
| GitHub | v9.3.1 is the latest release, with the six release files. |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.1.exe` on the server and the R2 mirror. |
| CurseForge | Forever files 9605848 (Guilded) and 9605856 (Guilded Dungeons) approved 14 November 2026; the website points at them. |
| Microsoft Store | 9.3.1.0 package built, not submitted (Submission 13 certifying) |
| Website | `site/releases.json` and the addon downloads point at 9.3.1. |

## Published artifact hashes (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.3.1.exe` | 122703879 | `5c4fb8a1a384b54233b8016811558ef34197ac1797690e882905825b36213351` |
| `Guilded-v9.3.1-forever.zip` | 1547155 | `4529c54fa0466bfd7793ca5c48e82339ae93d7d2f66cefe5a3b567d4f1248e09` |
| `GuildedDungeons-v9.3.1-forever.zip` | 901787 | `27810a91952277db0558ad667238e5517bbb9adfdb5885bb79a82b739d4c887e` |
| `Guilded.Companion.9.3.1.x64.STORE-SUBMISSION.msix` | 165421905 | `87209fdb57c4cce2c8d37bbf467476c20c1c330e1beb5ead105e1fa1186c44bc` |
| `Guilded-v9.3.1-Release-Notes.md` | 1563 | `c01f334a45bc6be3f0b7f9131facabc6da7af9da17a0d3d395e3bf3fb1adcda2` |

Never overwrite a published download; these are the bytes that went out.

## Test results (source commit 61131ecf, clean)

tsc 0 errors, eslint clean, addon validator passed, vitest 661 files and 6330 tests passed (28 skipped, 0 failed), verify-release-artifacts passed.

## Seen on a real client (14 November 2026, this build, guild master character)

- The game loads with no blocked-action warning and no new entry in `/guilded diag`.
- The guild overview shows the count column.
- The duel ladder shows ratings 1002 and 998, matching the website.
- The To invite window shows the new wording, the list-age line, the copy box below the window and a new applicant.
- `/guilded dungeons` opens the dungeons window.
- The dungeon result card is opaque and clear of the action bars.
- The installer run by hand with `/S` over a running 9.3.0 companion exited 0, updated to 9.3.1, restarted it and left a valid uninstall entry.

## Found, not blocking

- With both addons installed, `/gdg` prints "Guilded is installed... Guilded Dungeons stays quiet" instead of opening the window.
- The duel card test preview shows no stat row for a character with no duel this season.
- The game printed nothing after `/ginvite` (no INVITE_REPLY captured).

## Not verified in game on this build

- The save button during combat.
- A real duel and a real dungeon run.
- The French pages.
- The options panel background.
