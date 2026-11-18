# 9.3.11 release acceptance

Status: published 18 November 2026 (GitHub v9.3.11, the website download, the bot); CurseForge 9691780/9691782 in review; the Store serves 9.3.11.0 (Submission 16 live). 9.3.11 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published. |
| Installer | not yet built or published. |
| CurseForge | not yet uploaded. |
| Microsoft Store | serves 9.3.11.0 (Submission 16 live, 18 November 2026). |
| Bot | already live (#1106–#1108). |

## Checks owed (to be tested on real clients)

- Kill a raid boss on WoW Forever (from 9 December): `/guilded raidprogress` lists it, then after /reload the companion uploads it and it appears on /leaderboards/raids/.
- Confirm Forever's ENCOUNTER_END arguments and the instance type `raid`; fill RAID_CATALOG and rp.KNOWN with the real ids.
- Login and /reload stay quiet with no blocked-action popup.
- Carried over from 9.3.10: direct party invite click, `/guilded layer auto on`, Guild invites in the minimap menu, Send button drag.
