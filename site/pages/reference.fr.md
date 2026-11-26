<p class="eyebrow">RÉFÉRENCE RAPIDE</p>

# Toutes les commandes Guilded, sur une page.

Des tableaux courts, rien à relire. **Tout le monde** peut utiliser une ligne ainsi marquée ;
**Officiers** demande le rôle Officier ou Maître de guilde ; **Chefs de raid** demande le rôle
Chef de raid ; **Admin** désigne un administrateur du serveur. Discord cache les commandes
d’officier aux membres. Nouveau ? [Commencer ici](/start/).

**Aller à :** [Bot Discord](#bot-discord) · [Addon WoW](#addon-wow) · [Compagnon Windows](#compagnon-windows)

<div class="ref-tools" data-ref-tools>
<label>Recherche <input type="search" data-ref-search placeholder="Commande" aria-label="Chercher une commande"></label>
<div class="ref-chips">
<button type="button" data-role="" aria-pressed="true">Tous</button>
<button type="button" data-role="Tout le monde">Tout le monde</button>
<button type="button" data-role="Officier">Officiers</button>
<button type="button" data-role="Chef de raid">Chefs de raid</button>
<button type="button" data-role="Admin">Admin</button>
</div>
</div>

## Bot Discord

Tapez `/` dans Discord et choisissez la commande. Chaque ligne est une commande ; les mots qui
suivent sont ses sous-commandes. Vos propres vues (profil, statistiques, statut, souhaits) restent privées.
Dans un Discord en français, les commandes des membres ont aussi un nom français : `/personnage` `lier` `profil` `metier` `souhaits` `delier`,
`/artisanat` `demander` `liste` `qui` `mes-demandes` `proposer`, `/classement`, `/aide`, `/rapport` et `/promotion` `statut`.

**Les sept à connaître :** `/help`, `/character link`, `/promotion status`, `/craft request`, `/leaderboard`, `/raid` et `/report bug`.
Le reste est là au besoin.

### Membres

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/help` | Liste les commandes que vous pouvez utiliser | Tout le monde |
| `/character link` | Lier vos personnages : envoyez au bot le nom complet du personnage, ou écrivez-le dans le salon d’invitation (confirmé à la prochaine synchronisation). On peut aussi y coller une ligne `/guilded character` ou un code `/guilded share` | Tout le monde |
| `/character` `add` `unlink` `list` `guild` | Ajouter un personnage à la main ; en délier un ; vos personnages ; choisir votre guilde en jeu | Tout le monde |
| `/character privacy` | Vous cacher ou vous montrer sur le site ; `action:delete` supprime vos données | Tout le monde |
| `/character` `profile` `achievements` `who` | Votre profil et vos succès ; chercher n’importe quel joueur | Tout le monde |
| `/character` `profession` `attunement` `wishlist` `readiness` | Métiers, accès aux raids, liste de souhaits et préparation au raid. L’option du personnage est facultative : votre principal est utilisé | Tout le monde |
| `/promotion` `status` | Ce qu’il vous reste avant le prochain rang | Tout le monde |
| `/leaderboard` `board:` | Cote des donjons (par défaut), records de la guilde, duels JcJ, points de communauté ou EPGP | Tout le monde |
| `/epgp` `balance` `history` `leaderboard` | Vos EP, GP et priorité ; le classement de la guilde | Tout le monde |
| `/loot` `bid` `history` `reserves` | Miser aux enchères ; historique du butin ; réserves | Tout le monde |
| `/craft` `request` `list` `who` `mine` `done` `release` `cancel` | Demander un objet aux artisans ; prendre une demande avec le bouton **Je le fabrique** sur sa publication, puis la marquer terminée | Tout le monde |
| `/craft` `offer` `offers` `withdraw` `notify` `top` `history` | Proposer vos recettes, être mentionné pour les demandes, voir les meilleurs artisans | Tout le monde |
| `/bank` `search` `request` `mine` `cancel` | Voir ce que contient la banque de guilde ; lui demander un objet | Tout le monde |
| `/apply` | Postuler à un core de raid | Tout le monde |
| `/tag` `show` `list` | Afficher un texte enregistré (règles de raid, consommables) | Tout le monde |
| `/community` `hub` `seasons` `leaderboard` `wallet` `dice` `badges` `honors` | Points de communauté, saisons, badges et palmarès | Tout le monde |
| `/community` `lottery` `gaming` `challenge` | Participer aux loteries, soirées de jeu et défis | Tout le monde |
| `/participation` `status` `nominate` `history` | Votre participation sur Discord ; souligner l’aide d’un membre | Tout le monde |
| `/report` `bug` `ping` `stats` | Envoyer un rapport de bogue privé ; vérifier que le bot répond ; activité de la guilde | Tout le monde |
| `/automation` `recap` | Récapitulatif hebdomadaire en message privé (désactivé par défaut) | Tout le monde |
| `/poe` `pair` `status` `runs` `summary` | Journal de cartes de Path of Exile 2 | Tout le monde | <!--poe-->

### Raids

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/raid` `status` `roster` `cancel-signup` | Voir qui vient ; annuler votre inscription (on s’inscrit avec les boutons de l’annonce du raid) | Tout le monde |
| `/raid` `progress` `report` | Progression des boss ; résumé d’un raid terminé | Tout le monde |
| `/raid wcl` `list` | Derniers rapports Warcraft Logs importés | Tout le monde |
| `/raid` `worldbuff` `worldbuffs` `worldbuff-remove` | Annoncer et lister les world buffs | Tout le monde |
| `/lead` `create` `edit` `cancel` `start` `end` | Créer et mener un raid | Chefs de raid |
| `/lead` `attendance` `attendance-voice` `boss` `note` `award-ep` `fill` | Présences, boss tués, notes, EP du raid, combler les places libres | Chefs de raid |
| `/lead` `season` `history` `wcl-report` | Saisons de présence et historique ; importer un rapport Warcraft Logs | Chefs de raid |
| `/lead` `readiness-member` `readiness-raid` | Qui est prêt pour le raid | Chefs de raid |
| `/core` `show` `list` | Voir les cores de raid et leurs rosters | Tout le monde |
| `/core` `setup` `edit` `create` `add` `character` `remove` `rules` `items` `post` `rename` `delete` | Créer et gérer les cores (rosters, banc, règles de points, prix des objets) | Chefs de raid |
| `/team` `show` `list` `sessions` `view` `respond` | Cores hebdomadaires de donjon et de JcJ : roster, séances, votre réponse | Tout le monde |
| `/team` `create` `member` `schedule` `session` `attendance` `lineup` `archive` | Gérer un core hebdomadaire | Chefs d’équipe |
| `/bg` `panel` `join` `leave` `mine` `upcoming` `view` `history` `result` `correct` | Groupes de champ de bataille et vos rapports privés | Tout le monde |
| `/bg` `stats` `duels` `world` | Rapports de participation aux champs de bataille ; classement des duels ; JcJ mondial de la semaine | Tout le monde |
| `/bg` `create` `manage` `setup` | Planifier et gérer les séances de champ de bataille | Chefs |

### Tableau des PUG

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/raid pug browse` | Voir les raids ouverts des autres guildes | Tout le monde |
| `/raid pug share` `board` | Partager un raid publiquement ; choisir le canal des raids d’autres guildes | Officiers |
| `/raid pugs ask` `close` `status` | Demander des PUG aux autres guildes ; fermer la demande | Officiers |
| `/raid pugs join` `leave` `unblock` | Rejoindre ou quitter le tableau (facultatif) ; débloquer une guilde | Officiers |

### Donjons

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/dungeon` `leaderboard` `season` `records` `player` `history` | Cote de saison, meilleurs temps, parcours d’un joueur | Tout le monde |
| `/dungeon` `archive` `hall-of-fame` `rules` `catalog` `together` | Saisons passées, règles de pointage, liste des donjons, objectif d’équipe de la semaine | Tout le monde |
| `/dungeon` `group` `guide` `alerts` `watch` | Former un groupe avec un canal vocal ; être prévenu des groupes qui vous conviennent | Tout le monde |
| `/officer dungeon` `invalidate` `award` `audit` `config` `flagged` `sync` `goal` `announce` | Corriger une partie, ajuster les points de guilde, lire l’historique ; examiner les parties douteuses et les synchronisations bloquées ; l’objectif commun de la semaine et les annonces de records | Officiers |
| `/organize dungeon-seasons preview` | Voir les saisons de donjon en cours et à venir | Organisateurs |

### Officiers et configuration

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/setup` `start` | Configuration guidée : langue, rôles, canaux. Peut être relancée sans risque | Admin |
| `/setup` `system` `testraid` `selfroles` | État de la synchro et relances ; faux raid de test ; boutons de rôles | Officiers |
| `/setup` `reset` `uninstall` | Effacer les canaux et les données de Guilded | Admin |
| `/config` `view` `set` `welcome` `farewell` `roles` `channel` `timezone` `weekly-report` … | Réglages du serveur : accueil, rôles, fuseau horaire, rapports, mode de butin, import automatique | Officiers |
| `/lead epgp` `award-ep` `award-gp` `decay` `reverse` | Donner, réduire ou annuler des EP et GP | Officiers |
| `/lead loot` `auction` `award` `close` `priority` | Mener les enchères et attribuer le butin | Officiers |
| `/officer character` `unclaimed` `link` `move` `autolink` `claimdm` | Lier les personnages signalés à des membres Discord ; en déplacer un avec son historique | Officiers |
| `/officer roster` `gaps` `ignore` `nicknames` `map` `gamelink` | Membres et personnages non liés ; synchronisation des surnoms, carte des coéquipiers sur le téléphone, liaison par la discussion du jeu | Officiers |
| `/officer promotion` `list` `rule` | Qui est prêt pour le prochain rang ; la règle de promotion | Officiers |
| `/officer stats` `feed` `trend` `toggle` `cards` `bank` | Flux pour les feuilles de calcul, évolution des membres, statistiques quotidiennes et réglages liés | Officiers |
| `/officer export` | Télécharger classements, EPGP, butin, présences ou roster en CSV | Officiers |
| `/setup import` `upload` `apply` `held` | Prévisualiser et appliquer les données de l’addon | Officiers |
| `/mod` `warn` `timeout` `kick` `ban` `history` | Modération | Officiers |
| `/mod` `application` `dni` | Examiner les candidatures ; liste « ne pas inviter » | Officiers |
| `/mod` `faq` | Le canal de réponses : rédiger les réponses du bot | Officiers |
| `/mod invites` `list` `extra` `record` `settings` `tidy` `questions` `post` | La file des invitations de guilde et ses réglages | Officiers |
| `/mod` `page` `recruit` `leaderboard` `rankroles` | Page publique de la guilde, recrutement, classements publics, rôles de rang | Officiers |
| `/officer reports` `inactive` `guild` `games` `remind` `auto-remind` `posts` | Membres inactifs ; santé de la guilde ; rappels de jeu ; bilan quotidien et records de la semaine | Officiers |
| `/organize` | Saisons communautaires, quiz, palmarès, loteries, soirées de jeu, défis | Organisateurs |
| `/organize poll` `create` `close` `weekly` `news` | Sondages, question de la semaine et nouvelles | Officiers |
| `/setup participation` `settings` `channels` `claims` `review` `reverse` | Réglages de participation, nominations et récompenses | Officiers |
| `/setup guild` `add` `channel` `roles` | Ajouter une guilde en jeu ; lier un canal ; régler ses rôles | Officiers |
| `/poe setup` | Activer ou suspendre le suivi PoE2 | Officiers | <!--poe-->
| `/automation` `question` `vacancies` | Question hebdomadaire automatique et correspondances de groupes de donjon | Officiers |
| `/setup tags` `set` `delete` | Créer ou supprimer des textes enregistrés | Officiers |
| `/config craft` `offers` `posts` `orders` `permissions` `notify` | Réglages et permissions du tableau d’artisanat | Officiers |
| `/officer bank` `list` `handle` `stock` `settings` | Demandes à la banque, minimums de stock et réglages | Officiers |

### Propriétaire

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded-season` `status` `next` `rules` `cancel` | Planifier la saison de donjon commune et ses règles | Propriétaire |
| `/guilded-console` `setup` `refresh` | Le tableau privé du propriétaire | Propriétaire |

Ces deux commandes n’existent que dans le serveur du propriétaire du bot.

## Addon WoW

Tapez `/guilded` (ou `/gd`) en jeu. `/guilded` seul ouvre la fenêtre ; `/guilded help` liste les commandes principales ; `/guilded help all` liste tout.
Les lignes « Officiers » demandent le rang d’officier dans votre guilde WoW.

### Au quotidien

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded` | Ouvrir la fenêtre Guilded | Tout le monde |
| `/guilded help` | Les commandes principales (`/guilded help all` liste toutes celles que vous pouvez utiliser) | Tout le monde |
| `/guilded standings [joueur]` | Les classements, ou ceux d’un joueur | Tout le monde |
| `/guilded history [joueur]` | Votre historique d’EP/GP et de butin | Tout le monde |
| `/guilded share` | Un seul collage avec votre personnage, équipement et accès (Discord : `/character link`) | Tout le monde |
| `/guilded character` | Une ligne pour lier ce personnage dans Discord | Tout le monde |
| `/guilded sync` | Comment envoyer vos données à Discord maintenant | Tout le monde |
| `/guilded attune <clé>` | Noter votre propre accès à un raid | Tout le monde |
| `/guilded inspect` · `enchants` · `slots` | Vérification d’équipement ; règles d’enchantements et d’emplacements vides | Tout le monde |
| `/guilded score [joueur\|top]` | Cotes de donjon à partir des parties enregistrées | Tout le monde |
| `/guilded pug` | Parcourir les raids ouverts et copier le lien Discord de l’hôte | Tout le monde |
| `/guilded reserve <objet>` | Réserver un objet | Tout le monde |
| `/guilded recipes who <objet>` · `cooldowns` | Qui peut le fabriquer ; temps de recharge des métiers | Tout le monde |
| `/guilded calendar` | Le calendrier de guilde, partagé avec Discord | Tout le monde |
| `/guilded sheet standings\|loot\|attendance\|raids\|dungeons` | Copier un tableau pour un chiffrier | Tout le monde |
| `/guilded peers` · `diag` · `version` | Qui utilise quelle version de l’addon ; diagnostic | Tout le monde |

### Parties facultatives et réglages

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded modules` | Activer ou désactiver les parties facultatives (les officiers peuvent le faire pour toute la guilde) | Tout le monde |
| `/guilded options` | La page de Guilded dans les options du jeu | Tout le monde |
| `/guilded setup` | La fenêtre de première configuration : companion, onglet de discussion Guilded, options (`setup mode` : en jeu seulement ou connexion Discord facultative) | Tout le monde |
| `/guilded minimap show\|hide\|reset` | Le bouton de la minicarte | Tout le monde |
| `/guilded chat tab\|off` · `chattags on\|off` | Onglet de discussion à part ; afficher le nom du principal d’un reroll | Tout le monde |
| `/guilded digest` · `map` · `gbank` · `guildlog` | Changements depuis la dernière connexion ; guildmates sur la carte ; banque de guilde ; journal de guilde | Tout le monde |
| `/guilded dungeon status\|results\|start\|complete\|abandon\|check` | Enregistrer et vérifier les parties de donjon | Tout le monde |
| `/guilded bgcapture` | État de la capture de vos résultats de champ de bataille (toujours active si prise en charge) | Tout le monde |
| `/guilded pugcheck on\|off\|now\|last` | Niveau d’objet et enchantements des joueurs hors guilde de votre groupe | Tout le monde |
| `/guilded backup` · `restore` | Copier les données de la guilde en un code, ou les remettre | Tout le monde |
| `/guilded perf` | Mesurer le temps de travail de Guilded | Tout le monde |

### Officiers et chefs de raid

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded start [titre]` · `end` · `summary` | Commencer et terminer un raid ; copier ce qui a été enregistré | Officiers |
| `/guilded attendance <nom>\|group\|seen` · `boss <nom>` · `note <texte>` | Présences, boss tués, notes | Officiers |
| `/guilded award` · `gp` · `deduct` · `gpdeduct` · `void` · `undo` | Donner ou retirer des EP et GP ; annuler la dernière entrée | Officiers |
| `/guilded loot <nom> <objet> [coût]` | Enregistrer un butin | Officiers |
| `/guilded drop <lien d’objet>` · `drops` · `price <objet> <GP>` | Lancer un objet selon la règle du core ; lister les butins ; fixer un prix en GP | Officiers |
| `/guilded bid` · `council` · `lootroll` | Mises en GP ; conseil de butin ; jets de réserves | Officiers |
| `/guilded core [nom]` · `core roster` | Choisir le core de raid ; qui du core est dans votre groupe | Officiers (roster : Tout le monde) |
| `/guilded localcore` · `setup guild` | Cores de raid et règles de butin sans Discord | Officiers |
| `/guilded ready` · `consumes` | Qui est prêt dans votre groupe ; qui manque de flacon ou de nourriture | Officiers et chefs de groupe |
| `/guilded export` · `import softres\|tmb\|history` | Exporter ; importer réserves, TMB ou historique de butin | Officiers |
| `/guilded invite raid\|missing` · `autoinvite` | Inviter les inscrits au raid ; une ligne /ginvite pour ceux qui chuchotent | Officiers |
| `/guilded recruit` | Liste de recrues potentielles | Officiers |
| `/guilded officer list\|add\|remove\|rank` | Qui compte comme officier | Officiers |
| `/guilded ledgersync` · `bridge` · `rosteradmin` · `sim` | Partager les EP/GP entre officiers ; pont du compagnon ; outils de roster ; raid de test | Officiers |

### Onglets de la fenêtre principale

| Onglet | Ce qu’il montre | Qui |
| --- | --- | --- |
| Home · My character | Ce qui se passe, vos données et la vérification de votre équipement | Tout le monde |
| Guild overview · Standings · Duels | Classes et niveaux, classements, classement des duels | Tout le monde |
| Layer invite · Dungeons · Crafting | Demander un autre layer ; vos parties et les classements de donjons ; trouver un artisan et demander un objet | Tout le monde |
| Open raids · Raid sign-up · Ready · Reserves | Raids avec de la place, inscription, vérifications de soirée de raid, réservations | Tout le monde (Ready : officiers et chefs de groupe) |
| Raid · Loot · Council | Mener un raid ; mises et réponses du conseil (affichés selon le système de butin du core) | Officiers |
| Gear · Admin · Calendar · Local guild · Roster · Tools | Niveau d’objet par membre, gestion des EP/GP, calendrier de guilde, configuration sans Discord, outils de roster, journal et imports | Officiers |
| Settings | Activer ou désactiver des parties, diagnostic | Tout le monde |

### Addons compagnons

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/gdungeons` (`/gdg`) | L’addon distinct Guilded Dungeons : état, résultats, panneau de cote | Tout le monde |
| `/ggames` | L’addon distinct Guilded Games : jeux de groupe, hôte seulement | Tout le monde |

## Compagnon Windows

Une petite application Windows gratuite. Facultative pour l’addon, requise pour les fonctions
Discord et le site. Toutes les étapes : [Application compagnon](https://guildedwow.com/companion/).

| Quoi | Détail |
| --- | --- |
| Ce qu’il fait | Envoie les données enregistrées de votre addon à Discord et au site, et rapporte les classements dans le jeu |
| Où l’obtenir | [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (recommandé, mise à jour automatique) ou le [téléchargement direct](https://guildedwow.com/downloads/Guilded.Companion.Setup.exe) (solution de rechange non signée) |
| Plateforme | Windows seulement. Pas de version Mac, Linux ni navigateur |
| Première ouverture | Rien à configurer : il trouve tout seul votre dossier WoW et le Discord de votre guilde. **Se connecter avec Discord** est facultatif et confirme vos personnages |
| Après avoir joué | `/reload` dans WoW et le compagnon synchronise |
| Qui devrait l’utiliser | Chaque membre qui veut les fonctions Discord ; au moins un officier par guilde |
