<section class="community-hero" aria-labelledby="companion-title">
<p class="eyebrow">COMPAGNON · WINDOWS</p>
<h1 id="companion-title">Obtenir le compagnon <em>Guilded.</em></h1>
<p>Une petite application Windows gratuite qui envoie les données enregistrées de votre addon à Discord et au site, et rapporte les classements dans le jeu.</p>
<div class="actions"><a class="button" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Microsoft Store (recommandé, signé) <span aria-hidden="true">↗</span></a><a class="button secondary" href="{{COMPANION_DIRECT_URL}}">Téléchargement direct (mise à jour automatique) <span aria-hidden="true">↓</span></a></div>
</section>

## Application Android (préversion)

<div class="actions"><a class="button" href="{{ANDROID_APK_URL}}">Télécharger l’application Android (APK) <span aria-hidden="true">↓</span></a><a class="button secondary" href="{{ANDROID_RELEASE_URL}}">Notes de version <span aria-hidden="true">↗</span></a></div>

Une **préversion** gratuite de l’application mobile Guilded pour Android : consultez le roster de raid de votre guilde, les réserves, la liste de souhaits de butin et les classements, et recevez des rappels de raid. C’est une préversion installée hors boutique, version {{ANDROID_VERSION}}, pas encore sur Google Play. Après avoir ouvert le fichier, Android vous demande d’autoriser l’installation depuis votre navigateur : autorisez-le une fois, puis installez. L’application vous avertit quand une version plus récente est prête et met son contenu à jour d’elle-même.

SHA-256 du fichier : `{{ANDROID_SHA256}}`. Vous pouvez le comparer à la somme de contrôle affichée par un outil de hachage avant d’installer.

## En ai-je besoin ?

- **Addon seulement :** non. L’addon fonctionne seul en jeu, et votre guilde partage EP/GP, butin et classements en jeu sans le compagnon.
- **Fonctions Discord et site :** oui. Les succès, les classements, votre page de joueur et les classements synchronisés avec le Discord de votre guilde exigent le compagnon pour envoyer vos données enregistrées.

Le compagnon fonctionne **sous Windows seulement**. Il n’existe pas de version Mac ou Linux, ni de version dans le navigateur.

## Installer

1. **Microsoft Store (recommandé, signé).** Ouvrez la [fiche Guilded Companion](https://apps.microsoft.com/detail/9N680XX3QFL9). Elle est signée par le Store, qui la met à jour tout seul.
2. **Téléchargement direct (mise à jour automatique).** Pour celles et ceux qui préfèrent éviter le Store : [téléchargez l’installateur]({{COMPANION_DIRECT_URL}}). Ce lien donne toujours la version la plus récente. Installez-le une fois et oubliez-le : le compagnon cherche une nouvelle version toutes les quelques heures, vérifie chaque téléchargement avec son empreinte publiée et l’installe discrètement à la fermeture ou au prochain démarrage. Vous pouvez désactiver cette option ou vérifier à la main dans les paramètres du compagnon.

**À propos de l’avertissement Windows.** L’installateur direct n’est pas signé : Windows SmartScreen peut indiquer qu’il « a protégé votre PC ». Choisissez **Informations complémentaires → Exécuter quand même**. Pour vérifier le fichier, son SHA-256 (version {{COMPANION_DIRECT_VERSION}}) est `{{COMPANION_DIRECT_SHA256}}`, et chaque version publie ses empreintes dans `SHA256SUMS` sur la [page de la version](https://github.com/kevincaron28/Guilded/releases/latest). La version du Store ne se met jamais à jour ainsi, car le Store s’en charge.

Ouvrez ensuite le compagnon, choisissez **Connexion avec Discord**, sélectionnez votre serveur (ou les classements publics seulement) puis vos données enregistrées. Après avoir joué, faites `/reload` dans WoW et le compagnon synchronise. Consultez le [guide d’installation](../docs/MEMBER_INSTALL.html#fr) pour chaque étape.

Vous veniez de l’ancien compagnon en ligne ? Votre lien Discord se trouve dans l’application Windows : connectez-vous une fois et c’est réglé.
