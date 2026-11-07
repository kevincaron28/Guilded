<section class="community-hero" aria-labelledby="companion-title">
<p class="eyebrow">COMPAGNON · WINDOWS</p>
<h1 id="companion-title">Obtenir le compagnon <em>Guilded.</em></h1>
<p>Une petite application Windows gratuite qui envoie les données enregistrées de votre addon à Discord et au site, et rapporte les classements dans le jeu.</p>
<div class="actions"><a class="button" href="{{COMPANION_DIRECT_URL}}">Télécharger pour Windows <span aria-hidden="true">↓</span></a><a class="button secondary" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Microsoft Store <span aria-hidden="true">↗</span></a></div>
<p class="micro">Gratuit · Windows 10 et 11 · environ 120 Mo · se met à jour tout seul</p>
</section>

## Application Android (préversion)

<div class="actions"><a class="button" href="{{ANDROID_APK_URL}}">Télécharger l’application Android (APK) <span aria-hidden="true">↓</span></a><a class="button secondary" href="{{ANDROID_RELEASE_URL}}">Notes de version <span aria-hidden="true">↗</span></a></div>

Une **préversion** gratuite de l’application mobile Guilded pour Android : consultez le roster de raid de votre guilde, les réserves, la liste de souhaits de butin et les classements, et recevez des rappels de raid. C’est une préversion installée hors boutique, version {{ANDROID_VERSION}}, pas encore sur Google Play. Après avoir ouvert le fichier, Android vous demande d’autoriser l’installation depuis votre navigateur : autorisez-le une fois, puis installez. L’application vous avertit quand une version plus récente est prête et met son contenu à jour d’elle-même.

SHA-256 du fichier : `{{ANDROID_SHA256}}`. Vous pouvez le comparer à la somme de contrôle affichée par un outil de hachage avant d’installer.

## En ai-je besoin ?

- **Addon seulement :** non. L’addon fonctionne seul en jeu, et votre guilde partage EP/GP, butin et classements en jeu sans le compagnon.
- **Fonctions Discord et site :** oui. Les succès, les classements, votre page de joueur et les classements synchronisés avec le Discord de votre guilde exigent le compagnon pour envoyer vos données enregistrées.

Le compagnon fonctionne **sous Windows seulement**. Il n’existe pas de version Mac ou Linux, ni de version dans le navigateur.

## Installer en trois étapes

1. **Téléchargez.** [Télécharger pour Windows]({{COMPANION_DIRECT_URL}}). Le lien donne toujours la version la plus récente.
2. **Lancez-le.** Ouvrez le fichier téléchargé. Windows peut indiquer qu’il « a protégé votre PC » : choisissez **Informations complémentaires → Exécuter quand même** (l’installateur est gratuit et n’est pas signé). Il n’y a rien à choisir : il s’installe et ouvre le compagnon tout seul.
3. **Laissez la configuration faire le reste.** Le compagnon trouve World of Warcraft sur n’importe quel disque, installe ou met à jour l’addon Guilded et ouvre Discord dans votre navigateur : choisissez le serveur de votre guilde et appuyez sur **Relier**. Après votre prochain `/reload` dans WoW (ou à la déconnexion), il synchronise tout seul et continue depuis la zone de notification.

C’est tout. Le compagnon **se met à jour tout seul** : les nouvelles versions se téléchargent en arrière-plan et s’installent quand vous le quittez ou le redémarrez, ou tout de suite avec **Mettre à jour** dans son Accueil.

**Vous avez déjà Guilded Companion du Microsoft Store ?** Cet installateur le remplace en gardant vos réglages et votre liaison Discord, pour n’en avoir qu’un. Vous préférez le Store ? [Obtenez-le sur Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) : il est signé par le Store, qui le met à jour (pour mettre à jour tout de suite, choisissez **Ouvrir Microsoft Store** dans l’Accueil du compagnon).

**Un problème ?** Ouvrez le compagnon et appuyez sur **Réparer** : il vérifie le dossier WoW, l’addon, votre connexion et la synchronisation, corrige ce qu’il peut et dit clairement ce qui reste. Le [guide d’installation](../docs/MEMBER_INSTALL.html) montre chaque étape en images.

**Vérifier le fichier vous-même.** L’empreinte SHA-256 de l’installateur (version {{COMPANION_DIRECT_VERSION}}) est `{{COMPANION_DIRECT_SHA256}}`, et chaque version liste ses empreintes dans `SHA256SUMS` sur la [page de la version](https://github.com/kevincaron28/Guilded/releases/latest).
