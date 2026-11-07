# Where members find each feature (roadmap 23)

Written 7 November 2026 from the code (commands, `src/setup-names.ts`, `/help`, the pinned guides). It is not a live
server audit. A feature is "discoverable" when a member can find it from the Discord server itself without asking.

## Map

| Feature | Where a member finds it |
|---|---|
| Linking characters, companion, addon install | #bot-faq, the pinned getting-started guide in #guilded-guide, `/help` first lines |
| Raid signups | #raid-signups buttons, `/help` |
| Raid cores, rosters, Apply | #raid-roster posts (Apply button), `/help` (`/apply`, `/team`) |
| Raid logs, loot awards, EPGP | #raid-logs, #loot-log, `/help` (`/epgp`, `/loot`) |
| Open raids in other guilds (PUG) | #open-raids, `/raid pug browse` (one line in `/help` "More") |
| World buffs | `/raid worldbuffs` only (gap, below) |
| Dungeon groups | #group-finder pinned button, `/help` |
| Dungeon seasons, records, hall of fame | #dungeon-leaderboard, #dungeon-runs, `/help` ("More": `/dungeon season`) |
| Battleground groups, ladders, duels | PvP category boards, `/help` (`/bg history`, `/bg duels`; `/bg panel` under "More") |
| Crafting | #craft-board pinned post, `/help` (`/craft request`; `/craft who` under "More") |
| Guild bank | `/help` (`/bank request`), bank sync is officer-side |
| Achievements, Race to 60, Hall of Fame | `/help` (`/character achievements`; `/character race` under "More"), #hall-of-fame |
| Nickname sync | `/help` "More" (`/character nickname`), the sync itself needs no action |
| Community seasons, dice, badges | #activities pinned panel, #leaderboard, `/help` |
| Guild invites | #invitation-guilde (WoW category), role DM, `/help` |
| Bug reports | `/help` (`/report bug`) |
| In-game only (call for help, levelling partners, raid sign-up) | `/help` one line each; the addon Help page |

## Gaps filled in this change

`/help` is at Discord's 6000-character embed limit for administrators, so the missing member commands went in as one
compact line in each language ("More: ..."): `/character nickname`, `/character race`, `/dungeon season`, `/craft who`,
`/raid pug browse`, `/bg panel`, `/tag list`.

## Gaps still open (need a design choice, not just a line)

- `/raid worldbuffs`, `/raid status`, `/raid roster`, `/loot reserves`, `/dungeon watch|together|keystones|catalog`,
  `/craft mine|offers`, `/bank mine`, `/tag show`, `/community hub|badges`, `/bg join|leave|upcoming` are not named
  anywhere a member reads. They do show up in Discord's own slash-command picker.
- Fix with a second help page (a "Help 2/2" button on `/help`) or a pinned "All commands" message in the guide channel,
  so `/help` does not hit the 6000-character limit. Not done here to avoid reshaping `/help`.
