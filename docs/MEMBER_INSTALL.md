# Guilded: install and connect

For guildmates using **WoW Forever**, including the beta client. You do not need
Node.js, a database, or a Discord bot token. Your guild owner runs the bot.

## Get your guild's links

Ask your officer for the addon download, the Windows companion download, your
Discord server ID, and your guild's **bot address**. Use the matching addon and
companion from the release they specify. Public releases belong on
[GitHub Releases](https://github.com/kevincaron28/Guilded/releases) and
[CurseForge](https://www.curseforge.com/wow/addons/guilded); only use a version
actually listed there. The planned 6.0 release is still being tested.

## 1. Install the addon

1. Close WoW. Open the folder for the client you actually play. For Forever beta,
   this is the `_classic_beta_` folder beside `WowB.exe` in the tested installation.
   Other installations may use a different folder; find the game executable first.
2. Extract the addon's **Guilded** folder into `Interface\AddOns` there. The result
   must be `Interface\AddOns\Guilded\Guilded.toc`, with no extra nested Guilded folder.
3. Start WoW, enable Guilded in the AddOns list, and enter the game. Click the
   gold minimap coin to open Home. `/guilded menu` also opens the window.
4. Type `/reload` once to create or update the saved-data file.

**Success:** Home opens without a Lua error. If you only want the in-game addon,
you can stop here. Discord sync needs the steps below.

## 2. Connect the Windows companion

1. Install `Guilded Companion Setup <version>.exe` from your guild's release link,
   then open Guilded Companion. The installed app does not need Node.js.
   Current installers are unsigned; verify the download source before running one.
2. Open **Connection & setup** (new installations open it automatically). Under
   **Connect your Discord account**, paste **Your guild's bot address** from your
   officer, ending in `/api/v1/addon-imports`, **before pairing**. Older 5.0 builds
   put **Bot address** under **Finish your setup → Advanced preferences**. A
   prefilled Quebec Gold address is correct only if your officer gave you it.
3. Paste your **Discord server ID**. In that same Discord server, run
   `/character pair` from your own account. Paste the private code and press
   **Connect**. It expires after 15 minutes and can be used once.
4. Enable **World of Warcraft**. Press **Find it**, then verify the selected
   `Guilded.lua` belongs to your current client and account. If several accounts
   are found, use **Browse** to select the right one:
   `<client>\WTF\Account\<account>\SavedVariables\Guilded.lua`.
   Do not select the addon code in `Interface\AddOns`.
5. Press **Save & start syncing**. In WoW, `/reload`. Check **Activity** for a
   successful upload and the message that your character is linked.
6. Let the companion refresh standings, then `/reload` again to load them in game.

**Success:** a fresh successful upload appears and the correct character is linked.
`0 ledger entries, 0 new characters` is normal when nothing new needs importing.
An officer's guild upload may wait for review if automatic import is off.

Leave the companion in the tray while playing. New game data reaches disk on
`/reload` or logout. Open each crafting profession normally: recipe detection is
automatic; `/guilded recipes mine` is only a way to inspect the stored result.

Pairing another companion replaces your previous link. Do not alternate between
desktop and browser pairing unless you intend to reconnect the device you use.

## Online option

Open the **online companion link supplied by your guild** (ending in `/companion/`).
Connect with your server ID and a fresh personal pairing code. Select Guilded.lua
after `/reload`, save preferences and choose **Sync now**. Reselect the updated
file each time; the browser does not watch it in the background.

For standings, download `Standings.lua`, place it in
`<client>\Interface\AddOns\Guilded`, then `/reload`. The addon is still required.

## Quick fixes

| What you see | What to do |
| --- | --- |
| Guilded missing from the AddOns list | Check the actual client folder and the exact Guilded.toc path above; restart WoW. |
| Find it finds no Guilded.lua | Log in with Guilded enabled and `/reload`, then Browse to your account's SavedVariables. |
| Pairing fails | Verify the bot address and server ID first; request a new code in that server. Keep codes private. |
| Link revoked or unauthorized | A newer pairing may have replaced this one. Ask an officer about membership/access, then pair this device again. |
| Cannot reach bot | Use Test connection. Ask the owner whether the bot and its HTTPS address are online. |
| Guild is not initialized / 404 | Re-copy the server ID and confirm this bot is in that server. The owner runs `/setup start`. |
| Upload says it is awaiting review | An officer reviews/applies it with `/import apply`; ordinary members cannot apply guild ledgers. |
| Upload works but standings look old | Check the companion's separate standings status; refresh standings, wait for success, then `/reload`. |
| Profession list seems empty | Open the profession window and let it finish loading. If still empty, send the profession name and current diagnostic output. |
| No tray icon | Check the hidden-icons arrow beside the Windows clock, then open Guilded Companion from Start. |
| Lua error | Capture the error and `/guilded diag`; note the timestamp. Saved diagnostic history can include older notices. |

For help, use **Activity → Download support summary**, or copy the exact error,
the addon/companion versions, client build and time of failure. Review attachments
before sharing; do not upload config.json, credentials, bot tokens or pairing codes.
The [AI help prompts](AI_SETUP_HELP.md) include a member troubleshooting prompt.

## Mise en route rapide en français

1. Demandez à un officier les liens de téléchargement, l'adresse du bot et
   l'identifiant du serveur Discord de **votre guilde**.
2. Fermez WoW. Installez le dossier Guilded dans `Interface\AddOns` du bon client
   (Forever beta : `_classic_beta_` dans l'installation testée), puis relancez WoW.
3. Ouvrez Guilded avec la pièce sur la minicarte. `/reload` enregistre les données.
4. Installez le compagnon. Dans **Connection & setup**, entrez **Your guild's bot
   address** avant d'utiliser `/character pair` sur Discord. Sur les anciens
   compagnons 5.0, **Bot address** se trouve dans **Advanced preferences**.
5. Entrez l'identifiant du serveur et votre code privé, puis **Connect**.
   **Find it** doit sélectionner le fichier de votre compte et du bon client.
6. **Save & start syncing**, puis `/reload` en jeu. **Activity** doit afficher une
   synchronisation réussie. Après réception du classement, un autre `/reload`
   le charge en jeu. Les recettes sont détectées à l'ouverture de la profession.

Vous n'avez pas besoin du jeton du bot. Ne partagez jamais votre code de liaison.
`/guilded lang fr` sélectionne le français dans l'addon.
