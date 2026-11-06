# Guilded 8.4.6 — ledger sync, duel board and Forever focus

Everything below is new since 8.4.5. Protocol stays 2, so older addons and companions keep
working with the bot.

**What is new**
- **Guildmates share the ledger.** Your addon now passes standings and loot ledger entries to
  guildmates directly, so a member who was offline catches up from other members, not only from
  an officer. It is on by default and an officer's announcement authorizes it (entries are
  checked against a fingerprint). Type `/guilded ledgersync off` to turn it off for yourself.
  Limit: a member who missed an officer's announcement waits for an officer.
- **Live duel board in Discord.** The PvP stats channel shows a live "Duels de la guilde" board,
  and the dungeon panel is refreshed for Season 1.
- **Companion fix.** The companion now always watches the account-level saved-data folder, which
  fixes members whose companion watched a single character's folder. If you have several game
  accounts it asks which one, shows one clear message, and ignores empty profiles quietly.
- **No more blocked actions in combat.** Closing the Guilded panel or opening its chat tab in
  combat is now held until combat ends, so WoW no longer blocks the action.
- **Compact "Crafted by" tooltip.** Item tooltips show a short crafter list; hold Shift for the
  full list. The setting is Off, Compact or Full.
- **Forever focus.** While we concentrate on WoW Forever, the other WoW editions are hidden
  (old links go to Forever) and Path of Exile 2 tracking is removed from the companion and the
  achievements. The PoE2 Discord channels, roles, events and seasons stay, and nothing already
  published is deleted.

**Updating**
1. Update the Guilded addon from CurseForge (Forever) or the Forever zip from GitHub Releases.
   Update the Guilded Companion if you have it, or install it from the Microsoft Store.
2. Open the companion and choose **Sign in with Discord**. If a character is missing, run
   `/character claim` in Discord. No Windows PC? Use `/guilded verify` in the game.

Ledger sync was not yet tested with three real clients, so tell us if standings look wrong with
`/report bug`.

## En français (Québec Gold)

- **Les membres partagent le registre.** Votre addon transmet le registre aux autres membres, pour
  rattraper un retard sans attendre un officier. Activé par défaut; `/guilded ledgersync off`
  pour le désactiver. Limite : un membre qui a manqué l'annonce d'un officier attend un officier.
- **Tableau des duels en direct** dans le canal de stats JcJ de Discord.
- **Correctif du Companion** : il surveille toujours le dossier de données du compte (plus le dossier d'un seul personnage).
- **Plus d'actions bloquées en combat** : la fermeture du panneau et l'onglet de clavardage attendent la fin du combat.
- **Infobulle « Fabriqué par » compacte** (Maj pour la liste complète).
- **Focus WoW Forever** : les autres versions de WoW sont masquées et le suivi PoE2 est retiré du Companion (la communauté PoE2 sur Discord reste).
- **Mise à jour** : mettez à jour l'addon et le Guilded Companion, puis « Se connecter avec Discord ».
  Si un personnage manque, utilisez `/character claim`. Sans PC Windows : `/guilded verify` en jeu.

Status is tracked in [the acceptance checklist](V8_4_6_RELEASE_ACCEPTANCE.md).
