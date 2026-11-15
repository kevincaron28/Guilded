# 9.3.3 release acceptance

Status: prepared 15 November 2026, not yet published. 9.3.3 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published |
| CurseForge | not yet uploaded |
| Microsoft Store | 9.3.3.0 package built, not submitted (9.3.2.0 in certification) |
| Website | still at 9.3.2 until the release is published |

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.

## Checks owed (to be tested on real clients)

- The duel card names the character you dueled, including two characters that share a first name.
- A carried record from an addon-only guildmate through a signed-in guildmate's companion reaches the bot once.
- The companion heartbeat: a stopped companion stops holding other players' records.
- The Start with Windows box shows and changes the real startup entry.
- The companion idle self-update, and a waiting addon update installing when WoW is closed.
- A real dungeon run on this build, and group relay across guilds.
- The bot migrations `mobile_devices` and `mobile_receipts` applied on production with the bot deploy.
- Final-commit CI, packaging hashes, install over 9.3.2.
