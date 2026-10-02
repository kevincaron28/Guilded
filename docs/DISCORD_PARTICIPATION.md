# Participation Discord

Guilded ajoute des récompenses plafonnées dans une **saison communautaire Discord**.
Elles utilisent le portefeuille et le classement `/community` existants; aucun EP/GP,
point de donjon, protocole de compagnon ou SavedVariables n'est modifié. Version 5.0.0.

## Activer sur les salons choisis

Un officier crée une saison Discord dans un salon communautaire accessible au bot :

```text
/community start-season name:Participation octobre game:DISCORD
/participation settings season:SAISON channel:#discussion enabled:true
/participation settings season:SAISON channel:Vocal
/participation status season:SAISON
```

Utiliser l'identifiant renvoyé à la place de `SAISON`. Ajouter les autres salons
un à la fois. Seuls les salons textuels ordinaires et les vocaux explicitement
choisis comptent; les MP, fils, forums, salons AFK et autres salons sont exclus.
Le suivi reste désactivé tant qu'un officier ne l'active pas avec au moins un salon.
`enabled:false` suspend les gains. `channel:... remove:true` retire un salon.
`settings` sans autre option affiche les règles. Maximum 20 salons de chaque type.

## Règles par défaut

| Source | Points | Protection |
| --- | --- | --- |
| Messages | 1 toutes les 5 minutes, maximum 10/jour | Délai partagé entre salons et au changement de jour; bots, webhooks et messages système exclus. |
| Vocal | 2 par tranche de 15 minutes, maximum **240 minutes/jour = 32 points** | Deux humains admissibles dans le même vocal; aucun temps AFK, assourdi, seul ou hors des salons choisis. Les personnes muettes peuvent écouter et comptent. |
| Réactions reçues | 1 par personne distincte, maximum 3/message et 6/jour | 👍 ❤️ 🎉 par défaut; aucun bot ou auto-réaction. Maximum 2 points du même donneur au même destinataire/jour. Plusieurs emojis ou retraits/ajouts ne récompensent pas à nouveau. |
| Entraide validée | 5 par contribution, maximum 15/semaine | Nomination expliquée, validation par un officier qui n'est ni auteur ni bénéficiaire de la nomination. |
| Soirées et défis | Points définis par l'organisateur; 10 suggérés pour une soirée | Réutilise la présence confirmée et la revue de preuves `/community`; une inscription seule ne donne aucun point. |

Les limites journalières suivent le fuseau du serveur (America/Toronto par défaut),
et la semaine commence le lundi. Comptes Discord âgés d'au moins 7 jours et présence
sur le serveur depuis au moins 3 jours par défaut; rôle de saison et accès aux salons
requis. Les officiers peuvent changer `member-days`, les plafonds `messages` et
`reactions`, `voice-minutes` (jamais au-delà de 240), les `emojis` positifs séparés
par virgules et `weekly-goal`. Mettre un plafond à zéro désactive cette source.
Les nouvelles règles ne réinitialisent pas les compteurs déjà consommés.

Une réaction compte uniquement sur un message datant de 2 minutes à 48 heures,
lorsqu'elle est ajoutée. Les réactions trop précoces ou aux anciens messages ne
sont pas rattrapées plus tard. Une récompense acquise reste acquise si la réaction
est ensuite retirée; la réajouter ne donne rien. Les échanges suspects restent
révisables par les officiers. Les comptes alternatifs anciens et la présence réelle
derrière un ordinateur ne sont pas vérifiables automatiquement.

Sans `MESSAGE_CONTENT_INTENT`, les messages sont comptés avec délai et plafond,
mais leur longueur et les doublons de texte sont invisibles. Avec cet accès optionnel,
Guilded ignore les commandes préfixées, les textes très courts/répétitifs, les messages
constitués uniquement de liens/mentions et les doublons normalisés déjà récompensés
ce jour-là. Seules des empreintes SHA-256 sont conservées, pas le texte. Ce filtre
ne juge pas la qualité d'une réponse. Activer le commutateur du Developer Portal
**avant** de définir `MESSAGE_CONTENT_INTENT=true`; aucun nouvel intent privilégié
n'est rendu obligatoire.

## Entraide, reconnaissance et corrections

```text
/participation nominate season:SAISON player:@membre reason:A aidé un nouveau joueur
/participation claims season:SAISON
/participation review season:SAISON id:NOMINATION decision:APPROVE reason:Vérifié
/participation history season:SAISON
/participation history season:SAISON player:@membre
/participation reverse season:SAISON id:GAIN reason:Récompense incorrecte
```

Maximum 3 nominations par auteur/semaine et une nomination par auteur/destinataire/
semaine, même après refus. `claims`, `review`, `settings`, `reverse` et l'historique
d'autrui sont réservés aux officiers. Nominations et motifs sont affichés en privé.
`REJECT` refuse une nomination sans points. Les refus et corrections restent possibles
quand les gains sont en pause. L'auteur et le bénéficiaire ne peuvent pas valider la
nomination, même s'ils sont officiers. Une correction ajoute une
écriture inverse, préserve le gain initial et ne libère pas les plafonds. Un solde
négatif après des dépenses bloque les achats suivants, comme les défis existants.

`status` montre les plafonds du jour, le temps vocal, un badge de palier à 50/150/300
points de saison, les membres ayant le plus de points d'entraide cette semaine et
un objectif collectif de 10 participants distincts/semaine. Toutes les sources de
points communautaires comptent pour les paliers et l'objectif; les annulations sont
déduites. Ces badges sont affichés dans le statut et ne donnent aucun rôle ou droit.
Les défis coopératifs, quiz, loteries à points et soirées réutilisent `/community`.

Créer une saison chaque mois permet un nouveau départ. Fermer ses activités et
traiter les nominations/preuves en attente avant `/community end-season`; les scores
finaux restent figés et consultables. Le passage mensuel se fait par un organisateur,
après revue, et chaque nouvelle saison doit sélectionner ses propres salons.

## Intégrité et livraison

Les compteurs, fractions de tranches vocales, références de récompenses et nominations
sont persistants. Un verrou PostgreSQL partagé avec `/community` sérialise gains,
dépenses, corrections et archives. Les suppressions de messages reçues du Discord
inversent leurs gains et ceux de leurs réactions une fois; une référence de suppression
empêche un gestionnaire retardé de donner des points après la suppression. Les messages
supprimés pendant une panne du bot ne peuvent pas tous être détectés; utiliser la
correction d'officier lorsque nécessaire. Une saison archivée est immuable.

Le vocal est mesuré par les états de connexion, sans rejoindre un vocal ni enregistrer
l'audio. Un checkpoint toutes les 30 secondes et à chaque changement de vocal/membre
crédite le dernier intervalle admissible; l'éligibilité est recalculée pour tous les
participants concernés. Une panne, reconnexion, changement de configuration ou pause
de plus de 90 secondes redémarre une observation sans créditer le temps non observé.
Les fractions déjà enregistrées et plafonds du jour survivent aux redémarrages.

Migration additive `20261030090000_community_participation` : configuration, compteurs
quotidiens, nominations et références de suppression. Les sauvegardes génériques
incluent ces tables; elles suivent la cascade de suppression d'une guilde/saison.
Les intents non privilégiés GuildMessages, GuildVoiceStates et GuildMessageReactions
sont demandés; Message Content reste optionnel. Aucune nouvelle dépendance.

Vérifier les quatre commandes obligatoires d'AGENTS.md. Le contrôle PostgreSQL existant
inclut `scripts/verify-participation-postgres.ts` : concurrence, doublons, limite de
240 minutes, nominations/annulations, suppression avant/après gain, rollback, isolation
et restauration. PostgreSQL/Windows CI et le processus de sauvegarde/déploiement de
`V5_0_RELEASE_HANDOFF.md` restent requis. Ne jamais lancer un deuxième bot.

Essais Discord réels avant activation : deux humains en vocal, un départ, changement
de salon, assourdissement, AFK, personne muette, bot et membre seul; redémarrage et
reconnexion; messages rapprochés/doublons, réaction personnelle/multiple, retrait/
réajout, suppression; nomination/refus/validation/correction et membre sans rôle;
contrôle des totaux dans `/community wallet` et archive après traitement des demandes.
