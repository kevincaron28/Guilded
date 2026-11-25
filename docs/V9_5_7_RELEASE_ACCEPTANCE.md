# 9.5.7 release acceptance

Status: published 25 November 2026.

| Provider | State |
| --- | --- |
| GitHub | v9.5.7 published (tag b047716d). |
| Installer | server and R2 mirror, sha256 ef55576a…. |
| CurseForge | uploaded 25 November 2026 (Guilded file 9803958, Guilded Dungeons file 9803959), in review. |
| Microsoft Store | pending: 9.5.7.0 (companion changed). |
| Bot | deployed by the coordinator after the GitHub release (no bot code change). |

## Checks owed

- On a quiet evening, the companion log shows standings polls spaced out up to 5 minutes, and a save or upload brings the next poll at once.
- The Cloudflare Worker's daily requests fall once members' companions run 9.5.7.
