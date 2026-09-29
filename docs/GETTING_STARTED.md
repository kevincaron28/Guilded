# Getting started: the bot, the addon and the companion

**Updating an existing install? Follow [V5_0_RELEASE_HANDOFF.md](V5_0_RELEASE_HANDOFF.md).**

For the officer who sets Guilded up for a guild. About 30 minutes. You can stop after step 3 and use
the addon alone; the bot and the companion are optional.

## 1. Install the addon (everyone)

1. Download it from [CurseForge](https://www.curseforge.com/wow/addons/guilded), or unzip an existing
   `Guilded-v<version>.zip`, into `World of Warcraft\_forever_\Interface\AddOns\`. You should end up with
   `AddOns\Guilded\Guilded.toc`.
2. Start the game. Type `/guilded` for the command list, or click the gold coin on the minimap.

## 2. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications), create an application
   and add a **Bot**. Copy the **token**, and the application's **Client ID**.
2. On the Bot page, turn on **Server Members Intent**.
3. Invite it: OAuth2, URL Generator, scopes `bot` and `applications.commands`, and these permissions:
   View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads,
   Embed Links, Read Message History, Manage Channels, Manage Roles.
4. In your server, drag the bot's role **above** the applicant and member roles.
5. Turn on Developer Mode in Discord (Settings, Advanced), right-click your server and **Copy Server ID**.

## 3. Run the bot (on a Windows PC that stays on, or see [DEPLOY_ORACLE.md](DEPLOY_ORACLE.md))

1. Install [Node.js 22+](https://nodejs.org). Create a free database at [neon.tech](https://neon.tech)
   and copy its connection string.
2. In the project folder run `npm install`, then create `.env.local` from `.env.example` and fill in
   `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` (your server ID), `DATABASE_URL`. Companions pair separately; no shared upload token is required.
3. Double-click **`start-bot.bat`**. It updates the database, starts the companion app and keeps the bot
   running (it restarts by itself if it crashes). Leave its window open.
4. In Discord, run **`/report ping`**: the bot should answer.

## 4. Set up the Discord server

Run **`/setup start`** (you need Administrator). The first screen asks for the language, **English or Français**: pick Français and the guide, the roles, the channels and the posts members see are French. It is a click-through guide in seven steps. On each channel step, already have a channel for one of these? Pick it from its menu. Otherwise press
**Create the missing ones for me** to make the rest, sorted into categories with the right permissions
(members read announcements and use buttons; the officer log and readiness board are private).
Finish with `/setup start status:true`: nothing should be red.

Then:
- **`/core setup`** makes a raid core (a named roster). Change it any time with **`/core edit`**
  (roles, bench, add, remove, rename).
- In step 3 of `/core setup` choose **how that core's loot is decided**: GP bids, loot council, soft reserves, or EPGP priority (every item has a set GP price and goes to the highest PR of the players who want it). For EPGP priority give the item prices with the **Item prices** button or `/core items`. A core that says nothing follows the guild's choice (`/setup config loot-mode`).
- **`/setup config auto-import`** lets the bot apply uploads by itself. Otherwise an officer runs `/import apply`.
- **`/craft permissions`** (only needed for a craft board made by an older version).

## 5. Connect the game to the bot (the companion)

On the officer's PC that plays WoW (a Windows installer, `Guilded Companion Setup.exe`, does the same without Node.js; Windows may warn about an unknown publisher because it is not code-signed):
1. Run **`start-companion-app.bat`** (it is also started by `start-bot.bat`). Look for the gold coin near the
   clock; Windows may hide it behind the **^** arrow.
2. Settings: **Find it** (it looks for `WTF\...\SavedVariables\Guilded.lua`), enter the server ID and a
   pairing code from `/character pair`, choose **Link Discord account**, then **Save and start**. The coin turns green.
   **Verify the server ID before saving**: Discord Settings → Advanced → Developer Mode (if not already
   on), then right-click your server's icon and **Copy Server ID** again, and paste that exact value into
   the field — don't type it from memory or reuse an ID from another server or an old setup. If the bot is
   in more than one Discord server, make sure you copied the ID of the *right* one.
3. In game, `/reload`. The companion's Status page shows a fresh upload within seconds.

The game only writes the addon's data on `/reload` or logout, so that is when data moves. The addon
never reloads on its own unless a player turns that on with `/guilded sync auto on`.

## 6. Players

- Everyone: install the addon. For automatic ownership, run **`/character pair`** in Discord, enter
  the one-time code in Companion Settings, and choose **Link Discord account**. The companion links
  your own character on its next upload. The rest of the guild data still follows the usual import
  setting: an officer applies it unless auto-import is enabled.
- If you do not use a paired companion, characters still appear when an uploader's companion sends
  the guild digest. Matching Discord nicknames can link them automatically; otherwise use
  **`/character claim`** to select your character.
- Raid leaders: `/raid create` (add `core:` and `weekly:true` as needed). Members sign up with the buttons.
- Officers: in game, `/guilded start` opens a raid; when an item drops, `/guilded drop <item link>` runs it the way
  the raid's core decides loot (`/guilded core <name>` picks the core; it follows the next raid by itself). The Home page shows what
  is waiting to go to Discord.
- Soft reserves: an officer runs `/guilded reserve open`, everyone reserves with `/guilded reserve <item link>` (or the Reserves tab), and
  `/loot reserves` shows the list in Discord.
- Guild calendar: an officer's `/guilded calendar sync` sends in-game event answers to Discord, and the Calendar tab makes in-game events
  for Discord raids. It needs a game client that offers the calendar to addons (`/guilded calendar check`).
- Crafters: open each profession window once; `/craft who <item>` in Discord and `/guilded recipes who <item>` in game find them.

## Updating

Pull or copy the new files, then run `start-bot.bat` again (it applies database changes; or run `npm run db:update`). Copy the new
`Guilded` addon folder over the old one. Existing data is kept. Coming from 3.x, note that several bot commands moved under parents
(17 commands now): see [COMMANDS.md](../COMMANDS.md).

## When something goes wrong

| You see | Why and what to do |
| --- | --- |
| "Could not reach the bot" in the companion | The bot is not running or still starting. Wait for `/report ping` to answer in Discord, then `/reload`. |
| "Upload failed (404): Guild is not initialized" | The companion's server ID doesn't match a Discord server the bot is actually in. Re-copy it (Developer Mode → right-click the server → **Copy Server ID**) and paste it into the companion's settings exactly — don't retype it by hand. If the bot is in more than one server, double-check you copied the right one's ID. |
| "Addon import not found" | You ran `/import apply` in a different Discord server than the companion's server ID. |
| "No unclaimed character called ..." | The character is already linked (`/character list`), or its upload has not been applied yet (`/import apply`, or turn on `/setup config auto-import`). |
| "Unknown interaction" in the bot window | A command took over 3 seconds (a sleeping database). Run it again; the bot keeps running. |
| `EPERM` when starting the bot | Another copy of the bot is still open. Close it and run `start-bot.bat` again. |
| No tray coin | Look behind the **^** arrow next to the clock and drag the coin out. |
| Standings say "the bot has no linked characters yet" | Link characters (above), then `/reload`. |
| Red `LUA_ERROR` lines in `/guilded diag` | Copy the output and report it. |
