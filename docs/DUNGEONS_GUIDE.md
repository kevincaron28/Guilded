# Guilded Dungeons: setup, runs and your player page

[Français](#fr) · [Install Guilded](MEMBER_INSTALL.md) · [Connection checklist](ONLINE_COMPANION_CHECK.md)

## Choose your addon

**Guilded Dungeons** is the small standalone dungeon tracker. It works without a
guild or a Discord bot. **Guilded** includes the same tracker plus guild and raid
tools. If both are installed, Guilded records the runs and Guilded Dungeons stays
quiet, so the two addons do not record the same run twice.

Use the files offered on the [Guilded releases page](https://github.com/kevincaron28/Guilded/releases).
Look for the `GuildedDungeons` download for the standalone addon, or `Guilded`
for the full addon. Keep your SavedVariables when upgrading.

## Install and record your first run

1. Close WoW and find the folder of the game client you actually use.
2. Extract the addon into `Interface\AddOns`. For the standalone addon, the
   resulting file must be `Interface\AddOns\GuildedDungeons\GuildedDungeons.toc`.
   Avoid an extra nested folder.
3. Enable the addon at character selection, log in, then use `/gdungeons status`
   (or `/gdg status`). With full Guilded, use `/guilded dungeon status`.
4. Enter a supported five-player dungeon. Recording starts automatically and
   completion is detected on the final boss. Use `/gdungeons results` to inspect
   your history; the full addon also shows results in its dungeon window.
5. After the run, `/reload` or log out. WoW writes the saved file then; a companion
   cannot read unsaved in-memory results.

Local recording needs no account or companion. A recorded run is not automatically
a rated run: supported routes, completion, levels and the current season's rules
determine eligibility. Do not manually finish a run just to make it score.

## Send runs to the website

1. Open the [companion](https://guilded.kcaron.top/companion/) or the Windows
   companion app. Choose **Sign in with Discord**.
2. Choose your **personal account** for public dungeon runs without a guild. If you
   want an approved guild's standings and raid information too, choose that server.
   A guild administrator controls whether guild runs are shared publicly.
3. Select the saved file from the client you played:
   `WTF\Account\<account>\SavedVariables\GuildedDungeons.lua`, or `Guilded.lua`
   for full Guilded. Select the `.lua` file, not its `.bak` backup.
4. Choose **Sync now** after WoW saves. Check the companion's result: new,
   confirmed, already sent or refused. Repeated uploads do not add the same run
   again. Conflicting results can be held for review.
5. Open the [leaderboards](https://guilded.kcaron.top/leaderboards/), choose the
   season and level bracket, and open your character for scores and run history.

Never paste your companion credential into Discord or a public profile. For old
companions without Discord sign-in, obtain a personal code from
[My Guilded](https://guilded.kcaron.top/me/).

## Your player profile and management page

The website has two views:

- **Public player profile:** public by default after Discord sign-in. Shows your
  display name, linked characters and accepted public runs. Character links open
  seasonal scores and best runs. Personal-companion characters appear after a
  successful upload; party members are not automatically linked as your alts.
- **[My Guilded](https://guilded.kcaron.top/me/):** your signed-in controls for
  profile visibility, companion connection, recruitment applications and your
  looking-for-guild card. Pairing codes and application messages stay private.

You can hide your player profile from My Guilded. This hides the account profile;
already-public character results remain on the leaderboards. Scores are computed
from runs, not editable on a profile. Ask an officer or report a bug if a run is
wrong; include its date, dungeon and character, never your pairing credential.

## Find a raid or a permanent core

[Recruitment](https://guilded.kcaron.top/recruitment/) separates guild/core
recruitment from **open raid spots** for a single raid night. Filter by role,
realm, faction and language. Join the host guild's Discord, then use its linked
signup post. Seeing a vacancy does not reserve it; the host's roster is authoritative.

Officers can advertise one upcoming raid with `/raid pug share` and enable an
`open-raids` channel with `/raid pug board enabled:true`. Sharing is optional for
each occurrence. Full, cancelled and started raids disappear from the feed.

Full Guilded adds **Open raids** in its window (`/guilded pug`). A connected guild
companion downloads the public list; sync and `/reload` to load it. The addon shows
the download time and refuses snapshots older than ten minutes. Use **Copy Discord**
to open the host invite in your browser. Website counts are current when loaded;
Discord boards refresh each minute. The addon does not sign you up or invite you.

## If a run is missing

- **No local result:** check that the addon was enabled, the dungeon/route is
  supported, and the final boss was recorded. Use `/gdungeons check`.
- **Result local, absent online:** save with `/reload`, confirm the selected file
  and character, then Sync now and read the upload message.
- **Online but no score:** check the season, bracket and rating rules. Completion
  alone is not a promise of points.
- **Profile empty:** use the same Discord account for sign-in and companion
  connection. Guild character links come from Discord; personal character links
  come from successful run uploads. Older personal uploads may need one resync.
- **Raid browser stale:** sync the companion and reload. The website remains
  available when the game has an old snapshot.

<a id="fr"></a>

## Français — installation et premier donjon

**Guilded Dungeons** est le module autonome, sans guilde ni bot obligatoire.
**Guilded** contient déjà ce suivi, avec les outils de guilde. Si les deux sont
installés, Guilded enregistre et le module autonome reste silencieux.

1. Fermez WoW. Prenez le fichier `GuildedDungeons` (ou Guilded complet) parmi les
   [versions publiées](https://github.com/kevincaron28/Guilded/releases).
2. Extrayez le dossier dans `Interface\AddOns` du bon client. Vérifiez
   `GuildedDungeons\GuildedDungeons.toc`, sans dossier imbriqué en trop.
3. Activez l'addon, connectez-vous puis utilisez `/gdungeons status`
   (`/guilded dungeon status` avec Guilded complet).
4. Le suivi démarre à l'entrée d'un donjon pris en charge et termine au dernier
   boss. `/gdungeons results` montre les résultats.
5. Faites `/reload` ou déconnectez le personnage pour enregistrer le fichier.

Le suivi local fonctionne sans connexion. Un donjon terminé n'est pas forcément
coté : les parcours, niveaux et règles de la saison déterminent les points.

## Français — connexion, profil et recrutement

Dans le [compagnon](https://guilded.kcaron.top/companion/), choisissez
**Connexion avec Discord**, puis votre **compte personnel** pour les classements
sans guilde, ou un serveur approuvé pour les données de guilde. Sélectionnez
`WTF\Account\<compte>\SavedVariables\GuildedDungeons.lua` (ou `Guilded.lua`),
puis **Sync now** après la sauvegarde de WoW. Lisez le résultat de l'envoi.
Les doublons n'ajoutent pas de points; les conflits peuvent être retenus pour examen.

Votre **profil joueur est public par défaut** : nom affiché, personnages liés et
donjons publics acceptés. Ouvrez un personnage pour ses scores saisonniers.
[Ma page](https://guilded.kcaron.top/me/) permet de masquer le profil, gérer la
connexion du compagnon, voir les candidatures et modifier votre fiche de recherche
de guilde. Les codes et messages privés ne sont jamais dans le profil public.
Masquer le profil ne retire pas les résultats des classements.

Le [recrutement](https://guilded.kcaron.top/recruitment/) propose les guildes/cores
permanents et les places d'une seule soirée. Rejoignez le Discord hôte puis son
annonce d'inscription : une place doit y être confirmée.

Officiers : `/raid pug share` partage un raid; `/raid pug board enabled:true`
active le salon des raids des autres guildes. Chaque occurrence demande son propre
partage. Un raid complet, annulé ou commencé disparaît du flux.

Dans Guilded complet, `/guilded pug` ouvre **Raids ouverts**. Le compagnon connecté
à une guilde télécharge la liste. Synchronisez, puis `/reload`. Les données de plus
de dix minutes sont refusées; **Copier Discord** donne le lien à ouvrir dans votre
navigateur. Le site et le salon Discord servent à vérifier les places actuelles.

En cas de souci : vérifiez le résultat local, sauvegardez, confirmez le fichier
choisi et lisez le message d'envoi. Pour un problème de score, vérifiez la saison
et le niveau. Ne partagez jamais votre code ou identifiant secret du compagnon.
