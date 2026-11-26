<p class="eyebrow">PLAYERS AND OFFICERS</p>

# Troubleshooting

WoW saves addon data only when you type `/reload` or log out. Try that first, then let the companion
sync.

## The addon

- **Missing from the AddOns list:** [check the install folder](/guide/install/) and tick out-of-date
  addons.
- **An error or a blocked-action message:** type `/guilded diag`, copy the text and send it with
  `/report bug` in Discord.

## The companion

- **World of Warcraft not found:** press **Choose folder** and pick the folder that holds `_forever_`.
- **Last sync does not change:** type `/reload` in game, then press **Sync now**.
- **Something shows in red or amber:** press the button beside it, or open **Advanced** and press
  **Repair**. **Copy support report** copies the details to send us.

## Characters and boards

- **A character is not linked:** send the Guilded bot its full name (First Last) in a direct message, or
  see [Link your character](/guide/link-character/).
- **A dungeon run is missing:** `/reload` after the clear; your companion, or a groupmate’s, sends it.
  In game, `/guilded dungeon` says why a received run is not counted yet.

## Officers

- **Raid data is not in Discord:** an officer types `/reload`, the companion syncs, then check
  `/setup import held`.
- **The bot stays silent or cannot post:** `/setup start status:true` and `/setup system permissions`.

[Setup help prompts](/docs/AI_SETUP_HELP.html) · [Ask on Discord ↗](https://discord.gg/YjzFwtP64V)
