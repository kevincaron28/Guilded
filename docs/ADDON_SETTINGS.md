# Guilded addon settings (one shared list)

Every switch of the addon lives in one declarative list, `ns.settingsPage.allEntries()` in
`addon/Guilded/Modules/SettingsPage.lua`: tab, group, label, one-sentence description, who it affects
(`me` / `guild` / `officer`), where it is saved (`saved`), and how to read and change it. The game's
Options > AddOns > Guilded page (`Modules/Options.lua`) draws that list as tabs with centred section
headers and two columns where the labels are short; every control has a tooltip (label, description, who it
affects) and the description in small grey text under the label. The Settings page of the Guilded window
(`Modules/Minimap.lua`) keeps its own working view and has an **All settings** button that opens the Options page.

Each switch runs the same `/guilded` command (or module function) you could type, so permission checks,
messages and saved keys did not change. No saved key was renamed or dropped.

## Tabs, groups and saved keys

| Tab | Group | Setting | Saved in | Affects |
| --- | --- | --- | --- | --- |
| General | Window and language | Show the minimap button | `settings.minimapHidden` (opposite) | you |
| | | Language (Auto, English, Francais, Deutsch, Espanol) | `settings.language` | you |
| | | Smaller / Bigger / Reset window | `settings.panelScale`, `settings.panelPoint` | you |
| | Companion | Weekly reminder to get the Windows companion | `settings.companionReminder` | you |
| | | Download links to copy | none | you |
| | Login and tooltips | Show what changed since my last login | `GuildedDB.digest.enabled` | you |
| | | Item tooltips: who can craft it (Off, Compact, Full) | `settings.tooltipCrafters` | you |
| Chat | Guilded chat tab | Guilded's messages in their own chat tab | `settings.chatTab` | you |
| | | Main names in chat | `settings.chatTags` | you |
| | Guild events in the Guilded tab | Joins, Leaves, Removals, Promotions, Demotions, Coming online, Going offline | `settings.chatEvents.<kind>` | you |
| | | Online and offline lines: officers only | `settings.chatEventsOfficersOnly` | you |
| Announcements | Milestones in guild chat | Announce my milestones in guild chat | `GuildedDB.milestones.chars[me].settings.enabled` | you (per character) |
| | Which milestones | Levels, First dungeon clears, Honorable kills, Duel wins, Profession skill, Achievements | `...settings.level/dungeon/hk/duel/prof/ach` | you (per character) |
| Dungeons and PvP | Call for help | Call for help alerts (Window, Chat line, Off) | `settings.helpAlert` | you |
| | | Play a sound / Quiet in combat | `settings.helpSound`, `settings.helpQuiet` | you |
| | | Loud alert for calls in my zone | `settings.helpDefender` | you |
| | | Post my calls in guild chat | `settings.helpGuildChat` | what guildmates see from you |
| | | Mute 10 min / Reset call window | session only / `settings.helpPos` | you |
| Officers (officers only) | Whole guild | Allow milestone announcements | `GuildedDB.milestones.guild.off`, shared with online guildmates | whole guild |
| | My officer jobs | Promote linked Initiates to Member | `GuildedDB.officerAuto.off.promote` | this officer's game |
| | Parts for the whole guild | one switch per optional part | `settings.guildModules.off.<key>`, shared | whole guild |
| Advanced | Help and tools | Open the tools window, Guilded setup, Diagnostics, Raid status, All commands, Addon version, Info/data/developer tools | none | you |

Optional parts (`ns.MODULES`) each have one switch for you, in the tab where they belong, under
"Optional parts (a part turned back on starts after /reload)" (`settings.modules.<key>`, off = `false`):

- Chat: chattab, chattags, guildlog. Announcements: milestones.
- Dungeons and PvP: dungeon, scores, battleground, duels, worldpvp, guildmap.
- Raids and loot: bidding, council, reserve, imports, consumables, calendar, raidsignup, pugcheck, recipes,
  autoinvite, recruit.
- Advanced: every other part (`MODULE_TAB` in `SettingsPage.lua`; a part added later lands here by itself).

A part's state ("off for the whole guild", "off (your choice)", "on after /reload") shows in front of its
description.

## Adding or changing a setting

Add one entry to `page.allEntries()`: both pages pick it up. Give the label, group, description and the
`who` / `saved` fields, then add its English, French, German and Spanish text (`npm run locale`, then
`npm run dungeons:sync`). `tests/lua/settings-page.test.ts` fails when a label, group or description has no
FR, DE or ES text, when an officer-only entry reaches a member, and when a switch stops changing its saved key.

## Not on the page

Commands that are actions or officer tools, not switches: `/guilded setup local|connected` (the Guilded setup
window), `/guilded autoinvite ...` (the invite phrase), `/guilded sos now|clear`, `/guilded backup`, window
position by dragging (`settings.panelPoint`), the last tab you looked at (`settings.panelTab`).
