# 9.5.3 release acceptance

Status: published 23 November 2026.

| Provider | State |
| --- | --- |
| GitHub | v9.5.3 published (tag 9dee282f). |
| Installer | server and R2 mirror, sha256 5bb22d13…. |
| CurseForge | uploaded 23 November 2026 (Guilded file 9773671, Guilded Dungeons file 9773672), in review. |
| Microsoft Store | not submitted: companion unchanged; 9.5.0.0 stays in certification (Submission 24). |
| Bot | live 9.5.3 (9dee282f; no bot code change). |

## Checks owed

- After login, a dungeon run still records, counts deaths and uploads; /guilded diag shows no error.
- WTFAccount<account>SavedVariablesGuilded.lua is smaller after the login (no deathPoints or trace entries).
