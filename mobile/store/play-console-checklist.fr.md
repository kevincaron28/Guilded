# Liste de contrôle Play Console : test fermé avec Testers Community

Rédigée le 14 novembre 2026. Version anglaise : [play-console-checklist.md](play-console-checklist.md). Notes plus
longues sur chaque écran de la Console : [docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md) (en anglais).

**Qui fait quoi.** « Propriétaire » veut dire Kevin lui-même : une connexion, un mot de passe, un code 2FA, une
donnée d'identité ou de paiement, une case de déclaration, un fichier d'identifiants ou une action publique.
« Agent » veut dire que la session maîtresse ou un travailleur peut le faire, après le oui du propriétaire quand
l'étape le dit. Un agent s'arrête devant toute page de connexion, tout CAPTCHA, toute nouvelle condition ou tout
forfait payant.

Les noms de menus sont ceux de Play Console en anglais (novembre 2026), pour qu'ils correspondent à l'écran.

## Avant de commencer

| # | Étape | Qui |
| --- | --- | --- |
| 0.1 | La demande de fusion de l'appli (appli mobile, trousse de la boutique, tâche d'intégration mobile) est fusionnée et l'intégration continue est verte sur `main`. La demande de fusion du serveur (bot, Worker, base de données) n'est pas nécessaire pour le test fermé. | Agent (la session maîtresse fusionne) |
| 0.2 | Nom de l'appli : décidé le 15 novembre 2026, `Guild Sync Companion`. L'étiquette sous l'icône du téléphone reste `Guilded`. | Fait |
| 0.3 | Avec ou sans notifications poussées : décidé le 15 novembre 2026, **sans** pour le premier paquet. Compiler avec `production-no-push`; aucune étape Firebase. | Fait |

## 1. Compiler le paquet (.aab)

À lancer depuis `mobile\` dans la copie principale du dépôt sur le PC du propriétaire, sur `main` après la fusion.
PowerShell bloque `npx` sur ce PC : utiliser `npx.cmd`.

| # | Étape | Qui |
| --- | --- | --- |
| 1.1 | Installer les dépendances : `npm.cmd ci` dans `mobile\` (la copie principale, jamais un worktree qui a une jonction `node_modules`). | Agent |
| 1.2 | Vérifier la connexion Expo : `npx.cmd eas-cli whoami` doit répondre `kevincaron28`. Sinon : `npx.cmd eas-cli login`. | Le **propriétaire** tape le mot de passe s'il faut se connecter |
| 1.3 | Lancer la compilation : `npx.cmd eas-cli build --platform android --profile production-no-push` (ou `--profile production` avec Firebase). | Agent, après le oui du propriétaire pour 1.4 |
| 1.4 | La première compilation pour la boutique demande **« Generate a new Android Keystore? »** Répondre **Yes**. Cela crée la clé de téléversement et la garde dans le compte Expo du propriétaire. Rien n'est téléchargé et aucun fichier de clé n'entre dans le dépôt. | **Oui du propriétaire** (une clé de signature est créée) |
| 1.5 | Attendre la fin sur expo.dev (environ 15 minutes), puis télécharger le `.aab` depuis la page de la compilation vers `Documents\guilded-secrets\builds\` (pas dans le dépôt). | Agent |
| 1.6 | Noter l'adresse de la page de compilation, le versionCode affiché sur cette page et le SHA-256 du fichier dans les notes d'acceptation. | Agent |
| 1.7 | **Chaque téléversement vers Play demande un versionCode plus élevé.** Rien à faire à la main : EAS l'augmente à chaque compilation `production` ou `production-no-push` (source de version distante, `autoIncrement`). Un nouveau téléversement veut donc toujours dire une nouvelle compilation, jamais deux fois le même `.aab`. | — |

Si la compilation échoue avec « Production Android builds require the Firebase GOOGLE_SERVICES_JSON… », le profil
était `production` sans Firebase : utiliser `production-no-push`.

## 2. Créer l'appli

| # | Étape | Qui |
| --- | --- | --- |
| 2.1 | https://play.google.com/console → **Create app**. | **Propriétaire** (connecté) |
| 2.2 | Nom de l'appli `Guild Sync Companion`, langue par défaut **English (United States) – en-US**, **App**, **Free**. | L'agent peut taper; le **propriétaire** vérifie |
| 2.3 | Cocher les déclarations (Developer Program Policies, lois américaines sur l'exportation) → **Create app**. | **Propriétaire** |

Le nom de paquet `top.kcaron.guilded` est fixé pour toujours par le premier paquet téléversé. Il ne peut plus changer.

## 3. Contenu de l'appli (Policy → App content)

Chaque carte demande **Save**; certaines demandent **Submit**. Les réponses sont prêtes :

| Carte | Réponse | Qui |
| --- | --- | --- |
| Privacy policy | `https://guildedwow.com/docs/PRIVACY` | L'agent tape, le **propriétaire** enregistre |
| App access | « All or some functionality is restricted » → consignes de [play-content-rating.fr.md](play-content-rating.fr.md) (guilde d'exemple; aucun compte de test) | L'agent tape, le **propriétaire** enregistre |
| Ads | Pas de publicité | **Propriétaire** |
| Content ratings | [play-content-rating.fr.md](play-content-rating.fr.md) : catégorie **All Other App Types**; courriel `support@guildedwow.com` | L'agent tape, le **propriétaire** soumet |
| Target audience and content | 13–15, 16–17, 18 ans et plus; n'attire pas les enfants | **Propriétaire** |
| News apps | Non | **Propriétaire** |
| Data safety | [play-data-safety.fr.md](play-data-safety.fr.md), ligne par ligne | L'agent tape, le **propriétaire** soumet |
| Government apps, Financial features, Health | Non / aucune | **Propriétaire** |
| Advertising ID | **Non**, l'appli n'utilise pas d'identifiant publicitaire | **Propriétaire** |

## 4. Fiche de la boutique (Grow users → Store presence → Main store listing)

| # | Étape | Qui |
| --- | --- | --- |
| 4.1 | Nom, description courte et complète : les blocs anglais de [play-listing.md](play-listing.md). | L'agent tape |
| 4.2 | Icône `icon-512.png`, image de présentation `feature-graphic-1024x500.png`, les sept captures pour téléphone dans l'ordre des numéros ([play-screenshots.md](play-screenshots.md)). | L'agent téléverse |
| 4.3 | **Save**. Puis **Manage translations → Add your own translation text → French (Canada) – fr-CA**, coller les blocs français, **Save**. | L'agent tape, le **propriétaire** relit le français |
| 4.4 | **Store settings** : catégorie **Entertainment** (pas Social : Play demande alors une déclaration « Child safety standards » prévue pour les applis sociales et de rencontre), courriel `support@guildedwow.com`, site `https://guildedwow.com` → **Save**. Vérifier d'abord qu'un message envoyé à cette adresse arrive bien au propriétaire. | **Propriétaire** |

## 5. Piste de test fermé

| # | Étape | Qui |
| --- | --- | --- |
| 5.1 | **Test and release → Testing → Closed testing** → piste par défaut (« Closed testing - Alpha ») → **Manage track**. | Agent |
| 5.2 | Onglet **Countries / regions** → **Add countries / regions** → choisir **tous** les pays → **Save**. Les testeurs de Testers Community sont dans beaucoup de pays; un testeur dont le pays manque voit « appli non disponible ». | Agent |
| 5.3 | Onglet **Testers** → sous **Google Groups**, ajouter l'adresse du groupe de Testers Community (étape 6.1). Ne pas utiliser « Email lists » pour ce groupe. Adresse pour les commentaires : `support@guildedwow.com`. **Save**. | L'agent tape l'adresse confirmée par le propriétaire |
| 5.4 | Facultatif : un deuxième groupe Google ou une liste de courriels pour les membres de la guilde qui veulent tester. | **Propriétaire** |
| 5.5 | Onglet **Releases** → **Create new release** → accepter **Play App Signing** (Google crée et garde la clé de signature de l'appli) → téléverser le `.aab` → nom `0.3.0 (closed test)` → notes de version de [play-closed-test.md](play-closed-test.md) → **Next** → corriger toute erreur → **Save**. | Le **propriétaire** accepte Play App Signing; l'agent téléverse |
| 5.6 | **Publishing overview** → **Send changes for review**. C'est l'action publique : elle envoie l'appli à Google. | **Oui du propriétaire** |
| 5.7 | Attendre l'examen de Google (de quelques heures à quelques jours pour une première version). La piste doit dire que la version est **disponible pour les testeurs**, pas « in review » ni « draft ». | — |
| 5.8 | Onglet Testers → **How testers join your test** → copier les deux liens : le lien d'inscription web (`https://play.google.com/apps/testing/top.kcaron.guilded`) et le lien Play (`https://play.google.com/store/apps/details?id=top.kcaron.guilded`). | Agent |

## 6. Testers Community

Ce que disent leurs pages publiques (lues le 14 novembre 2026; ce sont les affirmations du fournisseur) :

- L'exigence couverte : un test fermé avec au moins 12 testeurs inscrits pendant 14 jours de suite, pour les comptes
  de développeur personnels créés après le 13 novembre 2023
  ([page de Google](https://support.google.com/googleplay/android-developer/answer/14151465)).
- Le développeur ajoute **leur groupe Google de testeurs** à la piste fermée, sous « Google Groups » et non « Email
  lists », choisit tous les pays, puis enregistre, envoie en examen et publie
  ([guide d'intégration](https://testerscommunity.com/guides/enterprise-onboarding),
  [fonctionnement, dans le tableau de bord](https://www.testerscommunity.com/dashboard/guides/how-testers-community-works)).
  L'adresse du groupe qui ressort des résultats de recherche pour leur guide est
  `testers-community@googlegroups.com`. **La confirmer sur la page du tableau de bord avant de la taper** : ce
  tableau de bord demande la connexion du propriétaire.
- L'appli est soumise à https://www.testerscommunity.com/submit-app avec les liens du test fermé
  ([présentation de Testers Community](https://testerscommunity.com/blog/what-is-testers-community)).
- Les testeurs s'inscrivent en 6 heures environ après la publication du test, restent toute la période, et un rapport
  arrive à la fin. Les forfaits payants promettent l'accès à la production ou le remboursement; les conditions sont
  dans leur politique de remboursement, que le propriétaire devrait lire avant de dépenser le crédit.
- Leurs pages ne disent pas si l'appli doit être gratuite et ne listent pas ce que le développeur doit éviter pendant
  les 14 jours. La règle de Google répond au second point : un testeur qui part et revient recommence au jour 1.

| # | Étape | Qui |
| --- | --- | --- |
| 6.1 | Se connecter à testerscommunity.com, ouvrir le guide du tableau de bord et lire l'adresse exacte du groupe Google et toute consigne plus récente. Donner l'adresse à la session maîtresse. | **Propriétaire** |
| 6.2 | Quand 5.7 dit « disponible pour les testeurs » : soumettre l'appli à https://www.testerscommunity.com/submit-app avec les deux liens de 5.8, le crédit Pro et la note aux testeurs de [play-closed-test.md](play-closed-test.md). Cela lance la commande : une action publique qui dépense le crédit. | **Propriétaire** |
| 6.3 | Le jour même, vérifier dans Play Console (Closed testing → Testers) que le nombre de testeurs monte à 12 ou plus. S'il reste à 0, les causes habituelles : changements non enregistrés, examen non envoyé, ou version pas encore approuvée. | L'agent lit, le **propriétaire** est connecté |
| 6.4 | Pendant 14 jours : ne pas retirer le groupe, ne pas mettre la piste en pause ni la supprimer, ne pas dépublier l'appli, ne pas changer les pays. De nouvelles compilations sont permises (versionCode plus élevé, même piste). Répondre à ce que les testeurs signalent. | Tout le monde |
| 6.5 | Garder les commentaires : le rapport de Testers Community et ce qui arrive à l'adresse de soutien. Google pose des questions là-dessus à l'étape 7. | Agent |

## 7. Après 14 jours : demander l'accès à la production

| # | Étape | Qui |
| --- | --- | --- |
| 7.1 | **Dashboard** de Play Console → quand il dit que l'exigence de test est remplie → **Apply for production**. | **Propriétaire** |
| 7.2 | Répondre aux trois parties : le test fermé (comment les testeurs ont été recrutés, ce qu'ils ont utilisé, les commentaires et comment ils ont été recueillis), l'appli (public, utilité, installations prévues la première année), la préparation à la production (ce qui a changé après le test). Un agent rédige les réponses à partir du rapport; le propriétaire lit et soumet. L'examen prend en général sept jours ou moins. | L'agent rédige, le **propriétaire** soumet |
| 7.3 | Après l'approbation : **Production** → **Create new release** → **Add from library** → notes de version → pays → **Send for review**. | **Oui du propriétaire** |

## Inutile pour le test fermé, à faire avant la production

- Liens d'appli : une fois Play App Signing en place, copier le SHA-256 du certificat de signature de l'appli (Play
  Console → Test and release → Setup → App signing) dans la variable de compilation du site
  `MOBILE_ANDROID_SHA256_FINGERPRINTS`, puis redéployer le site et son Worker pour que
  `https://guildedwow.com/.well-known/assetlinks.json` réponde. D'ici là, un lien `guildedwow.com/app/...` ouvre le
  navigateur, sans conséquence. L'empreinte est publique, ce n'est pas un secret.
- Notifications poussées : Firebase et le côté serveur (les tables et les routes du bot sont dans une demande de fusion
  à part, avec son propre examen et son propre déploiement du bot). Sans elle, l'appli fonctionne : seuls les alertes
  poussées et le renouvellement de la connexion attendent.
- `EXPO_TOKEN` dans GitHub pour les mises à jour JavaScript automatiques (ANDROID_PLAY_LAUNCH.md, étape 1b). Le
  propriétaire crée le jeton.
- Faire pointer `site/releases.json` et `/companion/` vers la fiche Play quand l'appli sera publique.
