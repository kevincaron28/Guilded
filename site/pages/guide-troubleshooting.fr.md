<p class="eyebrow">JOUEURS ET OFFICIERS</p>

# Dépannage

WoW n’enregistre les données de l’addon que si vous tapez `/reload` ou vous déconnectez. Essayez ça en
premier, puis laissez le compagnon synchroniser.

## L’addon

- **Absent de la liste des addons :** [vérifiez le dossier d’installation](/guide/install/?lang=fr) et
  cochez les addons périmés.
- **Une erreur ou un message d’action bloquée :** tapez `/guilded diag`, copiez le texte et envoyez-le
  avec `/report bug` sur Discord.

## Le compagnon

- **World of Warcraft introuvable :** appuyez sur **Choisir le dossier** et prenez le dossier qui
  contient `_forever_`.
- **La dernière synchronisation ne change pas :** tapez `/reload` en jeu, puis appuyez sur
  **Synchroniser maintenant**.
- **Une ligne est rouge ou orange :** appuyez sur le bouton à côté, ou ouvrez **Avancé** et appuyez sur
  **Réparer**. **Copier le rapport d’assistance** copie les détails à nous envoyer.

## Personnages et classements

- **Un personnage n’est pas lié :** envoyez au bot Guilded son nom complet (Prénom Nom) en message
  privé, ou voyez [Lier votre personnage](/guide/link-character/?lang=fr).
- **Il manque un donjon :** faites `/reload` après le donjon ; votre compagnon, ou celui d’un membre du
  groupe, l’envoie. En jeu, `/guilded dungeon` dit pourquoi un parcours reçu ne compte pas encore.

## Officiers

- **Les données de raid ne sont pas sur Discord :** un officier tape `/reload`, le compagnon
  synchronise, puis regardez `/setup import held`.
- **Le bot reste muet ou ne peut pas publier :** `/setup start status:true` et
  `/setup system permissions`.

[Aide à la configuration](/docs/AI_SETUP_HELP.html) · [Demander sur Discord ↗](https://discord.gg/YjzFwtP64V)
