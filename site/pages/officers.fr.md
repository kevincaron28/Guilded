<p class="eyebrow">POUR LES MAÎTRES DE GUILDE ET LES OFFICIERS</p>

# Gérez votre guilde sans tableur.

Guilded réunit l'EP/GP, les règles de butin, les cores de raid, les inscriptions et la page
publique de votre guilde dans une seule boîte à outils gratuite. Commencez en jeu avec l'addon
seul; ajoutez le bot Discord quand votre guilde le souhaite.

<p class="actions"><a class="button" href="https://discord.com/oauth2/authorize?client_id=1552633893587394590&amp;scope=bot+applications.commands&amp;integration_type=0&amp;permissions=2269718703631440">Ajouter Guilded à votre Discord ↗</a><a class="text-link" href="/editions/?lang=fr">Addon seulement ? Téléchargez-le →</a></p>

## Deux façons de l'utiliser

| Addon seulement | Addon + bot Discord |
| --- | --- |
| EP/GP, butin, présences, recettes et donjons, partagés avec la guilde en jeu | Tout ce qui est en jeu, plus les inscriptions de raid, les classements et les sondages dans Discord |
| Rien à configurer hors de WoW | Les membres se connectent une fois avec le compagnon en ligne |
| [Télécharger pour votre édition de WoW](/editions/?lang=fr) | [Ajouter le bot](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718703631440), puis suivre les étapes ci-dessous |

## Lite tout de suite, Guilded complet après approbation

Ajouter le bot place votre serveur sur **Guilded Lite** immédiatement et envoie une demande
d'accès complet. Aucun formulaire à remplir.

| Fonctionne tout de suite (Lite) | Se débloque après approbation |
| --- | --- |
| `/setup start` : langue, rôles et salons | Synchro de l'addon et du compagnon |
| `/help`, `/mod faq`, `/report bug` | EP/GP, butin, cores de raid, saisons, présences |
| `/dungeon group` et inscriptions `/raid` de base | Classements des donjons et page publique de la guilde |
| | Rapports hebdomadaires, rappels, sondages et activités |

**Combien de temps faut-il pour l'approbation ?** Les serveurs sont approuvés à la main. Quand
l'approbation automatique est active, un serveur est aussi approuvé tout seul après quelques jours
d'utilisation normale : `/setup start` terminé, quelques membres, et Guilded utilisé dans la
semaine. L'hébergement est limité (50 serveurs Lite à la fois) : l'approbation n'est donc pas
garantie. Guilded est gratuit : un soutien facultatif n'achète jamais l'approbation ni la priorité.
Détails : [guide du bot hébergé](/docs/HOSTED_PILOT.html#fr).

## Configurer votre guilde en cinq étapes

1. **Ajoutez le bot** avec le bouton ci-dessus (il faut pouvoir gérer le serveur).
2. **Lancez `/setup start`** dans Discord. Choisissez le français ou l'anglais, votre fuseau
   horaire et les salons voulus. `/setup start status:true` montre ce qui manque encore. Placez le
   rôle de Guilded au-dessus des rôles qu'il doit attribuer.
3. **Demandez aux membres d'installer l'addon** pour votre édition de WoW :
   [page de téléchargement](/editions/?lang=fr) et [guide des membres](/docs/MEMBER_INSTALL.html#fr).
4. **Après l'approbation, reliez le compagnon.** Les membres ouvrent le
   [compagnon en ligne](/companion/?lang=fr), choisissent *Connexion avec Discord*, puis votre
   serveur. Au moins un officier devrait l'utiliser : les membres qui n'ont que l'addon passent par
   la synchro d'un officier pour rejoindre Discord.
5. **Passez en public quand vous êtes prêts.** Créez la page de votre guilde avec
   `/guildpage create`, puis `/guildpage publish`. Ouvrez le recrutement avec `/recruit set`.
   Publiez vos donjons avec `/mod leaderboard`. Partagez une place de raid d'un soir avec
   `/raid pug share`.

Cores de raid et prix en GP : `/core setup`, `/core edit` et `/core items`. Le
[guide EP/GP](/docs/EPGP_GUIDE.html#fr) décrit une soirée de raid complète.

Dans le [compagnon en ligne](/companion/?tab=pricing&lang=fr), **Prix de raid**
permet aux officiers de consulter les prix modifiables par emplacement et
d’activer explicitement le préréglage de décembre pour un core. Les réserves
existantes conservent leurs règles tant qu’un officier ne les modifie pas.
**Classements** affiche la priorité de raid et les scores de donjon. Utilisez
les clients candidats 8.1.0 correspondants pour le nouveau flux de prix en jeu;
les téléchargements stables restent indiqués séparément jusqu’au 4 novembre.

## Vous utilisez déjà Raid-Helper ?

Gardez-le. Les deux bots peuvent partager un serveur. L'EP/GP, le butin et les classements de
Guilded viennent de l'addon en jeu, quel que soit l'outil d'inscription de votre guilde.

## Questions

- **Est-ce vraiment gratuit ?** Oui, pour un usage non commercial. Le soutien aide l'hébergement et
  n'est jamais requis.
- **Pouvons-nous héberger notre propre bot ?** Oui : [guide d'hébergement](/docs/OWNER_WALKTHROUGH.html).
- **Où trouver de l'aide ?** Sur [notre Discord](https://discord.gg/YjzFwtP64V) ou avec
  `/report bug` dans votre serveur.
