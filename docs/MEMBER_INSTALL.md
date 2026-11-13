# Guilded: install and connect

For guildmates using **WoW Forever**. You do not need
Node.js, a database, or a Discord bot token.

> **WoW Forever only.** Guilded supports WoW Forever. The Classic Era/Hardcore, Burning Crusade Classic,
> Mists of Pandaria Classic and Retail versions were removed on 7 November 2026; uploads from them are refused.
> Data already saved stays as it was.

In [the latest published release](https://github.com/kevincaron28/Guilded/releases/latest),
choose the addon ZIP ending in `forever`. The Windows companion looks only for the WoW Forever saved file
(`_forever_`); connect your guild in its own profile. Enable **Load out of date AddOns** if the
client requests it. Real-client and two-PC checks remain pending follow-up.

**Français :** Guilded prend en charge WoW Forever uniquement. Choisissez le ZIP qui se termine par
`forever`. Le compagnon Windows cherche seulement le fichier enregistré de WoW Forever, avec un profil
par guilde. Les vérifications en jeu restent à effectuer.

[Français](#fr) · [Quick setup](QUICK_START.md) · [EPGP workflow](EPGP_GUIDE.md) · [Optional hosted bot](HOSTED_PILOT.md)

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

**[Add Guilded to your server](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718837849168)**

The hosted bot is free. Adding it puts your server on **Guilded Lite** right away
(setup, help, bug reports, dungeon groups, basic signups); KCaron's approval unlocks
addon sync, EP/GP, seasons and the guild page. Run `/setup start`, then, once approved,
install the [Windows companion](https://guilded.kcaron.top/companion/) (Microsoft Store first) and choose
**Sign in with Discord**, then follow the confirmation shown by your companion.
You do not need to host a bot or database for this path.
See the [hosted bot guide](HOSTED_PILOT.md). Independent hosting is also available.
Any [financial support](SUPPORT_GUILDED.md) is optional and never buys approval.

## Get your guild's links

For automatic Windows syncing, install [Guilded Companion from Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (listed there as **Guild Sync Companion**).
The [standalone GitHub installer](https://github.com/kevincaron28/Guilded/releases/latest) is also available.
Store installations receive updates through Microsoft Store; check its listed version because
Store certification and GitHub releases can finish at different times. Close your existing
companion before switching editions; the Store copy keeps separate connection settings.

**Français :** installez le [compagnon Windows depuis le Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (affiché là-bas sous le nom **Guild Sync Companion**).
Les mises à jour passent par le Store. Vérifiez la version proposée et fermez l'autre compagnon
avant de changer d'édition; la version Store conserve ses propres paramètres de connexion.

Ask your officer for the addon download. Start with the addon; the online
companion and Windows app are optional. If you want companion sync later, ask
for your guild's online link. Use the matching release
your officer specifies. Public releases belong on
[GitHub Releases](https://github.com/kevincaron28/Guilded/releases) and
[CurseForge](https://www.curseforge.com/wow/addons/guilded); only use a version
actually listed there. The stores can update separately, so confirm the version on
the selected download. Private candidate packages are for acceptance testing only.
Install the complete addon folder and keep your SavedVariables. See the
[latest release notes](https://github.com/kevincaron28/Guilded/releases/latest).
Guilded Games remains a separate optional Alpha.

## 1. Install the addon

1. Close WoW. Open the folder for the client you actually play: the one beside the
   game executable you launch. (The Forever beta used `_classic_beta_` beside `WowB.exe`;
   from launch on 4 November 2026, find the live game executable first.)
2. Extract the addon's **Guilded** folder into `Interface\AddOns` there. The result
   must be `Interface\AddOns\Guilded\Guilded.toc`, with no extra nested Guilded folder.
3. Start WoW, enable Guilded in the AddOns list, and enter the game. Click the
   gold minimap coin to open Home. `/guilded menu` also opens the window.
4. Type `/reload` once to create or update the saved-data file.

**Success:** Home opens without a Lua error. If you only want the in-game addon,
you can stop here. Discord sync needs the steps below.

## Optional: link your main and alts to Discord without a companion

1. In Discord, press **Link my WoW character / Lier mon personnage WoW** in the
   welcome panel, or run `/character pair`. The private reply starts with one
   line in a box, such as `/guilded verify ABCD-EFGH`.
2. Copy that line, paste it into WoW chat on any of your characters and press
   Enter. That's all, also for your alts.

Characters you play in this guild on that WoW account can then link, the first one as
your main, after an online officer's addon receives their guild data and that officer
saves and syncs it. Both players need matching addons. You
get a Discord DM for each one; `/character list` shows the result. Not your
character? `/character unlink` removes it, and the code will not link it again.
The line is the same every time you run `/character pair`.

If no officer's companion has synced for two weeks, the reply also shows the
manual way: in WoW type `/guilded character`, copy the line, then in Discord use
`/character import` and paste it into **code** with **main** unset (once per
character). Without a guild, `/guilded verify` has nothing to link: the addon
works on its own. If you do not want Discord character linking, skip this.

## Optional: install and connect the Windows companion

The companion is optional if you only use the addon, but needed to share data with Discord
and the website (achievements, leaderboards, sync). It runs on **Windows only**. Install it
from [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (recommended: Store-signed, updates itself; search **Guild Sync Companion**, the name it is listed under). The fallback is
the [direct download on GitHub](https://github.com/kevincaron28/Guilded/releases/latest),
which is unsigned, so Windows may warn before running it. You can also press **Connect optional
companion / Connecter le compagnon (facultatif)** in the `/character pair` reply and use its
**Get the Windows companion** button. In
the companion window, press **Sign in with Discord** (optional, it syncs without): your browser opens, pick
your server and press **Connect**. Nothing to type: the Windows app
receives the approval by itself. Sync your intended main
first if no character is linked yet; later characters become alts. The addon is still required. Each device you sign in stays
connected; manage them under Connections on the website.

**Main already linked?** Keep your working companion: log in on an alt, `/reload`,
then **Sync now**. It links as an alt without changing your main; nothing new to
type for each alt. Run `/character list` after syncing to check the result.
Companions older than 7.2 have no **Sign in with Discord**: install the current companion.
Community-only members can skip WoW setup entirely.

The companion is a Windows desktop app (one window plus a notification-area menu); there is no browser version.

## Optional Windows companion: automatic sync

1. Install the companion from the [companion page](https://guildedwow.com/companion/) (or the Microsoft Store, where it is listed as
   **Guild Sync Companion**), then open it. The installed app does not need Node.js.
   The direct installer is unsigned; verify the download source before running one.
2. The window opens by itself the first time and tells you in plain words what works and what needs you: the game
   folder, the addon, the sync. There is nothing to choose: it finds WoW and installs the Guilded addon.
   **Sign in with Discord** is optional: press it to confirm your characters, then pick your server in the browser
   and press **Connect**. Nothing to type.
3. A guild with its own bot (not the hosted one)? A custom upload address or a one-time pairing code can no longer be
   typed in the window: the companion uses the hosted setup and the Discord sign-in only.
4. If the game folder is not found, the window says so and offers **Choose WoW folder**: pick the folder that holds
   `_forever_`. **Advanced** shows the saved file it uses (your account's `SavedVariables` folder, `Guilded.lua`).
   Do not select the addon code in `Interface/AddOns`. Several WoW accounts on this PC sync by themselves: see below.
5. In WoW, `/reload`. The **Last sync** line turns green with the time, and the message that your character is linked
   shows under **Advanced > Activity**.
6. Let the companion refresh standings, then `/reload` again: the addon loads and
   uses the Discord standings by itself.

**Success:** a fresh successful upload appears and the correct character is linked.
`0 ledger entries, 0 new characters` is normal when nothing new needs importing.
An officer's guild upload may wait for review if automatic import is off.

Leave the companion in the tray while playing. New game data reaches disk on
`/reload` or logout. Open each crafting profession normally: recipe detection is
automatic; `/guilded recipes mine` is only a way to inspect the stored result.

**Several WoW accounts on one PC (WoW1, WoW2…).** Each syncs by itself. When the
companion finds Guilded's data on another account of the same WoW, it asks once in
the companion window whether that account is yours too: **Yes, sync it too** adds it;
**No, not mine** (a partner who plays on this PC with their own Discord) is
remembered and never asked again. Each account then has its own line under **Advanced > WoW accounts**, with a checkbox to change the answer later.
Log in once on a new account and `/reload` so WoW saves its data.

Signing in on another companion adds a device; your other companions stay
connected. Remove a device under Connections on the website. **Update now** in the companion window opens the new version's
installer, which shows its progress and restarts the companion; if an update does
not finish, the next start offers **Run the installer**.

## Quick fixes

| What you see | What to do |
| --- | --- |
| Guilded missing from the AddOns list | Check the actual client folder and the exact Guilded.toc path above; restart WoW. |
| Find it finds no Guilded.lua | Log in with Guilded enabled and `/reload`, then Browse to your account's SavedVariables. |
| Sign in with Discord fails | Check full Guilded approval and, for a guild with its own bot, its address; then choose **Sign in with Discord** again. Companions older than 7.2: use a new `/character pair` code (one use, 15 minutes) and keep it private. |
| `/guilded verify` did not link yet | Linking happens on the next upload from an **officer's** companion: ask an officer to `/reload` and **Sync now**. `/guilded verify` in game says whether your code is saved. |
| Link revoked or unauthorized | This device was removed under Connections, or your server access changed. Ask an officer about membership/access, then sign this device in again. |
| Cannot reach bot | Press **Sync now** and read the **Last sync** line; **Advanced > Activity** shows the reason. Ask the owner whether the bot is online. |
| Guild is not initialized / 404 | Confirm this bot is approved and set up in your server. The owner runs `/setup start`. Check the server ID only if an older companion or Advanced preferences asks for it. |
| Upload says it is awaiting review | An officer reviews/applies it with `/import apply`; ordinary members cannot apply guild ledgers. |
| Upload applied entries but some are on hold | An officer runs `/import held` to see each reason. Do not award again: applied GP and a held loot record can belong to the same award. For an unlinked character, the officer uses `/officer character link` to select that character and its actual Discord owner; the next upload retries the existing entry. A missing core raid needs officer review of the raid recording/match. |
| Upload works but standings look old | Check the companion's separate standings status; refresh standings, wait for success, then `/reload`. |
| Profession list seems empty | Open the profession window and let it finish loading. If still empty, send the profession name and current diagnostic output. |
| No tray icon | Check the hidden-icons arrow beside the Windows clock, then open Guilded Companion from Start. |
| Lua error | Capture the error and `/guilded diag`; note the timestamp. Saved diagnostic history can include older notices. |
| One computer sees a guildmate's map dot but the other does not | Follow the map check below. A full character logout/login restored delivery in the tested Forever beta case. |

For help, copy the lines under **Advanced > Activity**, or the exact error,
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
Les sites peuvent être mis à jour séparément : vérifiez la version du fichier choisi.
Les versions candidates privées servent aux tests d'acceptation. Installez le dossier
complet de l'addon et conservez vos SavedVariables.
Consultez les [dernières notes de version](https://github.com/kevincaron28/Guilded/releases/latest).
Guilded Games reste un addon Alpha séparé et facultatif.

Pour ajouter le bot à votre guilde, utilisez le lien **Add Guilded** ci-dessus.
Le serveur passe tout de suite en **Guilded Lite**; l'approbation de KCaron débloque
la synchro de l'addon, l'EP/GP et les saisons. Lancez `/setup start`. Le bot hébergé est gratuit; tout
soutien financier est facultatif et ne donne aucune priorité.

1. Téléchargez l'addon depuis GitHub Releases ou CurseForge, avec la version
   choisie par votre guilde. Aucun passage par Discord n'est requis.
2. Fermez WoW. Installez le dossier Guilded dans `Interface\AddOns` du bon client
   (le dossier à côté de l'exécutable du jeu que vous lancez; la bêta utilisait `_classic_beta_`),
   puis relancez WoW.
3. Ouvrez Guilded avec la pièce sur la minicarte. `/reload` enregistre les données.
4. **L'addon seul est le choix par défaut. Vous pouvez arrêter ici.** Pour lier
   vos personnages à Discord sans compagnon : appuyez sur **Lier mon personnage WoW**
   ou lancez `/character pair`, copiez la ligne affichée (par exemple
   `/guilded verify ABCD-EFGH`) et collez-la une seule fois dans le chat de WoW.
   Vos personnages de cette guilde peuvent ensuite se lier, le premier comme
   principal, après qu'un officier en ligne a reçu, enregistré et synchronisé leurs
   données. Les deux joueurs doivent avoir les addons correspondants. Vous recevez
   un message privé Discord. Vérifiez `/character list`.
   Si aucun compagnon d'officier n'a synchronisé depuis 2 semaines, la réponse
   montre aussi la méthode manuelle : `/guilded character` en jeu, puis
   `/character import` → **code** sur Discord avec **main** vide.
5. **Compagnon facultatif :** dans **Lier mon personnage WoW**, choisissez
   **Connecter le compagnon (facultatif)**, ou utilisez `/character pair`.
   Installez le compagnon Windows avec **Obtenir le compagnon Windows** (Microsoft Store d'abord).
6. Dans la fenêtre du compagnon, appuyez sur **Se connecter avec Discord** (facultatif) : le navigateur
   s'ouvre, choisissez votre serveur et appuyez sur **Connecter**. Rien à taper.
   Les compagnons plus anciens que 7.2 doivent être mis à jour.
   Sélectionnez le dossier `SavedVariables` de votre compte et, avec
   **Save standings to addon**, le dossier `Interface/AddOns/Guilded`.
7. Après `/reload`, cliquez sur **Sync now**. Synchronisez votre principal d'abord
   si aucun personnage n'est encore lié. Vérifiez l'envoi et le classement,
   puis faites `/reload` : l'addon charge et utilise le classement Discord tout seul. Le navigateur garde
   la connexion et les dossiers si le stockage est disponible.

Le compagnon Windows reste facultatif pour la synchronisation automatique en
arrière-plan et le suivi PoE2, particulièrement utile aux chefs et officiers.

**Principal déjà lié et compagnon connecté ?** Connectez-vous sur un alt,
faites `/reload`, puis **Sync now** dans le même compagnon. Votre principal reste
le même; rien à refaire pour chaque alt. Se reconnecter avec **Sign in with
Discord** remplace la connexion compagnon précédente. `/character list` montre le
résultat après la synchro. **Mettre à jour** ouvre l'installateur de la nouvelle
version, qui montre sa progression et redémarre le compagnon; si une mise à jour
ne se termine pas, le prochain démarrage propose de lancer l'installateur.

**Plusieurs comptes WoW sur un PC (WoW1, WoW2…) :** chacun se synchronise tout
seul. Quand le compagnon trouve des données Guilded sur un autre compte du même
WoW, il demande une seule fois, dans sa fenêtre, si ce compte est à
vous aussi : **Oui, le synchroniser aussi** l'ajoute; **Non, pas le mien** (un ou
une partenaire qui joue sur ce PC avec son propre Discord) est retenu et il ne
redemande plus. Chaque compte a ensuite sa ligne sous **Avancé → Comptes WoW**, avec une case
pour changer la réponse plus tard. Connectez-vous une fois sur un nouveau compte et faites `/reload`.

Vous n'avez pas besoin du jeton du bot. Ne partagez jamais un code à usage unique
de `/character pair`.
`/guilded lang fr` sélectionne le français dans l'addon.

**Vérification :** la fenêtre s'ouvre sans erreur Lua. Si vous utilisez la
synchronisation facultative, vérifiez l'envoi réussi, le bon personnage et les
classements après `/reload`. Un envoi en attente de révision doit être examiné
par un officier; ne recréez pas une attribution déjà importée.

En cas de problème, joignez les versions de l'addon et du compagnon, le build
du client, les étapes et l'heure du problème. Anonymisez les captures. Ne
partagez jamais `config.json`, un jeton, un code de liaison ou vos données de compte.

[Comprendre le fonctionnement EPGP](EPGP_GUIDE.md#fr) · [Bot Discord facultatif](HOSTED_PILOT.md#fr)

</section>
