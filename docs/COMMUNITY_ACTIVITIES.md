# Animation du serveur et remplacement de Carl-bot

Demandé le 1er octobre 2026 : Guilded doit reprendre les rôles de jeux et l'accueil,
puis permettre les soirées gaming, petits jeux Discord, défis dans les jeux et
classements. Loteries gratuites, avec points d'activité, avec or WoW ou monnaie
PoE : les quatre modes sont disponibles dans le code. Version conservée : 5.0.0.

## État et transition Carl-bot

L'inventaire en lecture seule a confirmé les rôles existants **World of Warcraft**,
**Path of Exile 2**, **Diablo IV**, le salon **👋bienvenue** et la présence de
Carl-bot. L'accueil Guilded est actuellement sans destination et sans rôles
configurés. Les réglages internes de Carl-bot ne sont pas accessibles par
l'authentification du bot Guilded; cet inventaire ne prouve donc pas quelles
fonctions Carl-bot exécute encore.

Utiliser `/setup start` → Bienvenue pour choisir le salon existant, la livraison
dans le salon et les trois rôles. `/setup selfroles` peut publier les mêmes
rôles pour les membres déjà présents. Leurs rôles et permissions existants sont
conservés. Ne pas créer trois nouveaux rôles portant les mêmes noms.

Avant de retirer Carl-bot : vérifier l'ajout/retrait de chaque rôle sur un compte
membre, vérifier les salons visibles pour chaque jeu, tester un accueil réel,
puis désactiver les fonctions correspondantes dans Carl-bot. Un accueil en
double indique que les deux systèmes sont encore actifs. Le retrait de Carl-bot
reste une dernière étape après vérification de ses autres fonctions éventuelles.
`scripts/audit-carl-replacement.ts` ne fait que lire et n'ouvre aucune session bot.

## Une saison par jeu

Dans le salon qui recevra les activités, un organisateur utilise :

```text
/community start-season name:Animation octobre game:DISCORD
/community start-season name:WoW octobre game:WOW role:@World of Warcraft
/community start-season name:Ligue PoE game:POE2 role:@Path of Exile 2
```

Le bot renvoie l'identifiant de saison utilisé ci-dessous à la place de `SAISON`.
Une seule saison active par jeu et serveur. Les saisons WoW, PoE, Diablo et
autres jeux exigent un rôle; Discord peut s'adresser à tout le serveur ou à un
rôle. Chaque activité utilise le salon et le rôle de sa saison. Les annonces ne
créent pas de salons et ne mentionnent pas automatiquement des rôles.

Les organisateurs sont les officiers, maîtres de guilde et administrateurs déjà
reconnus par Guilded. Les membres doivent posséder le rôle du jeu et voir le salon.
Un organisateur doit lui aussi voir le salon. La présence et les rôles sont
relus dans Discord à chaque action. Les bots ne peuvent pas participer.

`/community seasons [page:]` liste les saisons accessibles, anciennes comprises.
Les dates sont lues dans le fuseau configuré du serveur, America/Toronto par défaut,
avec les mêmes expressions françaises que les raids : `vendredi 20h`,
`demain 21h`, ou une date explicite. Discord affiche ensuite l'heure locale du lecteur.

## Loteries

```text
/community lottery create season:SAISON title:Tirage de la semaine ends:vendredi 20h mode:FREE prize:Lot surprise
/community lottery create season:SAISON title:Tirage activité ends:vendredi 20h mode:POINTS cost:10 limit:10 prize:Lot surprise
/community lottery create season:SAISON_WOW title:Loterie WoW ends:vendredi 20h mode:WOW_GOLD cost:100 currency:gold realm:Royaume et faction prize:Lot en jeu
/community lottery create season:SAISON_POE title:Loterie PoE ends:vendredi 20h mode:POE_CURRENCY cost:1 currency:Divine Orb realm:Ligue et mode prize:Lot en jeu
```

- Gratuit : exactement un billet par membre, sans paiement.
- Points : débit atomique du portefeuille de cette saison, sans toucher au score.
- Or WoW / monnaie PoE : préciser la monnaie, le royaume/faction ou la ligue/mode
  et le prix d'un billet. Aucun transfert de monnaie de jeu n'est effectué par le bot.
- `winners:` définit de 1 à 20 gagnants distincts; le lot décrit est remis à chacun.
- Une demande de 1 à `limit` billets par membre (maximum 1000); les clics répétés
  réaffichent la demande existante. Les demandes ne sont pas modifiables après création.

Le bouton **Participer** ouvre la demande de billets. Alternative :
`/community lottery join id:LOTERIE quantity:3`.
Pour les paiements en jeu, la demande reste **PENDING**. L'organisateur collecte
le paiement en jeu, puis utilise
`/community lottery confirm id:LOTERIE player:@membre receipt:Détails du paiement`.
Un organisateur ne peut pas confirmer ses propres billets.
`/community lottery payments id:LOTERIE page:1` affiche les demandes, leur coût
et les notes de paiement dans une réponse privée accessible aux organisateurs.

À l'heure annoncée, le bot ferme la loterie et enregistre une seule fois le
tirage, ses gagnants et les billets admissibles. Seuls les billets confirmés
comptent; chaque billet a la même probabilité. Une personne gagne au plus une
fois. S'il manque des participants, le nombre de gagnants est réduit. Aucun
participant admissible donne un résultat vide. Le tirage utilise le générateur
cryptographique de Node. Les résultats persistent après redémarrage.
Une fermeture manuelle avec `/community lottery close` ne peut pas avancer
l'heure de tirage annoncée.

`/community lottery cancel` rembourse automatiquement les points dépensés une
seule fois. Pour les monnaies de jeu, il conserve la liste et les montants à
rembourser dans le résultat enregistré; les organisateurs effectuent ces
remboursements dans le jeu. Le bot n'annonce jamais avoir remboursé du gold ou
des orbes. L'attribution effective du lot est également faite par les organisateurs.

## Soirées gaming

```text
/community gaming create season:SAISON title:Soirée coop starts:vendredi 20h ends:vendredi 23h capacity:8 points:10
```

Boutons **Présent**, **Peut-être**, **Absent**. Une soirée pleine met les prochains
inscrits en liste d'attente; une place libérée promeut automatiquement le premier.
L'annonce est actualisée et un rappel sans mention est publié dans l'heure
précédant le début. Les inscriptions ferment au début; l'activité ferme à sa fin.

Pendant la soirée, `/community gaming attendance id:SOIREE player:@membre`
confirme la présence et donne les points une fois. Un autre organisateur doit
valider la présence d'un organisateur. S'inscrire ne donne aucun point.
`close`, `cancel`, `show` et `list season:` sont disponibles dans le sous-menu.
Cette première version réutilise les vocaux existants et n'en crée pas automatiquement.

## Défis dans les jeux

```text
/community challenge create season:SAISON_WOW title:Objectif coop ends:dimanche 22h points:20 instructions:Objectif et capture requise
```

Un membre soumet un lien HTTPS de capture ou de vidéo avec le bouton
**Soumettre une preuve**, ou `/community challenge submit id:DEFI proof:LIEN`.
Le bot conserve la référence sans télécharger son contenu. Chaque membre a une
soumission par défi; un défi réalisé en groupe demande une preuve par participant.
L'organisateur consulte `/community challenge claims id:DEFI page:1`, puis
`/community challenge review id:DEFI player:@membre decision:APPROVE reason:Vérifié`.
Autres décisions : **REJECT**, **REVERSE**. L'auteur d'une preuve ne peut pas
la valider lui-même. Une validation donne les points une seule fois; une correction
ajoute une écriture inverse et garde l'historique. Si des points corrigés ont déjà
été dépensés, le portefeuille peut devenir négatif et bloque les achats suivants.

Fermer un défi arrête les soumissions et permet encore la revue des preuves
déjà reçues. Pour l'annuler, inverser d'abord ses points déjà approuvés.
Les défis se basent sur une validation humaine; aucune vérification automatique
de compte ou de progression PoE n'est annoncée. Le classement des donjons WoW
existant et ses saisons demeurent indépendants.

## Petits jeux Discord

- `/community dice season:SAISON_DISCORD` : un d100 par membre et par jour dans
  le fuseau du serveur, 5 points de participation, bonus de 10 à partir de 90.
  Les nouvelles tentatives retournent le lancer initial, même après redémarrage.
- `/community quiz season:SAISON_DISCORD title:QUESTION ends:demain 20h points:10 a:REPONSE b:REPONSE c:REPONSE d:REPONSE correct:3`
  crée un quiz à quatre choix; `correct` va de 1 à 4. Un essai par membre,
  points seulement pour la bonne réponse, auteur exclu. La bonne réponse reste
  cachée dans l'annonce jusqu'à la fermeture. `/community close-quiz id:QUIZ`
  ferme aussi un quiz manuellement.

## Classements et portefeuille

`/community leaderboard season:SAISON [page:]` affiche les scores gagnés et les
ex æquo. `/community wallet season:SAISON` montre son score, son solde disponible
et ses dix dernières écritures. Chaque jeu a ses propres points; les GP/EP,
points de donjons et monnaies réelles de jeu ne sont pas modifiés.

Pour archiver : fermer les activités et traiter les preuves en attente, puis
`/community end-season season:SAISON`. Le classement final est figé, l'historique
reste consultable et une nouvelle saison démarre à zéro.

## Livraison et intégrité

Migration additive `20261027090000_community_activities` : tables CommunitySeason,
CommunityActivity, CommunityEntry, CommunityPoint. Aucun champ d'addon, protocole,
point de butin ou secret n'est modifié. Les nouvelles tables font partie des
sauvegardes génériques et sont supprimées par cascade uniquement avec leur guilde.
Aucun nouvel intent Discord n'est demandé.

Un verrou PostgreSQL par serveur sérialise les mutations. Les contraintes uniques
protègent les inscriptions, les écritures et la saison active par jeu. Les points,
billets et publications à réessayer sont écrits dans la même transaction.
La file Discord existante reprend les annonces échouées. La boucle de fermeture
et rappels tourne au démarrage puis chaque minute; la fermeture rattrape les
loteries expirées après une panne. Les messages réutilisent leur identifiant et
un marqueur de pied de page pour limiter les doublons après une interruption.

Les règles d'une activité sont figées après sa création. Pour changer une
monnaie, son prix, les points ou les dates, annuler l'activité et en créer une
nouvelle. Un tirage fermé ne peut pas être relancé. Les preuves et notes de
paiement sont visibles aux organisateurs, pas dans l'annonce publique.

Vérifications : `tests/community.test.ts` (règles, comptabilité, autorisations et
états), commandes/taille Discord, suite complète, TypeScript, ESLint, addon.
`scripts/verify-community-postgres.ts` complète le contrôle PostgreSQL existant
avec achats concurrents, validations et tirages multiples, remboursement,
liste d'attente, rollback de la file, isolation entre guildes et archives;
la restauration vérifie les nouveaux résultats. Ce contrôle doit passer sur
la base locale jetable de CI avant la production.

Déploiement : suivre `docs/V5_0_RELEASE_HANDOFF.md`, CI PostgreSQL/Windows,
préflight du ledger et sauvegarde `pg_dump` vérifiée avant migration, puis le
déploiement existant. Ne pas démarrer un deuxième bot. Les essais Discord réels
doivent ensuite couvrir les trois rôles de jeux, accueil, gratuit, points,
paiement WoW, paiement PoE, tirage sans participants, fermeture après redémarrage,
rappel, liste d'attente, preuve refusée/validée/inversée et archive.
