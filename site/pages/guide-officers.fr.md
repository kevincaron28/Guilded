<p class="eyebrow">OFFICIERS · ENVIRON 15 MINUTES</p>

# Officiers

Gérez votre guilde en jeu avec l’addon seul, ou ajoutez le [bot Discord](/guide/discord-bot/?lang=fr)
pour les inscriptions aux raids, les classements et les sondages dans votre serveur.

## Mettre en place

1. **Ajoutez le bot** (facultatif) et lancez `/setup start` dans Discord : langue, fuseau horaire,
   rôles et salons. `/setup start status:true` montre ce qui manque. Placez le rôle de Guilded au-dessus
   des rôles qu’il doit donner.
2. **Demandez aux membres d’[installer l’addon](/guide/install/?lang=fr).**
3. **Lancez le [compagnon](/guide/companion/?lang=fr)** sur le PC d’au moins un officier : les membres
   qui n’ont que l’addon rejoignent Discord par la synchronisation d’un officier.
4. **Réglez les cores et les prix** avec `/core setup`, `/core edit` et `/core items`. Le
   [guide EP/GP](/guide/epgp/?lang=fr) explique les règles.
5. **Rendez la guilde publique quand vous êtes prêts :** `/mod page create`, puis `/mod page publish`.
   Ouvrez le recrutement avec `/mod recruit set`.

## Les outils de tous les jours

| Tâche | Commande |
| --- | --- |
| Planifier un raid | `/lead create` · [Guide de la soirée de raid](/guide/raid-night/?lang=fr) |
| Lier le personnage d’un membre | `/officer character link` · `/officer character unclaimed` |
| Demandes d’invitation et rangs | `/mod invites list` · `/mod rankroles set` · `/officer promotion rule` |
| Réviser les données de l’addon | `/setup import held` · `/setup import apply` |
| Demandes à la banque de guilde | `/officer bank list` · `/officer bank handle` |
| Sondages et activités | `/organize poll create` · `/organize quiz` |

Les membres ne voient pas `/officer`, `/lead`, `/organize`, `/mod`, `/setup` ni `/config`. Un officier
sans « Gérer le serveur » non plus : autorisez le rôle d’officier sur ces commandes dans Paramètres du
serveur → Intégrations → Guilded.

[Toutes les commandes](/reference/?lang=fr) · [Dépannage](/guide/troubleshooting/?lang=fr) ·
[Notes pour le propriétaire](/docs/GUILD_OWNER_SETUP.html)
