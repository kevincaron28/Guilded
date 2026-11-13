# 9.2.0 release acceptance

Source commit `64d8bf3b0aa5c8a168f485b16a7eef971eaf7f71` (`sourceDirty: false`), published 13 November 2026 (UTC).
The bot runs main with the upload fixes #811, #813, #814, #815 and #817 on top of the release commit.

## Where it is published (13 November 2026, UTC)

| Provider | State |
| --- | --- |
| GitHub | v9.2.0 is the latest release (64d8bf3b). |
| Installer | `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.2.0.exe` on the server and the R2 mirror. |
| CurseForge | Forever files 9585868 (Guilded) and 9585869 (Guilded Dungeons) are in review. |
| Microsoft Store | Submission 13 resubmitted with the 9.2.0.0 package, display name "Guild Sync Companion"; in certification. |
| Website | `site/releases.json` and the addon downloads point at 9.2.0 (#816). |

## Published artifact hashes (SHA-256)

Never overwrite a published download; these are the bytes that went out.

| File | SHA-256 |
| --- | --- |
| `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.9.2.0.exe` (122647938 bytes) | `a21c8027c8f4043890ec67ba26a46797df839115e020eec568f50daeb6536b5c` |
| `Guilded-v9.2.0-forever.zip` | `b82c7cd75e1228cee515210bb4cda8ac2274f6056afdc389519032b52bda2775` |
| `GuildedDungeons-v9.2.0-forever.zip` | `5f647cf2ecc7295e5d5f7cce21fb5dfbb584ff370b66028d6d2c7f22565c3653` |
| `Guilded.Companion.9.2.0.x64.STORE-SUBMISSION.msix` | `b243ed497d4f831051a13da03d5d57b0d5bf1ce0c301f481c86b09e091c072fb` |
| `Guilded-v9.2.0-Release-Notes.md` | `57239964ad6193280a0857b1273c84456058fff9d7bda1a2f929af739bd1ce15` |

## Verified on 13 November 2026 (owner's PC, WoW Forever)

| Item | Result |
| --- | --- |
| Single addon window and all tabs (Home, Guild, Dungeons, Crafting, Raids, Officer, Settings) | Pass. |
| Short `/guilded help` | Pass. |
| Craft request made in game, and its cancel | Pass. |
| Reload with no blocked action | Pass. |
| The four polish fixes (#812) | Pass. |
| Companion installed over 9.1.6 | Pass, settings kept. |
| Real sync of an officer upload | Pass after the bot fixes below. |

## Bot fixes found by the real sync

The first officer uploads timed out at 20 s. The journal timing lines showed the time was the apply (11-23 s), not the network. Fixed and live the same night:

- #811: the guild roster apply writes only what changed, in batches.
- #813: Discord side effects run in the background; one timing line per upload.
- #814: the timing line is gap-free; settings read once per upload.
- #815: the upload is answered within 10 s with `applying`, the apply finishes in the background, retries coalesce, an unchanged file dedupes (a repeat upload showed `total=4699` with no apply).
- #817: recipes, cooldowns and character discovery batched; a superseded waiting import stops listing as waiting; a member whose late apply fails gets one private message.

## Not yet verified

- Anything that needs a second player: accepting a Layer invite, a crafter claiming a request, the relay for a member without the companion, a real call for help.
- Combat behaviour.
- The first minute after login, for the "messages are limited" message.
- The Microsoft Store build (Submission 13 is in certification).

## Known issue for the next companion PR

In the single window the line "Syncing now." stays under the status lines after the sync has finished. It must clear when the sync ends. Not fixed in 9.2.0 (a companion change needs a new companion release and a Store submission).

## Learned

- A fresh real-client sync finds what unit tests with small fixtures do not: apply time scales with the roster, so measure steps (`import-apply-sections`) before guessing.
- The companion must not wait for a long apply: answer fast with `applying`, finish in the background, and make repeats cheap.
