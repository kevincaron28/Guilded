# Réponses au formulaire « Sécurité des données » de Google Play — Guilded

Version française de [play-data-safety.md](play-data-safety.md), qui fait foi et donne le détail requête par requête.
Où les saisir : Play Console → **Policy → App content → Data safety**. Les réponses viennent de ce que le code de
l'appli envoie vraiment, vérifié le 14 novembre 2026 sur `mobile/src` (version 0.3.0, sans Guilded Clash). Pour Play,
une donnée est **collectée** quand l'appli l'envoie hors de l'appareil. Ce que l'appli reçoit et affiche seulement
(noms des membres, listes, positions) n'est pas collecté par l'appli.

## Ce que l'appli envoie, et pourquoi

Tout part vers le serveur Guilded où le membre s'est connecté (par défaut `https://guildedwow.com`), en HTTPS
seulement.

| Donnée envoyée | Raison de la réponse |
| --- | --- |
| Un identifiant de connexion (lié au compte Discord du membre), gardé dans le stockage sécurisé d'Android | Sert à reconnaître le compte du membre : c'est un **identifiant d'utilisateur**. |
| L'identifiant du serveur Discord et la langue | Servent à lire les données de la guilde; ce ne sont pas des données personnelles. |
| Les changements de la liste de souhaits (nom d'objet, priorité, personnage) | Contenu créé par le membre et gardé avec la guilde : **autre contenu généré par l'utilisateur**. |
| L'interrupteur de partage de la carte (oui ou non) | Un réglage. La position vient du jeu sur le PC, jamais du téléphone : **aucune localisation**. |
| Le jeton de notification Expo, seulement si le membre active les alertes et seulement dans un paquet compilé avec Firebase | Identifie l'installation pour livrer les alertes : **identifiant d'appareil ou autre**. |
| À chaque lancement, vers le service de mise à jour d'Expo : version, canal, plateforme et un identifiant d'installation aléatoire créé sur le téléphone | Sert à recevoir une mise à jour de l'appli : **identifiant d'appareil ou autre**. |

Non utilisés : localisation de l'appareil, contacts, photos, fichiers, micro, caméra, calendrier, mesure d'audience,
rapports de plantage, publicité. Aucun SDK de mesure ou de publicité n'est dans `mobile/package.json`.

## Réponses du formulaire

| Question | Réponse | Raison |
| --- | --- | --- |
| L'appli collecte-t-elle ou partage-t-elle des données d'utilisateur ? | **Oui** | Les trois types ci-dessous. |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** | L'appli refuse les adresses `http`, sauf sur l'appareil lui-même (`apiOrigin` dans `mobile/src/api.ts`). |
| Les utilisateurs peuvent-ils demander la suppression de leurs données ? | **Oui** | Dans l'appli : Moi → Réglages → **Supprimer mes données** → **Tout supprimer**. L'appli efface le compte et ses données sur le serveur et déconnecte le téléphone, sans passer par le site. Sur le web : https://guildedwow.com/docs/PRIVACY#choices-access-and-deletion, lisible sans connexion. Le site retire ses pages de compte; si sa page publique de suppression reçoit sa propre adresse, la mettre ici et dans `DELETE_INFO_URL` (`mobile/src/links.ts`). |
| Création de compte | Le compte est créé hors de l'appli (Discord, par le site de Guilded) | Si la Console demande une « Delete account URL », donner l'adresse ci-dessus : Google veut une page lisible sans connexion. |

**Types de données.** Cocher seulement ceux-ci :

| Catégorie → type | Collecté | Partagé | Traitement éphémère | Obligatoire ou facultatif | Finalités | Raison |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info → **User IDs** | Oui | Non | Non | Facultatif | App functionality, Account management | L'identifiant de connexion; Stats, Nouvelles et la guilde d'exemple fonctionnent sans connexion. |
| App activity → **Other user-generated content** | Oui | Non | Non | Facultatif | App functionality | La liste de souhaits. |
| Device or other IDs → **Device or other IDs** | Oui | Non | Non | Facultatif pour le jeton de notification; l'identifiant d'installation part de chaque copie installée, donc si la Console force un seul choix, répondre **Required** | App functionality | Alertes et mises à jour de l'appli. |

Tout le reste est **non collecté** : localisation, nom, courriel, adresse, téléphone, données financières, santé,
messages, photos, vidéos, audio, fichiers, calendrier, contacts, navigation web, interactions dans l'appli,
historique de recherche, applis installées, journaux de plantage, diagnostics.

**Partagé : Non** pour chaque type. Les fournisseurs d'hébergement et de notification de Guilded (Cloudflare, Oracle
Cloud, Aiven, Expo, Firebase Cloud Messaging) traitent les données pour le compte de Guilded; Play ne compte pas les
fournisseurs de services comme un partage.

**Avec un paquet `production-no-push`**, le jeton de notification n'existe pas encore. Garder quand même la ligne
« Device or other IDs » cochée : elle reste vraie pour l'identifiant d'installation, et cela évite un second examen
quand les alertes poussées seront activées.

## Mettre ce formulaire à jour quand

- des rapports de plantage ou une mesure d'audience sont ajoutés (Crash logs, Diagnostics);
- l'appli lit un jour la localisation de l'appareil (elle ne doit pas le faire pour la carte de guilde : les positions
  viennent du jeu).
