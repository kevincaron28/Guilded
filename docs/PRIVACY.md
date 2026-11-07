# Guilded privacy / Confidentialité

Last updated / Dernière mise à jour : 6 November / novembre 2026.

## English

**Everything is shared.** From Guilded 8.5 there are no privacy or sharing settings. When you install Guilded and
connect your characters, everything it records about them is shared by design: your stats, levels, gear and
professions, achievements and badges, dungeon runs and scores, battleground results, duel results, map position
in the addon, the race to 60 and the leaderboards, in your guild and on the public leaderboards and player
profiles of guilded.kcaron.top. Do not install or connect Guilded if you do not want that. The one control left is
**Delete my data** (below).

One exception is the **guild map in the phone app** (owner decision, 6 November 2026): your companion uploads where
your own characters were last seen outdoors (zone, map point and time, kept 28 days) and your own calls for help (kept
7 days). Only signed-in members of your guild see them; they are never public. It is on by default; the **Share my
position** switch on the phone's Map tab turns it off and deletes every stored position of yours, and officers can turn
the map off for the server (`/officer roster map`). Delete my data removes them too.

This notice describes Guilded Companion, the Guilded website and the project-hosted
Guilded service operated by Kevin Caron (Guilded). A guild using its own server has
its own operator; contact that operator about its hosting and retention choices.

### Information used and why

Optional weekly recap delivery stores your chosen schedule, timezone, quiet hours,
on/off preference and latest delivery receipt. It sends a private Discord message
only after you opt in with `/automation recap`; pause with `action:off`. Preferences
and the latest receipt remain with your guild member record until removed under
the existing deletion process. Pausing does not recall messages already delivered
to Discord. Your visible preferences are included in `/me/data` and its export.


The desktop companion uses the game files you select to provide synchronization.
WoW records can include character names and realms, guild and edition identifiers,
roster and profession details, raid participation, gear/readiness, dungeon runs,
loot and EP/GP activity. The data depends on the installed addon, selected mode
and your permissions. Supported exports go to the configured Guilded service;
returned standings are written into your selected addon folder.

Optional Path of Exile 2 tracking reads recognized events from your selected
Client.txt log and sends parsed map-visit records with your configured character
and league information. It keeps a local retry journal. The visit payload does
not include the entire log or its chat text. The GRM converter produces a local
archive from a backup you choose; private history is excluded unless you enable
it. Conversion does not itself upload the archive.

Discord sign-in provides your Discord ID, username and available display name
using Discord's identify permission. Guilded does not ask for your Discord
password. Guild membership and roles are checked for protected features.
Authentication cookies maintain website sessions; the current session lifetime
is up to 30 days. A `guilded_edition` cookie remembers the WoW version you last
viewed on the website (for example `retail`) for up to a year; it holds nothing else. Technical requests and error records may contain connection
metadata and the context needed to operate, troubleshoot and protect the service.

Where configured, optional Battle.net linking asks Blizzard for account identity
and WoW character access. An unconfirmed character preview stays in server memory
for up to ten minutes. Only confirmed character selections are retained, with
Battle.net account ID/BattleTag, character and realm IDs, names, region, edition,
account main choice and verification time. These selections are private and do
not publish alts or change guild permissions. Blizzard access tokens are discarded
after discovery. Disconnect Battle.net in your account to delete its private
selection; existing guild records and retained backups follow their normal rules.

Companion connections have separate credentials and device names. Manage or
revoke them under your account's Connections page. Enabled Windows profiles keep
syncing in the background until paused or the companion exits. Pausing one profile
does not pause the others; quitting stops all profiles on that device.

If enabled, the website's static pages count visits with Cloudflare Web Analytics:
page views, referring sites, countries and page speed, with no cookies, no
fingerprinting and no cross-site tracking. Pages served by the bot (leaderboards,
recruitment, profiles, guild pages and the companion) never load it.

### Storage, recipients and security

Desktop profiles store selected paths, preferences and pairing credentials on
your computer. The Microsoft Store edition protects its configuration with
Windows-backed encryption in a separate Store profile folder. Other software
running as your Windows user may still access that user's data. Existing
standalone editions can store configuration as JSON; protect access to your
Windows account and do not share configuration files or pairing codes.

The configured Guilded server receives synchronized records. Project hosting uses
Oracle infrastructure, Aiven PostgreSQL and Cloudflare delivery; providers process
the information needed to deliver their services. Independently hosted guilds
choose their own infrastructure. Discord handles sign-in and guild messages;
Microsoft handles Store installation and updates. External services have their
own privacy notices. Data may be processed outside your country.

Guild records are shown according to guild roles and feature permissions.
Profiles, badges, statistics and leaderboards are shared by default and there is
no switch to turn that off; private items such as pairing codes, application
messages and credentials are never shared. Content posted
to Discord or a public page can be copied by people with access. Guilded uses
authentication, access checks and HTTPS for its hosted service. Configure a
trusted HTTPS endpoint when using a separately hosted server.

### Choices, access and deletion

**Delete my data.** Sign in on the Guilded website, open My data (`/me/data`) and press
**Delete my data** (type DELETE to confirm). This removes your website account (profile, recruitment card,
Battle.net selection, devices and sign-ins), your guild characters and what hangs off them, and your
personal records (battleground reports, achievements, milestones, recap schedule, alerts, availability,
pairing and companion credentials, badge shelves). Your Discord ID and name on guild member rows are replaced
by "Deleted member"; points, loot and raid attendance stay in each guild's history under that name, because other
members' records depend on them. Backups and Discord messages already posted are not changed (see Retention).
You can also ask through the support contact below.

Pause tracking, disable an optional game connection, or quit the companion to
stop its ongoing tracking. Removing locally saved app data leaves your game files
alone and does not automatically erase records already received by a server or
Discord. You can review available records through your Guilded account and guild
tools, subject to your role, and request access, correction or deletion through
the support contact below. We may need to verify the requester's identity and
scope without requesting passwords or government ID in a public channel.

The web availability feature requires an explicit post and sharing confirmation.
Only current members of the selected guild and edition can see it. You can
remove your post; it expires after at most one hour. Addon-observed local presence
is not uploaded to that feature.

### Retention

During normal operation, applied raw addon imports become eligible for cleanup
after 30 days, pending imports after 90 days and error reports after 90 days.
Older gear snapshots are cleaned after 45 days while retaining the latest one.
Availability is hidden immediately at expiry and purged within six hours by
housekeeping. Points, loot and raid records remain part of guild history until
removed through applicable administration or a reviewed request.

The automatic daily database backup retains the latest 14 copies; season backups
retain the latest 24. Separate deployment/recovery archives may be retained for
recovery and incident investigation. A live deletion does not immediately erase
every retained backup or Discord message. Contact support about the scope of a
request; restoration must account for applicable deletion requests. Self-hosted
operators can configure different retention.

### Contact

For privacy, access or deletion requests, contact Kevin Caron / Guilded through
the [Guilded support community](https://discord.gg/YjzFwtP64V). Ask for a private
conversation with the project maintainer and identify the relevant guild or
account. Do not post credentials, pairing codes, identity documents or private
guild exports in public channels. This notice will be updated when data practices
change.

## Français

**Tout est partagé.** À partir de Guilded 8.5, il n'y a aucun réglage de confidentialité ni de partage. Lorsque vous
installez Guilded et reliez vos personnages, tout ce qu'il enregistre à leur sujet est partagé par conception : vos
statistiques, niveaux, équipement et métiers, succès et badges, donjons et scores, résultats de champs de bataille,
résultats de duels, position sur la carte dans l'addon, la course au 60 et les classements, dans votre guilde et
sur les classements et profils publics de guilded.kcaron.top. N'installez pas et ne reliez pas Guilded si vous ne
le souhaitez pas. Le seul contrôle restant est **Supprimer mes données** (ci-dessous).

Une exception : la **carte de la guilde dans l'appli mobile** (décision du propriétaire, 6 novembre 2026). Votre
compagnon envoie où vos propres personnages ont été vus dehors pour la dernière fois (zone, point sur la carte et heure,
gardés 28 jours) et vos propres appels à l'aide (gardés 7 jours). Seuls les membres connectés de votre guilde les voient ;
ils ne sont jamais publics. C'est activé par défaut ; l'interrupteur **Partager ma position** de l'onglet Carte le coupe
et efface toutes vos positions gardées, et les officiers peuvent couper la carte pour le serveur
(`/officer roster map`). Supprimer mes données les efface aussi.

Le bilan hebdomadaire facultatif conserve votre horaire, fuseau, heures de silence,
choix actif/inactif et dernier résultat d'envoi. Un MP Discord est envoyé seulement
après votre accord avec `/automation recap`; `action:off` suspend les prochains.
Ces préférences restent liées à votre fiche membre jusqu'à leur suppression selon
la procédure existante. Une pause ne rappelle pas les messages déjà livrés.
Les préférences visibles figurent dans `/me/data` et son export.


Cette politique concerne Guilded Companion, le site Guilded et le service hébergé
par le projet, exploité par Kevin Caron (Guilded). Une guilde utilisant son propre
serveur a son propre exploitant, à contacter pour son hébergement et sa conservation.

### Données utilisées et finalités

Le compagnon utilise les fichiers de jeu sélectionnés pour la synchronisation.
Les données WoW peuvent comprendre les noms et royaumes des personnages, la guilde
et l'édition, l'effectif et les métiers, les présences en raid, l'équipement et la
préparation, les donjons, le butin et les activités EP/GP. Leur contenu dépend de
l'addon, du mode choisi et de vos permissions. Les exports pris en charge sont
envoyés au service configuré; les classements reçus sont écrits dans le dossier
d'addon sélectionné.

Le suivi Path of Exile 2 facultatif lit les événements reconnus de Client.txt et
transmet les visites de cartes analysées, avec le personnage et la ligue configurés.
Un journal local permet les nouvelles tentatives. Le contenu envoyé n'inclut ni
le journal complet ni ses conversations. La conversion GRM produit une archive
locale à partir du fichier choisi; l'historique privé est exclu sauf activation
explicite. Cette conversion ne téléverse pas elle-même l'archive.

La connexion Discord fournit l'identifiant, le nom d'utilisateur et le nom
d'affichage disponible, via la permission identify. Guilded ne demande pas votre
mot de passe Discord. Les accès et rôles de guilde sont vérifiés. Des témoins
d'authentification maintiennent les sessions web, actuellement jusqu'à 30 jours.
Un témoin `guilded_edition` retient la version de WoW consultée en dernier sur le site
(par exemple `retail`) pendant au plus un an; il ne contient rien d'autre.
Les requêtes techniques et erreurs peuvent contenir les métadonnées de connexion
et le contexte nécessaires au fonctionnement, au dépannage et à la protection.

Si elle est configurée, la connexion Battle.net facultative demande à Blizzard
l'identité du compte et l'accès aux personnages WoW. Un aperçu non confirmé reste
en mémoire sur le serveur pendant dix minutes au maximum. Seuls les personnages
confirmés sont conservés, avec l'identifiant Battle.net et le BattleTag, les noms
et identifiants des personnages et royaumes, la région, l'édition, le choix du
principal du compte et la date de vérification. Cette sélection privée ne publie
pas les alts et ne modifie pas les permissions de guilde. Les jetons Blizzard sont
supprimés après la recherche. Déconnectez Battle.net dans votre compte pour effacer
sa sélection privée; les données de guilde et sauvegardes suivent leurs règles habituelles.

Chaque connexion compagnon possède son propre identifiant d'accès et nom d'appareil.
La page Connexions de votre compte permet de les gérer ou révoquer. Les profils
Windows activés continuent de synchroniser en arrière-plan jusqu'à leur mise en
pause ou la fermeture du compagnon. Mettre un profil en pause n'arrête pas les
autres; quitter le compagnon arrête tous les profils de cet appareil.

Si elle est activée, la mesure d'audience Cloudflare Web Analytics compte les
visites des pages statiques du site : pages vues, sites d'origine, pays et vitesse
des pages, sans témoin, sans empreinte numérique ni suivi entre sites. Les pages
servies par le bot (classements, recrutement, profils, pages de guilde et compagnon)
ne la chargent jamais.

### Conservation locale, destinataires et sécurité

Les profils du compagnon conservent les chemins, préférences et identifiants
d'appairage sur votre PC. L'édition Microsoft Store chiffre sa configuration avec
la protection Windows dans un dossier distinct. Un autre logiciel exécuté sous
votre utilisateur Windows peut néanmoins accéder aux données de cet utilisateur.
Les éditions autonomes existantes peuvent conserver la configuration en JSON;
protégez votre compte Windows et ne partagez pas ces fichiers ni vos codes.

Le serveur Guilded configuré reçoit les données synchronisées. Le service du
projet utilise Oracle, Aiven PostgreSQL et Cloudflare; ces fournisseurs traitent
les données nécessaires à leurs services. Les guildes autonomes choisissent leurs
fournisseurs. Discord gère la connexion et les messages; Microsoft gère le Store
et ses mises à jour. Leurs politiques s'appliquent également. Le traitement peut
avoir lieu hors de votre pays.

La visibilité suit les rôles et permissions. Les profils, badges, statistiques et
classements sont partagés par défaut, sans réglage pour l'éviter; les éléments
privés (codes d'appairage, messages de candidature, identifiants) ne sont jamais
partagés. Les publications Discord ou publiques
peuvent être copiées par leurs lecteurs. Le service hébergé utilise HTTPS,
l'authentification et des contrôles d'accès. Pour un hébergement autonome,
configurez une adresse HTTPS de confiance.

### Choix, accès et suppression

**Supprimer mes données.** Connectez-vous au site Guilded, ouvrez Mes données (`/me/data`) et appuyez sur
**Supprimer mes données** (tapez DELETE pour confirmer). Cela supprime votre compte du site (profil, fiche de
recrutement, sélection Battle.net, appareils et connexions), vos personnages de guilde et leurs dépendances, et vos
données personnelles (rapports JcJ, succès, jalons, bilans, alertes, disponibilité, identifiants d'appairage et du
compagnon, badges). Votre identifiant et votre nom Discord sur les fiches de membre sont remplacés par « Deleted
member »; les points, le butin et les présences de raid restent dans l'historique de chaque guilde sous ce nom, car
les dossiers des autres membres en dépendent. Les sauvegardes et les messages Discord déjà publiés ne sont pas
modifiés (voir Durées de conservation). Vous pouvez aussi la demander au contact ci-dessous.

Suspendez le suivi, désactivez une connexion facultative ou quittez le compagnon
pour arrêter le suivi actif. Supprimer les données locales ne supprime ni vos
fichiers de jeu ni automatiquement les données déjà reçues par un serveur ou
Discord. Consultez vos données via les outils disponibles selon votre rôle, ou
demandez un accès, une correction ou une suppression au contact ci-dessous.
L'identité et le périmètre de la demande peuvent être vérifiés sans demander de
mot de passe ni de pièce d'identité dans un salon public.

La disponibilité web nécessite une annonce et un consentement explicites. Seuls
les membres actuels de la guilde et de l'édition choisies y accèdent. Vous pouvez
la retirer; elle expire au plus tard après une heure. La présence locale observée
par l'addon n'est pas téléversée vers cette fonction.

### Durées de conservation

En fonctionnement normal, les exports bruts appliqués sont nettoyables après
30 jours, les imports en attente et rapports d'erreur après 90 jours. Les anciens
relevés d'équipement sont nettoyés après 45 jours en conservant le plus récent.
La disponibilité est masquée à expiration, puis purgée dans les six heures par
le nettoyage. Les points, butins et raids restent dans l'historique jusqu'à leur
suppression par l'administration applicable ou après examen d'une demande.

La sauvegarde quotidienne conserve les 14 dernières copies; les sauvegardes de
saison, les 24 dernières. Des archives de déploiement/récupération peuvent être
conservées pour la récupération et l'analyse d'incidents. Une suppression active
n'efface pas immédiatement toutes les sauvegardes ni les messages Discord.
Contactez le soutien pour préciser votre demande; une restauration doit tenir
compte des demandes de suppression applicables. L'hébergement autonome peut
prévoir d'autres durées.

### Contact

Contactez Kevin Caron / Guilded via la [communauté de soutien](https://discord.gg/YjzFwtP64V)
et demandez un échange privé avec le responsable du projet. Indiquez la guilde
ou le compte concerné. Ne publiez pas de mot de passe, code d'appairage, pièce
d'identité ou export privé dans les salons publics. Cette politique sera mise
à jour lorsque les pratiques changent.
