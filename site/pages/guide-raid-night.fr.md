<p class="eyebrow">OFFICIERS · UNE SOIRÉE DE RAID</p>

# La soirée de raid

Une page pour l’officier qui mène le raid : avant, pendant et après. Les règles de butin sont dans le
[guide EP/GP](/guide/epgp/?lang=fr).

## Avant

1. **Une fois :** `/core setup` crée le core de raid et ses soirées de la semaine.
2. **Publiez le raid :** `/lead create`, avec une heure comme `vendredi 20h`. Les membres s’inscrivent
   avec les boutons de l’annonce. `/raid roster` montre qui vient.
3. **Vérifiez la préparation :** `/lead readiness-raid` montre qui est prêt pour ce soir.
4. **Réservations (si vous en utilisez),** en jeu : un officier tape `/guilded reserve open`. Les membres
   tapent `/guilded reserve` suivi d’un lien d’objet (Maj + clic), ou chuchotent `res` et le lien à cet
   officier. C’est le jeu de cet officier qui garde la liste, il doit donc être en ligne. Tapez
   `/guilded reserve lock` au début du raid.
   Tant que la liste est ouverte, les membres peuvent aussi demander avec `/loot reserve` sur Discord ou
   dans l’application ; la demande est ajoutée au prochain `/reload` de cet officier.
5. **Mettez tout le monde à jour :** l’addon et le compagnon doivent être à la version courante.

## Pendant

1. En jeu, `/guilded start` avec un titre enregistre les présences, le butin, les EP et les GP.
   `/lead start` indique sur Discord que le raid est commencé.
2. Notez les présents avec `/guilded attendance group`, et les boss vaincus avec `/guilded boss` suivi du
   nom du boss.
3. Butin : suivez la méthode de votre guilde. Avec les réservations, `/guilded reserve who` suivi de
   l’objet montre qui l’a réservé, `/guilded reserve roll` lance les dés entre eux, et
   `/guilded reserve award` note le gagnant.
4. Enchères de butin sur Discord : `/lead loot auction`. Elle se ferme d’elle-même à la fin du temps
   prévu ; `/lead loot close` la termine plus tôt.

## Après

1. En jeu, `/guilded end`, puis `/reload` (ou déconnectez-vous) pour enregistrer les données. Le
   compagnon les envoie.
2. Si votre serveur révise d’abord les données de l’addon, regardez `/setup import held`.
3. Sur Discord, `/lead end` ferme le raid et propose les EP à approuver.
4. Reliez le journal de combat avec `/lead wcl-report`, et partagez `/raid report`.

## Liste pour la première soirée

- Un officier tient la liste de butin et reste en ligne avec l’addon activé.
- Au moins un officier fait tourner le compagnon.
- Après le premier boss, `/guilded diag` ne montre aucun problème. Sinon, envoyez-le avec
  `/report bug`.
