# Guilded: install and connect

For guildmates using **WoW Forever**, including the beta client. You do not need
Node.js, a database, or a Discord bot token.

[Français](#fr) · [Quick setup](QUICK_START.md) · [EPGP workflow](EPGP_GUIDE.md) · [Optional Discord pilot](HOSTED_PILOT.md)

## Use it in game only

**The addon alone is the default path.** Install it and use **In-game only**.
Current releases start in this mode automatically. Older builds may show a chooser. Reopen
the choice with `/guilded setup` or **Home > Guilded setup**. Gear checks,
dungeon recording, raid attendance and loot tools work without Discord or core
signups. Officers can publish local standings to online guildmates. Save with
`/reload` or logout and back up SavedVariables.

Discord/companion setup below is optional. Verified seasonal scores and online
rosters/signups need the connection. Choosing in-game only preserves existing
points and rosters and does not stop an already-running companion.

## Want the bot for your guild?

**[Add Guilded — request owner approval](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718703631440)**

KCaron is accepting a small number of guilds into the free hosted pilot.
**Your Discord server needs KCaron's approval first.** Inviting the bot sends
a request; it does not activate access. After approval, run `/setup start`, then
open the [online companion](https://guilded.kcaron.top/companion/)
with your personal `/character pair` code (since 6.5.1 the code alone finds your server).
You do not need to host a bot or database for this path.
See the [hosted pilot guide](HOSTED_PILOT.md). Independent hosting is also available.
Any [financial support](SUPPORT_GUILDED.md) is optional and never buys approval.

## Get your guild's links

Ask your officer for the addon download. Start with the addon; the online
companion and Windows app are optional. If you want companion sync later, ask
for your guild's online link. Use the matching release
your officer specifies. Public releases belong on
[GitHub Releases](https://github.com/kevincaron28/Guilded/releases) and
[CurseForge](https://www.curseforge.com/wow/addons/guilded); only use a version
actually listed there. Checked on 18 October 2026: **GitHub Release 6.5.1** and
**CurseForge Release 6.5.0**. Their listings can update separately; check the
version on the actual download. Install the complete addon folder and keep
your SavedVariables; see the [6.5.1 release notes](V6_5_1_RELEASE_NOTES.md).
Guilded Games remains a separate optional Alpha.

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

## Optional: link your main and alts to Discord without a companion

Press **Link my WoW character / Lier mon personnage WoW** in the welcome panel.
It shows your existing characters and addon-only instructions; opening it does
not create a companion code or change any connection.

1. Log in on the character you want as your **main**. In WoW, type
   `/guilded character` and copy the full character line.
2. In that guild's Discord, use `/character import` and paste the line into
   **code**. Leave **main** unset: your first character becomes your main.
3. Check `/character list`. To add an **alt**, repeat on the alt and leave
   **main** unset. Your existing main stays the same.

The character line and a companion connection code are different. Manual linking
needs only the addon. If you do not want Discord character linking, skip this.

## Optional: connect the online companion

Open the **online companion link supplied by your guild** (ending in `/companion/`).
In Discord, press **Link my WoW character / Lier mon personnage WoW** in the welcome
panel, or run `/character pair`. The private reply shows your linked main and alts,
and addon-only instructions. Choose **Connect optional companion / Connecter le
compagnon (facultatif)** for a private connection code
and an **Open online companion** button. `/character pair` opens that optional
connection directly.
Paste the code and press **Connect**: the code identifies your server.
Connect with the code, then save preferences. Sync your intended main first if
no character is linked yet; subsequent characters become alts. Use the labels **Connection & setup**,
**Connect** and **Save preferences** on the webpage; the Windows app is optional.
The addon is still required. Pairing replaces your previous companion link.

**Main already linked?** You can use the code to connect a companion for uploading
alts, or to reconnect a device. If your companion already works, keep that
connection: log in on an alt, `/reload`, then **Sync now**. It links as an alt
without changing your main. No new code is needed for each alt. Run
`/character list` after syncing to check the result. Opening the private code
reply keeps existing character links; using the code replaces the companion
connection. Community-only members can skip WoW setup entirely.

**If you see Choose SavedVariables folder** (enhanced browser build on supported
desktop Chrome/Edge): choose your account's `WTF/Account/<account>/SavedVariables`
folder containing `Guilded.lua`. After `/reload`, **Sync now** rereads the latest
file; you do not need to select it each time. **Save standings to addon** asks for
`<client>/Interface/AddOns/Guilded` and writes only `Standings.lua` there. Then
Choose `/guilded setup connected` when you want to use Discord standings, then
`/reload` again to load them. Do not select SavedVariables as
the output folder.

Folder choices and the Discord connection are
remembered locally on that browser/device. Closing the tab does not require a
new pairing code. Disconnect clears the saved connection and folders; use it
when finished on a shared computer. The browser may ask you to approve folder
access again. If site storage is unavailable, the companion warns that it cannot
remember connection/folder choices.
**Forget selected folders** clears remembered choices; browser site settings let
you revoke file permissions. Disconnect also clears the remembered folders.
Once the addon folder is configured and write access is allowed, **Sync now**
uploads and saves standings together. Nothing syncs after closing the page.
Connection and folder retention after reopening passed on the owner's browser
on 5 October; permission recovery and other-browser tests remain pending.

**If you see Choose Guilded.lua / Download standings:** select `Guilded.lua` after
each `/reload`, then **Sync now**. Download `Standings.lua`, place it in
`<client>/Interface/AddOns/Guilded`, then `/reload`. This is the fallback for
other browsers and older deployed companions.

The desktop app below is optional for automatic file watching, background sync
and PoE2 log tracking, especially useful for leaders and officers.

## Optional Windows companion: automatic sync

1. Install `Guilded Companion Setup <version>.exe` from your guild's release link,
   then open Guilded Companion. The installed app does not need Node.js.
   Current installers are unsigned; verify the download source before running one.
2. Open **Connection & setup** (new installations open it automatically). Under
   **Connect your Discord account**, paste **Your guild's bot address** from your
   officer, ending in `/api/v1/addon-imports`, **before pairing**. Older 5.0 builds
   put **Bot address** under **Finish your setup → Advanced preferences**. A
   prefilled Quebec Gold address is correct only if your officer gave you it.
3. In your Discord server, run `/character pair` from your own account. Paste
   the private code and press **Connect** (the server ID under Advanced
   preferences fills itself in; older 6.5.0 companions still ask for it). It expires after 15 minutes and can be used once.
4. Enable **World of Warcraft**. Press **Find it**, then verify the selected
   `Guilded.lua` belongs to your current client and account. If several accounts
   are found, use **Browse** to select the right one:
   `<client>\WTF\Account\<account>\SavedVariables\Guilded.lua`.
   Do not select the addon code in `Interface\AddOns`.
5. Press **Save & start syncing**. In WoW, `/reload`. Check **Activity** for a
   successful upload and the message that your character is linked.
6. Let the companion refresh standings. Choose `/guilded setup connected` to use
   Discord standings, then `/reload` again to load them in game.

**Success:** a fresh successful upload appears and the correct character is linked.
`0 ledger entries, 0 new characters` is normal when nothing new needs importing.
An officer's guild upload may wait for review if automatic import is off.

Leave the companion in the tray while playing. New game data reaches disk on
`/reload` or logout. Open each crafting profession normally: recipe detection is
automatic; `/guilded recipes mine` is only a way to inspect the stored result.

Pairing another companion replaces your previous link. Do not alternate between
desktop and browser pairing unless you intend to reconnect the device you use.

## Quick fixes

| What you see | What to do |
| --- | --- |
| Guilded missing from the AddOns list | Check the actual client folder and the exact Guilded.toc path above; restart WoW. |
| Find it finds no Guilded.lua | Log in with Guilded enabled and `/reload`, then Browse to your account's SavedVariables. |
| Pairing fails | Check your guild's bot address, pilot approval and the code's age; request a new code in that server. Version 6.5.1 finds the server from the code; older companions may ask for its ID. Keep codes private. |
| Link revoked or unauthorized | A newer pairing may have replaced this one. Ask an officer about membership/access, then pair this device again. |
| Cannot reach bot | Use Test connection. Ask the owner whether the bot and its HTTPS address are online. |
| Guild is not initialized / 404 | Confirm this bot is approved and set up in your server. The owner runs `/setup start`. Check the server ID only if an older companion or Advanced preferences asks for it. |
| Upload says it is awaiting review | An officer reviews/applies it with `/import apply`; ordinary members cannot apply guild ledgers. |
| Upload applied entries but some are on hold | An officer runs `/import held` to see each reason. Do not award again: applied GP and a held loot record can belong to the same award. For an unlinked character, the officer uses `/character link` to select that character and its actual Discord owner; the next upload retries the existing entry. A missing core raid needs officer review of the raid recording/match. |
| Upload works but standings look old | Check the companion's separate standings status; refresh standings, wait for success, then `/reload`. |
| Profession list seems empty | Open the profession window and let it finish loading. If still empty, send the profession name and current diagnostic output. |
| No tray icon | Check the hidden-icons arrow beside the Windows clock, then open Guilded Companion from Start. |
| Lua error | Capture the error and `/guilded diag`; note the timestamp. Saved diagnostic history can include older notices. |
| One computer sees a guildmate's map dot but the other does not | Follow the map check below. A full character logout/login restored delivery in the tested Forever beta case. |

For help, use **Activity → Download support summary**, or copy the exact error,
the addon/companion versions, client build and time of failure. Review attachments
before sharing; do not upload config.json, credentials, bot tokens or pairing codes.
The [AI help prompts](AI_SETUP_HELP.md) include a member troubleshooting prompt.

### Guild map: a dot is missing

Map sharing and map dots start enabled. Both players need Guilded, membership in
the same in-game guild, and an available outdoor position. Stay out of combat
while testing. The minimap only shows players who are nearby.

Run `/guilded map check` on both computers. Check the module, sharing and dots
settings and whether your own position is available. **Peers 0** means no usable
guildmate position is currently stored; changing map zoom cannot repair that.
Send counters marked **accepted** mean the client accepted an outgoing update,
not that another player received it. A last outcome of **self** can be a normal
echo of your own message; it does not prove another character was misidentified.

If reception works in one direction, check whether an ordinary guild-chat message
from the missing character reaches the other player. Verify guild-chat permissions
and any ignore/block settings that the actual client exposes. Do not assume the
beta has the same menus as another WoW version.

During testing on Forever beta 1.60.1, both map settings, guild permissions and
the receiving player's ignore status were correct, but the other player's messages
did not reach the receiver. **Logging the missing character out and back into the
game**, then waiting 35 seconds outdoors, restored the dot. `/reload` alone had
not resolved it. This is a verified recovery step for that case, not a guarantee
for every missing dot. If it persists, provide both map-check outputs and say
whether ordinary guild chat arrives.

<section id="fr" lang="fr" aria-label="Installation en français">

## Installation et connexion en français

**L'addon fonctionne sans Discord.** Il ne faut ni compte d'hébergement, ni base
de données, ni jeton de bot pour jouer. Client ciblé : **WoW Forever 1.60.1**.
Au 18 octobre 2026, GitHub propose la Release **6.5.1** et CurseForge la Release
**6.5.0**. Vérifiez toujours la version du fichier téléchargé; Guilded Games
reste un addon Alpha séparé.

Pour ajouter le bot à votre guilde, utilisez le lien **Add Guilded** ci-dessus.
**L'approbation de KCaron est obligatoire avant l'activation du serveur.**
Après son accord, lancez `/setup start`. Le pilote hébergé est gratuit; tout
soutien financier est facultatif et ne donne aucune priorité.

1. Téléchargez l'addon depuis GitHub Releases ou CurseForge, avec la version
   choisie par votre guilde. Aucun passage par Discord n'est requis.
2. Fermez WoW. Installez le dossier Guilded dans `Interface\AddOns` du bon client
   (Forever beta : `_classic_beta_` dans l'installation testée), puis relancez WoW.
3. Ouvrez Guilded avec la pièce sur la minicarte. `/reload` enregistre les données.
4. **L'addon seul est le choix par défaut. Vous pouvez arrêter ici.** Pour un lien
   Discord facultatif sans compagnon : `/guilded character` sur votre principal,
   puis `/character import` → **code** sur Discord, avec **main** vide. Répétez
   sur les alts avec **main** vide. Vérifiez `/character list`.
5. **Compagnon facultatif :** dans **Lier mon personnage WoW**, choisissez
   **Connecter le compagnon (facultatif)**, ou utilisez `/character pair`.
   Ouvrez **Ouvrir le compagnon en ligne**.
6. Avec le compagnon **6.5.1**, collez seulement votre code privé dans
   **Connection & setup**, puis **Connect**. Le code retrouve votre serveur.
   Il expire après 15 minutes et ne sert qu'une fois. Les anciens compagnons
   peuvent encore demander l'identifiant du serveur; le champ reste dans
   **Advanced preferences** pour les cas où il est nécessaire.
   Sélectionnez le dossier `SavedVariables` de votre compte et, avec
   **Save standings to addon**, le dossier `Interface/AddOns/Guilded`.
7. Après `/reload`, cliquez sur **Sync now**. Synchronisez votre principal d'abord
   si aucun personnage n'est encore lié. Pour les classements Discord en jeu,
   choisissez `/guilded setup connected`. Vérifiez l'envoi et le classement,
   puis faites `/reload` pour charger le classement en jeu. Le navigateur garde
   la connexion et les dossiers si le stockage est disponible.

Le compagnon Windows reste facultatif pour la synchronisation automatique en
arrière-plan et le suivi PoE2, particulièrement utile aux chefs et officiers.

**Principal déjà lié et compagnon connecté ?** Connectez-vous sur un alt,
faites `/reload`, puis **Sync now** dans le même compagnon. Votre principal reste
le même; aucun nouveau code nécessaire pour chaque alt. Le code sert à connecter
ou reconnecter un compagnon; l'utiliser remplace la connexion compagnon
précédente. `/character list` montre le résultat après la synchro.

Vous n'avez pas besoin du jeton du bot. Ne partagez jamais votre code de liaison.
`/guilded lang fr` sélectionne le français dans l'addon.

**Vérification :** la fenêtre s'ouvre sans erreur Lua. Si vous utilisez la
synchronisation facultative, vérifiez l'envoi réussi, le bon personnage et les
classements après `/reload`. Un envoi en attente de révision doit être examiné
par un officier; ne recréez pas une attribution déjà importée.

En cas de problème, joignez les versions de l'addon et du compagnon, le build
du client, les étapes et l'heure du problème. Anonymisez les captures. Ne
partagez jamais `config.json`, un jeton, un code de liaison ou vos données de compte.

[Comprendre le fonctionnement EPGP](EPGP_GUIDE.md#fr) · [Pilote Discord facultatif](HOSTED_PILOT.md#fr)

</section>
