# Addon commands that stay slash-only (9.1)

Every Guilded feature has a tab or button in the Guilded window. Pages: Home, Me, Open raids, Ready,
Reserves, Signups, Raid, Loot, Council, Duels, Announcements, **Info and data**, Settings (Tools); and in
the guild window: Standings, Crafting, Availability, Gear, EPGP, Local guild, Guild message,
Roster admin, Officer tools. The status and switch commands (`peers`, `relay`, `professions`, `names`,
`bgcapture`, `ledgersync`, `bridge`, `options`, `digest`, `chattags`, and for officers `invites`,
`promote`, `autoinvite`, `lootroll`, `consumes`) are buttons on **Info and data**.

These stay slash-only on purpose:

| Command | Why |
| --- | --- |
| `/guilded drop <item link> [seconds]` | Needs an item link typed or shift-clicked into chat; the Loot page covers starting bids and direct gives. |
| `/guilded price <item> <GP>` | Takes two typed values. |
| `/guilded bid ...` | Subcommands with item numbers; the Loot page has Open bidding and Close now. |
| `/guilded debug scroll` | Developer diagnostic for a page that will not scroll. |
| `/guilded sim ...` | Developer test tools; Settings has buttons for the common cases. |
| `/guilded casino ...` | Only a placeholder name in comments about guild module switches; there is no such module. |
| `/guilded gbank <item>` and `/guilded gbank request [count] <item>` | Take a typed item name; "My bank requests" and "Guild bank low stock" are buttons on Info and data, and officers have "Guild bank" on Officer tools. |
| `/guilded restore <code>` | Takes a pasted backup code; the Backup and Restore preview buttons are on the EPGP page and in Settings. |

When you add a feature, give it a button or a page first; add it here only when it needs typed
arguments that no control can supply.
