# Acceptation des règles avec Guilded

La transition de Carl-bot conserve les rôles existants : Exilé à l'arrivée,
puis Errant après lecture et acceptation des règles. Le propriétaire a choisi
de retirer `MentionEveryone` et `ManageGuildExpressions` d'Errant. Les autres
permissions et les rôles déjà attribués sont conservés.

`/setup selfroles title:Acceptation des règles role1:@Errant requires:@Exilé`
publie un panneau dont chaque bouton exige le rôle préalable. Un second clic
retire le rôle, comme le retrait d'une réaction Carl-bot. Sans `requires`, les
panneaux existants continuent de fonctionner. Le contrôle relit le membre,
les permissions du rôle et la position du bot à chaque clic; les réponses
utilisent la langue du serveur. Les rôles de gestion restent interdits.

La transition réelle doit sauvegarder les permissions et le panneau Carl-bot,
publier et tester le bouton Guilded dans le salon de règles existant, puis
désactiver le panneau Carl-bot. Ne pas modifier le texte des règles, retirer
des rôles aux membres existants, ni créer un rôle Errant en double.

Aucune migration, modification de protocole ou nouvelle permission du bot.
Version conservée : 5.0.0. Les quatre contrôles locaux et la CI PostgreSQL/Windows
restent obligatoires avant de mettre à jour le service existant.
