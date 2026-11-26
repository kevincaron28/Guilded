# Google Play graphics: what is needed, exact sizes / Images pour Google Play : ce qu'il faut, tailles exactes

Sizes are Play Console's limits for the Main store listing
([Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)).
Les tailles sont les limites de Play Console pour la fiche principale.

## English

| Asset | Play's rule | Ready in this folder |
| --- | --- | --- |
| App icon | **512 × 512** px, 32-bit PNG with alpha, 1,024 KB at most | [`icon-512.png`](icon-512.png) |
| Feature graphic | **1,024 × 500** px, JPEG or 24-bit PNG, no alpha | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) |
| Phone screenshots | **2 to 8**, JPEG or 24-bit PNG, no alpha, each side between **320 and 3,840** px, the long side at most twice the short side. Ours: **1,080 × 1,920** px (9:16) | eight files in [`screenshots/`](screenshots/) |
| 7-inch tablet screenshots | optional; up to 8, same format, 320 to 3,840 px. Suggested if wanted: 1,200 × 1,920 px | none (not needed for a closed test) |
| 10-inch tablet screenshots | optional; up to 8, each side between 1,080 and 7,680 px. Suggested if wanted: 1,600 × 2,560 px | none (not needed for a closed test) |
| Promo video | optional YouTube link | none |

Phone screenshots, in upload order. Each one is 1,080 × 1,920 px, with made-up names only:

| # | File | Must show |
| --- | --- | --- |
| 1 | `01-guild-activity.png` | Guild tab, activity: joins, rank changes, bank gifts and raid boss kills |
| 2 | `02-guild-raids.png` | Guild tab, raids: the next raid, who signed up and the member's answer |
| 3 | `03-crafting.png` | Guild tab, crafting: an item search and who can make it |
| 4 | `04-character.png` | Me tab: one character's dungeon ranks, recent runs and duel record |
| 5 | `05-guild-map.png` | Guild tab, map: the heat map and one call-for-help pin |
| 6 | `06-alerts.png` | Alerts tab: the push switches (raids, calls for help, raid spots) |
| 7 | `07-stats.png` | Stats tab: this week's summary and the public leaderboards |
| 8 | `08-guild-roster.png` | Guild tab, roster: characters and ranks |

Taken on 26 November 2026 from version 0.6.0. None of the eight shows Guilded Clash, a real player name or game artwork.
The French listing has its own set, with the same file names, in `screenshots/fr-CA/`.

Retake them only if a screen changes. How: `mobile/store/capture-screenshots.mjs` (the comment at its top gives the
steps). It signs the web build in to a local mock server and blocks every other host. Rules for a retake: made-up data
only, no real names, no sign-in codes, no game logo or artwork, the same 1,080 × 1,920 size, and build the web export
**without** `EXPO_PUBLIC_GUILDED_CLASH`.

## Français

| Élément | Règle de Play | Prêt dans ce dossier |
| --- | --- | --- |
| Icône de l'appli | **512 × 512** px, PNG 32 bits avec transparence, 1 024 Ko au plus | [`icon-512.png`](icon-512.png) |
| Image de présentation | **1 024 × 500** px, JPEG ou PNG 24 bits, sans transparence | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) |
| Captures pour téléphone | **2 à 8**, JPEG ou PNG 24 bits, sans transparence, chaque côté entre **320 et 3 840** px, le grand côté au plus deux fois le petit. Les nôtres : **1 080 × 1 920** px (9:16) | huit fichiers dans [`screenshots/fr-CA/`](screenshots/fr-CA/) |
| Captures pour tablette 7 po | facultatif; jusqu'à 8, même format, 320 à 3 840 px. Suggestion : 1 200 × 1 920 px | aucune (inutile pour un test fermé) |
| Captures pour tablette 10 po | facultatif; jusqu'à 8, chaque côté entre 1 080 et 7 680 px. Suggestion : 1 600 × 2 560 px | aucune (inutile pour un test fermé) |
| Vidéo promotionnelle | lien YouTube facultatif | aucune |

Captures pour téléphone, dans l'ordre de téléversement. Chacune fait 1 080 × 1 920 px, avec des noms inventés
seulement :

| # | Fichier | Doit montrer |
| --- | --- | --- |
| 1 | `01-guild-activity.png` | Onglet Guilde, activité : arrivées, changements de rang, dons à la banque et victoires en raid |
| 2 | `02-guild-raids.png` | Onglet Guilde, raids : le prochain raid, les inscrits et la réponse du membre |
| 3 | `03-crafting.png` | Onglet Guilde, artisanat : la recherche d'un objet et qui peut le fabriquer |
| 4 | `04-character.png` | Onglet Moi : les rangs en donjon, les donjons récents et les duels d'un personnage |
| 5 | `05-guild-map.png` | Onglet Guilde, carte : la carte de chaleur et un appel à l'aide |
| 6 | `06-alerts.png` | Onglet Alertes : les interrupteurs push (raids, appels à l'aide, places de raid) |
| 7 | `07-stats.png` | Onglet Stats : le résumé de la semaine et les classements publics |
| 8 | `08-guild-roster.png` | Onglet Guilde, membres : personnages et rangs |

Prises le 26 novembre 2026 sur la version 0.6.0. Aucune des huit ne montre Guilded Clash, un vrai nom de joueur ou une
image du jeu.

Ne les refaire que si un écran change, avec `mobile/store/capture-screenshots.mjs` (les étapes sont dans le commentaire
en tête du fichier). Il connecte la version web à un faux serveur local et bloque tout autre hôte. Règles : données
inventées seulement, aucun vrai nom, aucun code de connexion, aucun logo ni image du jeu, la même taille de
1 080 × 1 920, et un export web fait **sans** `EXPO_PUBLIC_GUILDED_CLASH`.
