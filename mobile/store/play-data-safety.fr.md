# Réponses au formulaire « Sécurité des données » de Google Play — Guilded

Version française de [play-data-safety.md](play-data-safety.md), qui fait foi et donne le détail requête par requête.
Où les saisir : Play Console → **Policy → App content → Data safety**. Les réponses viennent de ce que le code de
l'appli envoie vraiment, vérifié le 26 novembre 2026 sur `mobile/src` (version 0.6.0, sans Guilded Clash), et ont été
**enregistrées dans Play Console ce jour-là, sans être encore envoyées en examen**. Pour Play, une donnée est
**collectée** quand l'appli l'envoie hors de l'appareil. Ce que l'appli reçoit et affiche seulement (noms des membres,
listes, positions, fil d'activité) n'est pas collecté par l'appli.

## Ce que l'appli envoie, et pourquoi

Tout part vers le serveur Guilded où le membre s'est connecté (par défaut `https://guildedwow.com`), en HTTPS
seulement, sauf la vérification des mises à jour.

| Donnée envoyée | Raison de la réponse |
| --- | --- |
| Un identifiant de connexion (lié au compte Discord du membre), gardé dans le stockage sécurisé d'Android | Sert à reconnaître le compte du membre : c'est un **identifiant d'utilisateur**. |
| L'identifiant du serveur Discord et la langue | Servent à lire les données de la guilde; ce ne sont pas des données personnelles. |
| Les changements de la liste de souhaits (nom d'objet, priorité, personnage), la note d'une demande d'artisanat et le texte de Signaler un problème (0.7.0, envoyé seulement quand la personne appuie sur Envoyer) | Contenu écrit par le membre et gardé avec la guilde : **autre contenu généré par l'utilisateur**. |
| Les réponses aux raids, les demandes d'artisanat (objet, quantité, personnage), « Principal » et « Délier » pour ses propres personnages, l'interrupteur de partage de la carte | Actions du membre : **autres actions**. La position vient du jeu sur le PC, jamais du téléphone : **aucune localisation**. |
| Le texte de la recherche d'artisanat | **Historique de recherche dans l'appli**. Le serveur s'en sert pour répondre et ne le garde pas : traitement éphémère. |
| Le rapport d'erreur, seulement quand une personne touche « Envoyer le rapport d'erreur » | Texte de l'erreur, courte pile sans liens ni chemins, version, plateforme et écran; aucun nom, jeton ou donnée de guilde : **journaux de plantage**. |
| Le jeton de notification Expo et les interrupteurs d'alertes (raids, appels à l'aide, places de raid), seulement si le membre active les alertes | Sert à livrer les alertes : **identifiant d'appareil ou autre**. |
| À chaque lancement, vers le service de mise à jour d'Expo : version, canal, plateforme et un identifiant d'installation aléatoire créé sur le téléphone | Sert à recevoir une mise à jour de l'appli : **identifiant d'appareil ou autre**. |

Non utilisés : localisation de l'appareil, contacts, photos, fichiers, micro, caméra, calendrier, SDK de mesure
d'audience, rapports de plantage automatiques, publicité. Aucun SDK de mesure ou de publicité n'est dans
`mobile/package.json`.

## Réponses du formulaire

| Question | Réponse | Raison |
| --- | --- | --- |
| L'appli collecte-t-elle ou partage-t-elle des données d'utilisateur ? | **Oui** | Les six types ci-dessous. |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** | L'appli refuse les adresses `http`, sauf sur l'appareil lui-même (`apiOrigin` dans `mobile/src/api.ts`). |
| Création de compte | **OAuth** | Le compte est créé hors de l'appli (Discord, par le site de Guilded). |
| Adresse de suppression du compte | https://guildedwow.com/delete-my-data/ | Google veut une page lisible sans connexion. Dans l'appli : Moi → Réglages → **Supprimer mes données** → **Tout supprimer**, qui efface le compte et ses données sur le serveur et déconnecte le téléphone. Le site retire ses pages de compte; si sa page publique de suppression reçoit sa propre adresse, la mettre ici et dans `DELETE_INFO_URL` (`mobile/src/links.ts`). |

**Types de données.** Cocher seulement ces six :

| Catégorie → type | Collecté | Partagé | Traitement éphémère | Obligatoire ou facultatif | Finalités |
| --- | --- | --- | --- | --- | --- |
| Personal info → **User IDs** | Oui | Non | Non | Facultatif (Stats, Nouvelles et la guilde d'exemple fonctionnent sans connexion) | App functionality, Account management |
| App activity → **Other user-generated content** | Oui | Non | Non | Facultatif | App functionality |
| App activity → **Other actions** | Oui | Non | Non | Facultatif | App functionality |
| App activity → **In-app search history** | Oui | Non | **Oui** (Play ne l'affiche donc pas sur la fiche) | Facultatif | App functionality |
| App info and performance → **Crash logs** | Oui | Non | Non | Facultatif (un bouton que la personne touche; rien n'est envoyé automatiquement) | App functionality, Analytics (pour Play, « Analytics » comprend le diagnostic des plantages) |
| Device or other IDs → **Device or other IDs** | Oui | Non | Non | **Obligatoire** : l'identifiant d'installation part à chaque lancement (le jeton de notification seulement avec les alertes) | App functionality |

Tout le reste est **non collecté** : localisation, nom, courriel, adresse, téléphone, données financières, santé,
messages, photos, vidéos, audio, fichiers, calendrier, contacts, navigation web, interactions dans l'appli,
applis installées, diagnostics.

Gardé sur le téléphone seulement (jamais envoyé) : l'appli enregistre les derniers classements, nouvelles, résumé de la
semaine et vues de guilde dans son stockage privé (`@react-native-async-storage/async-storage`) pour les montrer hors
ligne. Le jeton de connexion n'y est pas (il reste dans le trousseau). La déconnexion et **Supprimer mes données**
effacent les vues de guilde.

**Partagé : Non** pour chaque type. Les fournisseurs d'hébergement et de notification de Guilded (Cloudflare, Oracle
Cloud, Expo, Firebase Cloud Messaging) traitent les données pour le compte de Guilded; Play ne compte pas les
fournisseurs de services comme un partage.

## Mettre ce formulaire à jour quand

- un écran se met à envoyer une nouvelle donnée au serveur;
- des rapports de plantage automatiques ou une mesure d'audience sont ajoutés (le rapport d'erreur est manuel et déjà
  déclaré comme Crash logs);
- l'appli lit un jour la localisation de l'appareil (elle ne doit pas le faire pour la carte de guilde : les positions
  viennent du jeu).
