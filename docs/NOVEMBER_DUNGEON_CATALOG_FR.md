# Catalogue de donjons pour le 4 novembre — préparation

Préparé le 15 octobre 2026. Brouillon distinct des règles de saison : 35 entrées, regroupées en 28 familles d’instances. Ce comptage distingue les ailes et n’est pas un total officiel garanti. Les noms anglais servent de références; ce ne sont pas des noms de boss à utiliser pour la détection.

Les 35 entrées sont prévues pour la participation après validation. Parmi elles, 10 sont proposées comme candidates à la cote, les 25 autres pour la participation seulement. Aucun parcours de novembre n’est activé. Proposition de compétition : personnages niveau 60, huit meilleurs parcours. Ce choix reste à valider; il ne remplace pas le Best 8 bêta niveau 30. Aucun temps cible, niveau admissible ou difficulté n’est configuré. Le 4 novembre est une date de préparation, sans heure UTC ni activation programmée.

| Donjon / aile | Plan de novembre | Preuve de présence | Référence bêta |
| --- | --- | --- | --- |
| Ragefire Chasm | Participation | Instance citée en bêta | 389 |
| The Hall of Thanes | Participation | Instance citée en bêta | 3065 |
| Ruins of Lordaeron | Participation | Instance citée en bêta | 2999 |
| Wailing Caverns | Participation | Instance citée en bêta | 43 |
| The Deadmines | Participation | Instance citée en bêta | 36 |
| Shadowfang Keep | Participation | Instance citée en bêta | 33 |
| Blackfathom Deeps | Participation | Instance citée en bêta | 48 |
| The Stockade | Participation | Instance citée en bêta | 34 |
| Excavation Site: Wetlands | Participation | Instance citée en bêta | 2998 |
| City of Dalaran | Participation | Instance citée en bêta | 2959 |
| Gnomeregan | Participation | Instance citée en bêta | 90 |
| Razorfen Kraul | Participation | Instance citée en bêta | 47 |
| Scarlet Monastery: Graveyard | Participation | Instance citée en bêta | 189:graveyard |
| Scarlet Monastery: Library | Participation | Instance citée en bêta | 189:library |
| The Drowned City | Participation | Nouveau donjon annoncé | — |
| Scarlet Monastery: Armory | Participation | Instance citée en bêta | — |
| Razorfen Downs | Participation | Instance citée en bêta | 129 |
| Scarlet Monastery: Cathedral | Participation | Instance citée en bêta | — |
| Krol'dok Stronghold | Participation | Nouveau donjon annoncé | — |
| Uldaman | Participation | Instance citée en bêta | 70 |
| Zul'Farrak | Participation | Catalogue communautaire | — |
| Maraudon | Participation | Catalogue communautaire | — |
| Alcaz Prison | Participation | Nouveau donjon annoncé | — |
| Temple of Atal'Hakkar (Sunken Temple) | Participation | Catalogue communautaire | — |
| Blackrock Depths | Participation + candidat cote | Catalogue communautaire | — |
| Dire Maul: East | Participation + candidat cote | Catalogue communautaire | — |
| Blackmaw Hold | Participation + candidat cote | Nouveau donjon annoncé | — |
| Lower Blackrock Spire | Participation + candidat cote | Catalogue communautaire | — |
| Dire Maul: North | Participation + candidat cote | Catalogue communautaire | — |
| Dire Maul: West | Participation + candidat cote | Catalogue communautaire | — |
| Scholomance | Participation + candidat cote | Catalogue communautaire | — |
| Shaper's Terrace | Participation + candidat cote | Nouveau donjon annoncé | — |
| Stratholme: Main Gate | Participation + candidat cote | Catalogue communautaire | — |
| Stratholme: Service Gate | Participation + candidat cote | Catalogue communautaire | — |
| Upper Blackrock Spire | Participation | Catalogue communautaire | — |

## Validation avant toute activation

- Confirmer l’accès dans le client de lancement, avec date, build et preuve de run.
- Relever le vrai map ID, la difficulté, les niveaux observés et la taille du groupe. Les slugs du JSON ne sont pas des identifiants de jeu. Les références bêta ne prouvent pas la compatibilité au lancement.
- Valider départ, présence, boss final et remplacements. Distinguer chaque aile par des preuves fiables. Le code actuel ne distingue automatiquement que les ailes de Scarlet pour la cote; Dire Maul, Stratholme et Blackrock Spire nécessitent un travail spécifique. Ne jamais donner deux récompenses pour une seule fin ambiguë.
- Définir le parcours complet de Blackrock Depths et de chaque aile. Ne pas comparer une aile, une visite partielle et un parcours complet comme un même run.
- Mesurer les candidats avec plusieurs groupes comparables; fixer les cibles et niveaux pour la nouvelle saison seulement. Ne pas reprendre automatiquement les chronos ou accès temporaires de la bêta.
- Confirmer la liste et l’heure de début, puis utiliser une rotation sauvegardée et transactionnelle. Aucun script de ce dossier n’active une saison.

Les 10 candidats favorisent une compétition à niveau fixe accessible aux arrivants tardifs. Dire Maul et Stratholme ont plusieurs ailes : revoir leur poids et leur indépendance avant de figer la sélection. Upper Blackrock Spire reste en participation seulement en attendant la vérification de la taille du groupe et du format. Les points de participation, compteurs hebdomadaires, gestion des helpers et bandes de niveaux de novembre restent à figer séparément.

## Conservation et outils

Le catalogue ne modifie ni le preset bêta, ni les saisons en base, ni les scores, transactions ou archives. Tous les contrôles de lancement sont en attente. Ne pas importer ce JSON comme règles de saison. Aucun nouveau boss ID, map ID, difficulté ou chrono n’a été inventé.

`/dungeon catalog` affiche cette préparation en anglais/français après déploiement et enregistrement de la commande. `/dungeon rules` continue d’expliquer la phase active. Aucun message Discord n’est publié par la génération locale.

Régénérer : `npx tsx scripts/prepare-november-dungeon-catalog.ts`. Vérifier sans écrire : ajouter `--check`. Le JSON est dans [data/november-dungeon-catalog.json](data/november-dungeon-catalog.json).

## Sources et incertitudes

La liste officielle annonce neuf nouveaux donjons; les notes bêta établissent la présence des premières instances. Le catalogue communautaire complète les anciens donjons et les ailes. Une instance citée n’établit pas la validation de chaque aile. Les plages publiées diffèrent entre sources; elles ne sont donc pas copiées dans les règles proposées. Aucun run de lancement n’a encore été vérifié.

- [Blizzard: nine new dungeons (September 15)](https://us.forums.blizzard.com/en/wow/t/krol%E2%80%99dok-stronghold/2349672)
- [Blizzard: beta updates (October 1 / October 8)](https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1)
- [Icy Veins: dungeon/wing roster (October 7)](https://www.icy-veins.com/wow-forever/dungeons-overview/)
