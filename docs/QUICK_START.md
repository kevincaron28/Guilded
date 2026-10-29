# Guilded: quick setup

**Start with the addon only.** It works on its own: standings, loot, recipes and dungeon runs are
shared with your guild in game. Discord and the companion are optional extras for taking it online.

- **Download:** pick your WoW edition on the [download page](https://guilded.kcaron.top/editions/).
- **Windows companion (optional):** [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9),
  which keeps itself up to date, or the [standalone installer](https://github.com/kevincaron28/Guilded/releases/latest).
- **Discord bot (optional):** [add the free hosted bot](HOSTED_PILOT.md). Your server gets
  Guilded Lite right away; addon sync, EP/GP and seasons unlock once your server is approved.
  Nothing to host. The [page for officers](https://guilded.kcaron.top/officers/) sums it up.
- **Host your own bot:** the [illustrated owner walkthrough](OWNER_WALKTHROUGH.md) has account links,
  screenshots and copyable commands.

| You are | You need | Time |
| --- | --- | --- |
| A player, addon only | The Guilded addon for your edition | 5–10 minutes |
| A member of a guild with the bot | The addon; the companion is optional | 5–10 minutes |
| An officer adding the hosted bot | The addon, the bot invitation and the online companion | Lite right away; the rest after approval |
| An owner hosting their own bot | The bot source, the addon and the companion | About 30 minutes once your server is ready |

Times are rough estimates. Download only from the [download page](https://guilded.kcaron.top/editions/),
[GitHub Releases](https://github.com/kevincaron28/Guilded/releases) or
[CurseForge](https://www.curseforge.com/wow/addons/guilded).

## Hosted guild owners: three steps

1. [Add the free hosted bot](HOSTED_PILOT.md). Your server starts on Guilded Lite;
   the rest unlocks once your server is approved (no reinvite needed).
2. Run `/setup start` in Discord. Choose your language and
   features, place the bot role above roles it must assign, then run
   `/setup start status:true` to find missing settings.
3. For WoW sync, follow the member steps below with one player first. Confirm
   that their character and standings match in Discord and in game, then share
   [the member guide](MEMBER_INSTALL.md) with your guild. Use the
   [hosted companion](https://guilded.kcaron.top/companion/) and choose
   **Sign in with Discord**: enter the code displayed in the companion on the
   sign-in page, then choose your server. At least one officer should run
   the companion: members who only use the addon reach Discord through it.

Community activities and polls need no WoW addon or character pairing. Hosted
owners can stop here; the independent hosting sections below are optional.

## Members: addon only by default

1. Close WoW and extract **Guilded** into your actual client's `Interface/AddOns`.
   Check `Guilded/Guilded.toc` exists. Open WoW, open Guilded, then `/reload`.
2. Use **In-game only** in `/guilded setup` and start playing. You can stop here.
   Current releases select this mode automatically; older builds may show
   the chooser. No Discord character link or companion is required.

### Optional: link your main and alts without a companion

Press **Link my WoW character / Lier mon personnage WoW** in the welcome panel,
or run `/character pair`. Copy the line it shows, such as
`/guilded verify ABCD-EFGH`, and paste it into WoW chat once, on any character.
That's all: every character you play on that WoW account links itself, the first
one as your main, after an online officer's addon receives their guild data and
that officer saves and syncs it. You get a Discord DM; `/character list` confirms the result.

If no officer's companion has synced for two weeks, `/character pair` also shows
the manual way: `/guilded character` in game, pasted into Discord's
`/character import` → **code** with **main** unset, once per character.

### Optional: connect the online companion

1. Choose **Connect optional companion** in that private reply, or use
   `/character pair`. Open its online companion button and choose
   **Sign in with Discord**, enter the companion's confirmation code on the
   sign-in page, then choose your server.
2. Enable WoW and choose your account's SavedVariables folder. Use **Save standings
   to addon** once to choose `Interface/AddOns/Guilded`. After `/reload`, click
   **Sync now** on your main first if none is linked. Choose
   `/guilded setup connected` for Discord standings, then `/reload` again.

The Windows companion is optional for automatic file watching, background sync
and PoE2 log tracking, especially useful for leaders and officers.

**Already connected with a main?** Log in on an alt, `/reload`, then **Sync now**
with the same companion. Your main stays linked; no new code needed. Signing in
again only adds a device; your other companions stay connected. `/character list` shows the result after syncing.

See [Member installation](MEMBER_INSTALL.md)
for the detailed UI steps, the manual browser option, French steps and fixes.

### Online companion folders

The Windows companion remembers Guilded.lua and derives the addon folder from
its WTF path. In the online companion, choose two folders once on each PC:
`WTF/Account/<your account>/SavedVariables` for reading and
`Interface/AddOns/Guilded` with **Save standings to addon** for writing.
Supported browsers remember those choices locally. Once output access is allowed,
**Sync now** uploads and saves returned standings together.
Use `/reload` before syncing and again afterward to load the new standings.
If the browser asks to renew access, use **Save standings to addon** again.
No fixed drive or account path is assumed for other players.

## Independent hosting only: before starting the timer

Have these ready:

- A Discord server you manage and access to the Discord Developer Portal.
- A dedicated Ubuntu 22.04/24.04 server with SSH/sudo access.
- An empty PostgreSQL 16+ database and its connection string.
- Your own DNS hostname pointing to the server, with TCP 80/443 allowed by its
  cloud firewall. The server needs outbound internet access for installation.
- Matching release source and addon ZIP; optional Windows companion installer.

New cloud accounts, payment verification, available server capacity and DNS
propagation can take longer than 30 minutes. These infrastructure requirements apply only to independent hosting. Approved
[hosted pilot](HOSTED_PILOT.md) guilds use the existing bot and skip these steps.

## Independent hosting only: the 30-minute target

| Target | Action | Visible success |
| --- | --- | --- |
| Minutes 0–5 | Create your Discord application, enable Server Members Intent, invite it with the documented permissions, move its role above managed roles | Correct bot is in your server |
| Minutes 5–15 | Run the Ubuntu installer from the selected source, fill four required settings, run `setup:check`, start the service | Public `/health` and `/companion/` open; `/report ping` responds |
| Minutes 15–22 | `/setup start`: choose language, create missing roles/channels, update bot messages; `/core setup` for your first roster | Setup status shows the required roles/channels configured |
| Minutes 22–30 | Pair one officer, upload after `/reload`, load returned standings, give members the filled-in pinned handout | Correct character and standings appear |

Follow [Guild owner setup](GUILD_OWNER_SETUP.md) for Discord and configuration,
and [Ubuntu hosting](DEPLOY_ORACLE.md) for the exact installation commands.
Leave AI answers, Warcraft Logs and optional community features off until basic sync works.

Before guild-wide rollout, also test an ordinary member's access. Continue the
fresh-PC, recovery and real-raid follow-up checks in the
[acceptance checklist](V6_2_GAME_ACCEPTANCE.md). Setup speed alone does not prove
permissions, accounting or recovery work.

<section id="fr" lang="fr" aria-label="Démarrage rapide en français">

## Démarrage rapide en français

### Jouer avec l'addon seul

1. Téléchargez un fichier Release depuis les liens officiels GitHub ou CurseForge.
   Installez le dossier **Guilded** dans `Interface/AddOns` du client que vous utilisez.
2. Ouvrez la pièce dorée sur la minicarte, puis faites `/reload` pour enregistrer.
   Le mode **In-game only** est le choix par défaut. Vous pouvez rester ici.
3. Consultez [le guide d'installation](MEMBER_INSTALL.md#fr) pour les chemins exacts,
   les mises à jour et les solutions aux problèmes courants.

### Organiser les points et le butin

Commencez avec votre règlement : qui enregistre les points, quel core et quelle
méthode de butin. Le [guide EPGP](EPGP_GUIDE.md#fr) explique la priorité, le suivi
en jeu et la synchronisation facultative, sans mélanger les réserves, le conseil
et les enchères GP.

### Ajouter Discord plus tard

Le bot hébergé est gratuit. Votre serveur commence en **Guilded Lite** : lancez
`/setup start` pour les rôles et les salons. La synchronisation, l'EP/GP et les
saisons se débloquent une fois votre serveur approuvé, parfois automatiquement après
quelques jours d'utilisation. Les places restent limitées. [Lire le guide du bot](HOSTED_PILOT.md#fr)
ou la [page des officiers](https://guilded.kcaron.top/officers/?lang=fr).

Après l'approbation et la configuration, chaque membre peut utiliser son propre
`/character pair`. Sans compagnon, il copie la ligne affichée (par exemple
`/guilded verify ABCD-EFGH`) et la colle une seule fois dans le chat de WoW : tous
ses personnages de cette guilde se lient après qu'un officier en ligne a reçu,
enregistré et synchronisé leurs données; il reçoit un message privé Discord. Avec le compagnon,
il choisit **Connexion avec Discord**, saisit le code affiché dans son compagnon
sur la page de connexion, puis choisit le serveur. Au moins un
officier devrait utiliser le compagnon. Le compagnon Windows est facultatif.
Vérifiez une première synchronisation et les permissions d'un membre ordinaire
avant de déployer à toute la guilde.

</section>
