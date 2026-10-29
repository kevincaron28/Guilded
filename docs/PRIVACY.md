# Guilded privacy / Confidentialité

Last updated / Dernière mise à jour : 26 October / octobre 2026.

## English

This notice describes Guilded Companion, the Guilded website and the project-hosted
Guilded service operated by Kevin Caron (Guilded). A guild using its own server has
its own operator; contact that operator about its hosting and retention choices.

### Information used and why

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
Public profiles and leaderboards have separate sharing controls. Content posted
to Discord or a public page can be copied by people with access. Guilded uses
authentication, access checks and HTTPS for its hosted service. Configure a
trusted HTTPS endpoint when using a separately hosted server.

### Choices, access and deletion

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

La visibilité suit les rôles et permissions. Les profils et classements publics
disposent de contrôles de partage distincts. Les publications Discord ou publiques
peuvent être copiées par leurs lecteurs. Le service hébergé utilise HTTPS,
l'authentification et des contrôles d'accès. Pour un hébergement autonome,
configurez une adresse HTTPS de confiance.

### Choix, accès et suppression

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
