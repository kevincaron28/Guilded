# Guilded 8.4.4 — the WoW Forever launch-week release

Everything below is new since 8.4.3. Protocol stays 2, so older addons and companions keep
working with the bot.

**How to get linked (about two minutes)**
1. Update the Guilded addon (CurseForge, or the zip for your edition from GitHub Releases).
   Update the Guilded Companion if you have it, or install it from the Microsoft Store.
2. Open the companion and choose **Sign in with Discord**. It finds your saved game data and
   links your characters for you.
3. If a character is missing, run `/character claim` in Discord for it.
4. No Windows PC? Use `/guilded verify` in the game instead.

**Linking**
- Linking your characters is now automatic. There is no code to type: sign in with Discord in
  the companion and your characters link themselves (with a Discord message and an undo).
- A clearer prompt in the game and in Discord tells you the one step you still need, and an
  addon-only player is told plainly what to do next.
- WoW Forever guilds on synced realms are recognised as one guild, so members on connected
  realms are no longer split into separate guilds.

**WoW Forever first**
- Forever is now the default edition everywhere it was not before (setup, the companion, the
  website), while Era, TBC, Mists and Retail keep working as before.
- The companion finds your live Forever saved-data folder by itself, even before your first
  save, and keeps looking for it. It says so when the Guilded addon in a game folder was built
  for another edition.

**Crafters**
- A crafter can offer a craft from the craft board and sell it to guildmates. It is off by
  default; an officer turns it on.

**Smaller changes**
- Item previews in Discord are off by default.
- A member who left the Discord server no longer counts as an error in participation.
- Addon windows: the first in-game layout fixes (the guild-window portrait corner, the
  dungeons window heading and other clipped or overlapping spots).

**Updating**
- Addon: update both Guilded and Guilded Dungeons from CurseForge, or take the zip for your
  edition from GitHub Releases. Your saved data is kept.
- Companion: the Microsoft Store version updates after Microsoft certifies it; until then the
  standalone installer from GitHub Releases has the same version.
- Discord bot: updated by the owner's host; no action for guild members.

Status is tracked in [the acceptance checklist](V8_4_4_RELEASE_ACCEPTANCE.md).
