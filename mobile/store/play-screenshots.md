# Google Play graphics: what is needed, exact sizes / Images pour Google Play : ce qu'il faut, tailles exactes

Sizes are Play Console's limits for the Main store listing
([Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)).
Les tailles sont les limites de Play Console pour la fiche principale.

## English

| Asset | Play's rule | Ready in this folder |
| --- | --- | --- |
| App icon | **512 × 512** px, 32-bit PNG with alpha, 1,024 KB at most | [`icon-512.png`](icon-512.png) |
| Feature graphic | **1,024 × 500** px, JPEG or 24-bit PNG, no alpha | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) |
| Phone screenshots | **2 to 8**, JPEG or 24-bit PNG, no alpha, each side between **320 and 3,840** px, the long side at most twice the short side. Ours: **1,080 × 1,920** px (9:16) | seven files in [`screenshots/`](screenshots/) |
| 7-inch tablet screenshots | optional; up to 8, same format, 320 to 3,840 px. Suggested if wanted: 1,200 × 1,920 px | none (not needed for a closed test) |
| 10-inch tablet screenshots | optional; up to 8, each side between 1,080 and 7,680 px. Suggested if wanted: 1,600 × 2,560 px | none (not needed for a closed test) |
| Promo video | optional YouTube link | none |

Phone screenshots, in upload order. Each one is 1,080 × 1,920 px, taken from the sample guild, with made-up names only:

| # | File | Must show |
| --- | --- | --- |
| 1 | `01-stats.png` | Stats tab: this week's summary and the public leaderboards |
| 2 | `02-guild-roster.png` | Guild tab, roster: characters, ranks, the "Sample guild" banner |
| 3 | `03-guild-map.png` | Guild tab, map: the heat map and one call-for-help pin |
| 4 | `04-guild-raids.png` | Guild tab, raids: the next raid and who signed up |
| 5 | `05-me-profile.png` | Me tab: the member's characters |
| 6 | `06-me-badges.png` | Me tab: the badge album |
| 7 | `07-alerts.png` | Alerts tab: the raid reminder switch |

Checked on 14 November 2026: none of the seven shows Guilded Clash, a real player name or game artwork, so they can be
uploaded as they are. The French listing may reuse them (Play does not require translated screenshots).

Retake them only if a screen changes. How: `mobile/store/capture-screenshots.mjs` (the comment at its top gives the
three commands). Rules for a retake: sample guild only, no real names, no sign-in codes, no game logo or artwork, the
same 1,080 × 1,920 size, and build the web export **without** `EXPO_PUBLIC_GUILDED_CLASH`.

## Français

| Élément | Règle de Play | Prêt dans ce dossier |
| --- | --- | --- |
| Icône de l'appli | **512 × 512** px, PNG 32 bits avec transparence, 1 024 Ko au plus | [`icon-512.png`](icon-512.png) |
| Image de présentation | **1 024 × 500** px, JPEG ou PNG 24 bits, sans transparence | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) |
| Captures pour téléphone | **2 à 8**, JPEG ou PNG 24 bits, sans transparence, chaque côté entre **320 et 3 840** px, le grand côté au plus deux fois le petit. Les nôtres : **1 080 × 1 920** px (9:16) | sept fichiers dans [`screenshots/`](screenshots/) |
| Captures pour tablette 7 po | facultatif; jusqu'à 8, même format, 320 à 3 840 px. Suggestion : 1 200 × 1 920 px | aucune (inutile pour un test fermé) |
| Captures pour tablette 10 po | facultatif; jusqu'à 8, chaque côté entre 1 080 et 7 680 px. Suggestion : 1 600 × 2 560 px | aucune (inutile pour un test fermé) |
| Vidéo promotionnelle | lien YouTube facultatif | aucune |

Captures pour téléphone, dans l'ordre de téléversement. Chacune fait 1 080 × 1 920 px, prise dans la guilde d'exemple,
avec des noms inventés seulement :

| # | Fichier | Doit montrer |
| --- | --- | --- |
| 1 | `01-stats.png` | Onglet Stats : le résumé de la semaine et les classements publics |
| 2 | `02-guild-roster.png` | Onglet Guilde, membres : personnages, rangs, la bannière « guilde d'exemple » |
| 3 | `03-guild-map.png` | Onglet Guilde, carte : la carte de chaleur et un appel à l'aide |
| 4 | `04-guild-raids.png` | Onglet Guilde, raids : le prochain raid et les inscrits |
| 5 | `05-me-profile.png` | Onglet Moi : les personnages du membre |
| 6 | `06-me-badges.png` | Onglet Moi : l'album de badges |
| 7 | `07-alerts.png` | Onglet Alertes : l'interrupteur du rappel de raid |

Vérifié le 14 novembre 2026 : aucune des sept ne montre Guilded Clash, un vrai nom de joueur ou une image du jeu. Elles
peuvent être téléversées telles quelles, aussi pour la fiche en français (Play n'exige pas de captures traduites).

Ne les refaire que si un écran change, avec `mobile/store/capture-screenshots.mjs` (les trois commandes sont dans le
commentaire en tête du fichier). Règles : guilde d'exemple seulement, aucun vrai nom, aucun code de connexion, aucun
logo ni image du jeu, la même taille de 1 080 × 1 920, et un export web fait **sans** `EXPO_PUBLIC_GUILDED_CLASH`.
