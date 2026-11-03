<p class="eyebrow">RÉFÉRENCE RAPIDE</p>

# Toutes les commandes Guilded, sur une page.

Des tableaux courts, rien à relire. **Tout le monde** peut utiliser une ligne ainsi marquée ;
**Officiers** demande le rôle Officier ou Maître de guilde ; **Chefs de raid** demande le rôle
Chef de raid ; **Admin** désigne un administrateur du serveur. Discord cache les commandes
d’officier aux membres. Nouveau ? [Commencer ici](/start/).

**Aller à :** [Bot Discord](#bot-discord) · [Addon WoW](#addon-wow) · [Compagnon Windows](#compagnon-windows)

## Bot Discord

Tapez `/` dans Discord et choisissez la commande. Chaque ligne est une commande ; les mots qui
suivent sont ses sous-commandes.

### Membres

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/help` | Liste les commandes que vous pouvez utiliser | Tout le monde |
| `/character` `pair` `add` `import` `claim` `unlink` `list` | Lier votre personnage principal et vos rerolls à votre compte Discord | Tout le monde |
| `/character` `profile` `achievements` `who` | Votre profil et vos succès ; chercher n’importe quel joueur | Tout le monde |
| `/character` `profession` `attunement` `wishlist` `readiness` | Métiers, accès aux raids, liste de souhaits et préparation au raid | Tout le monde |
| `/epgp` `balance` `history` `leaderboard` | Vos EP, GP et priorité ; le classement de la guilde | Tout le monde |
| `/loot` `bid` `history` `reserves` | Miser aux enchères ; historique du butin ; réserves | Tout le monde |
| `/craft` `request` `list` `who` `mine` `claim` `done` `release` `cancel` | Demander un objet aux artisans, ou prendre des demandes | Tout le monde |
| `/bank` `request` `mine` `cancel` | Demander un objet à la banque de guilde | Tout le monde |
| `/apply` | Postuler à un core de raid | Tout le monde |
| `/tag` `show` `list` | Afficher un texte enregistré (règles de raid, consommables) | Tout le monde |
| `/community` `hub` `seasons` `leaderboard` `wallet` `dice` `badges` `honors` | Points d’activité, saisons, badges et palmarès | Tout le monde |
| `/community` `lottery` `gaming` `challenge` | Participer aux loteries, soirées de jeu et défis | Tout le monde |
| `/participation` `status` `nominate` `history` | Votre participation sur Discord ; souligner l’aide d’un membre | Tout le monde |
| `/report` `bug` `ping` `stats` | Envoyer un rapport de bogue privé ; vérifier que le bot répond ; activité de la guilde | Tout le monde |
| `/automation` `recap` | Récapitulatif hebdomadaire en message privé (désactivé par défaut) | Tout le monde |
| `/wow` `list` `use` | Choisir la guilde en jeu utilisée par vos commandes | Tout le monde |
| `/poe` `pair` `status` `runs` `summary` | Journal de cartes de Path of Exile 2 | Tout le monde |

### Raids

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/raid` `signup` `cancel-signup` `status` `roster` | S’inscrire à un raid ; voir qui vient | Tout le monde |
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
| `/bg` `panel` `join` `leave` `mine` `upcoming` `view` `history` `privacy` | Groupes de champ de bataille et vos rapports privés | Tout le monde |
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
| `/dungeon` `archive` `hall-of-fame` `rules` `catalog` `keystones` `together` | Saisons passées, règles de pointage, liste des donjons, clés Retail, objectif d’équipe de la semaine | Tout le monde |
| `/dungeon` `group` `alerts` `watch` | Former un groupe avec un canal vocal ; être prévenu des groupes qui vous conviennent | Tout le monde |
| `/officer dungeon` `invalidate` `award` `audit` `config` | Corriger une partie, ajuster les points de guilde, lire l’historique | Officiers |
| `/organize dungeon-seasons preview` | Voir les saisons de donjon en cours et à venir | Organisateurs |

### Officiers et configuration

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/setup` `start` | Configuration guidée : langue, rôles, canaux. Peut être relancée sans risque | Admin |
| `/setup` `system` `testraid` `selfroles` | État de la synchro et relances ; faux raid de test ; boutons de rôles | Officiers |
| `/setup` `reset` `uninstall` | Effacer les canaux et les données de Guilded | Admin |
| `/config` `view` `set` `welcome` `farewell` `roles` `channel` `timezone` `weekly-report` … | Réglages du serveur : accueil, rôles, fuseau horaire, rapports, mode de butin, import automatique | Officiers |
| `/officer epgp` `award-ep` `award-gp` `decay` `reverse` | Donner, réduire ou annuler des EP et GP | Officiers |
| `/officer loot` `auction` `award` `close` `priority` | Mener les enchères et attribuer le butin | Officiers |
| `/officer character` `unclaimed` `link` `autolink` | Lier les personnages signalés à des membres Discord | Officiers |
| `/officer export` | Télécharger classements, EPGP, butin, présences ou roster en CSV | Officiers |
| `/import` `upload` `apply` `held` | Prévisualiser et appliquer les données de l’addon | Officiers |
| `/mod` `warn` `timeout` `kick` `ban` `history` | Modération | Officiers |
| `/mod` `application` `dni` | Examiner les candidatures ; liste « ne pas inviter » | Officiers |
| `/mod` `faq` | Le canal de réponses : rédiger les réponses du bot | Officiers |
| `/mod` `page` `recruit` `leaderboard` `rankroles` | Page publique de la guilde, recrutement, classements publics, rôles de rang | Officiers |
| `/report` `inactive` `guild` | Membres inactifs ; santé de la guilde | Officiers |
| `/organize` | Saisons communautaires, quiz, palmarès, loteries, soirées de jeu, défis | Organisateurs |
| `/poll` `create` `close` `weekly` | Sondages et question de la semaine | Officiers |
| `/events` `board` `reminders` `disable` `status` `refresh` | Tableau des événements à venir et rappels facultatifs | Officiers |
| `/participation` `settings` `channels` `claims` `review` `reverse` | Réglages de participation, nominations et récompenses | Officiers |
| `/wow` `add` `channel` `roles` | Ajouter une guilde en jeu ; lier un canal ; régler ses rôles | Officiers |
| `/poe setup` | Activer ou suspendre le suivi PoE2 | Officiers |
| `/automation` `question` `vacancies` | Question hebdomadaire automatique et correspondances de groupes de donjon | Officiers |
| `/tag` `set` `delete` | Créer ou supprimer des textes enregistrés | Officiers |
| `/craft permissions` · `/bank` `list` `handle` | Permissions du tableau d’artisanat ; traiter les demandes à la banque | Officiers |

### Propriétaire

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded-season` `status` `next` `rules` `cancel` | Planifier la saison de donjon commune et ses règles | Propriétaire |
| `/guilded-console` `setup` `refresh` | Le tableau privé du propriétaire | Propriétaire |

Ces deux commandes n’existent que dans le serveur du propriétaire du bot.

## Addon WoW

Tapez `/guilded` (ou `/gd`) en jeu. `/guilded` seul ouvre la fenêtre ; `/guilded help` liste tout.
Les lignes « Officiers » demandent le rang d’officier dans votre guilde WoW.

### Au quotidien

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/guilded` | Ouvrir la fenêtre Guilded | Tout le monde |
| `/guilded help` | Lister les commandes que vous pouvez utiliser | Tout le monde |
| `/guilded standings [joueur]` | Les classements, ou ceux d’un joueur | Tout le monde |
| `/guilded history [joueur]` | Votre historique d’EP/GP et de butin | Tout le monde |
| `/guilded share` | Un seul collage avec votre personnage, équipement et accès (Discord : `/character import`) | Tout le monde |
| `/guilded character` | Une ligne pour lier ce personnage dans Discord | Tout le monde |
| `/guilded verify <code>` | Lier tous vos personnages à Discord d’un coup (Discord : `/character pair`) | Tout le monde |
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
| `/guilded setup` | Choisir en jeu seulement ou la connexion Discord facultative | Tout le monde |
| `/guilded minimap show\|hide\|reset` | Le bouton de la minicarte | Tout le monde |
| `/guilded chat tab\|off` · `chattags on\|off` | Onglet de discussion à part ; afficher le nom du principal d’un reroll | Tout le monde |
| `/guilded digest` · `map` · `gbank` · `guildlog` | Changements depuis la dernière connexion ; guildmates sur la carte ; banque de guilde ; journal de guilde | Tout le monde |
| `/guilded dungeon status\|results\|start\|complete\|abandon\|check` | Enregistrer et vérifier les parties de donjon | Tout le monde |
| `/guilded bgcapture on\|off` | Capture de vos propres résultats de champ de bataille | Tout le monde |
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
| `/guilded invite raid\|missing` · `autoinvite` | Inviter les inscrits au raid ; inviter ceux qui chuchotent | Officiers |
| `/guilded recruit` · `welcome` | Liste de recrues potentielles ; chuchoter aux nouveaux membres | Officiers |
| `/guilded officer list\|add\|remove\|rank` | Qui compte comme officier | Officiers |
| `/guilded ledgersync` · `bridge` · `rosteradmin` · `sim` | Partager les EP/GP entre officiers ; pont du compagnon ; outils de roster ; raid de test | Officiers |

### Onglets de la fenêtre principale

| Onglet | Ce qu’il montre | Qui |
| --- | --- | --- |
| Home · My character · Open raids | Ce qui se passe, votre équipement, les raids avec de la place | Tout le monde |
| Standings · Crafting · Availability | Classements, recettes, qui est en ligne | Tout le monde |
| Ready · Reserves · Loot · Council | Vérifications de soirée de raid, réserves, mises et réponses du conseil | Chefs / Tout le monde / Officiers |
| Raid · Administration · Gear | Mener un raid, donner des EP/GP, niveau d’objet par membre | Officiers |
| Calendar · Local guild · Roster admin · Officer tools | Calendrier, configuration sans Discord, outils de roster, journal et imports | Officiers |
| Settings | Activer ou désactiver des parties, diagnostic | Tout le monde |

### Addons compagnons

| Commande | Ce qu’elle fait | Qui |
| --- | --- | --- |
| `/gdungeons` (`/gdg`) | L’addon distinct Guilded Dungeons : état, résultats, panneau de cote | Tout le monde |
| `/ggames` | L’addon distinct Guilded Games : jeux de groupe, hôte seulement | Tout le monde |

## Compagnon Windows

Une petite application Windows gratuite. Facultative pour l’addon, requise pour les fonctions
Discord et le site. Toutes les étapes : [Application compagnon](/companion/).

| Quoi | Détail |
| --- | --- |
| Ce qu’il fait | Envoie les données enregistrées de votre addon à Discord et au site, et rapporte les classements dans le jeu |
| Où l’obtenir | [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (recommandé, mise à jour automatique) ou [GitHub](https://github.com/kevincaron28/Guilded/releases/latest) (solution de rechange non signée) |
| Plateforme | Windows seulement. Pas de version Mac, Linux ni navigateur |
| Première ouverture | Choisir **Connexion avec Discord**, sélectionner votre serveur (ou les classements publics seulement), puis vos données |
| Après avoir joué | `/reload` dans WoW et le compagnon synchronise |
| Qui devrait l’utiliser | Chaque membre qui veut les fonctions Discord ; au moins un officier par guilde |
