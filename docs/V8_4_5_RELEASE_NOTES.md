# Guilded 8.4.5 — announcements, duels and the guild message assistant

Everything below is new since 8.4.4. Protocol stays 2, so older addons and companions keep
working with the bot.

**What is new**
- **Milestone announcements in guild chat.** The addon can cheer level steps, first
  dungeon clears, honorable-kill milestones and duel wins in guild chat. It is on by default
  (you see a one-time notice); type `/guilded announce off` to turn it off for yourself, and
  officers have a guild-wide off switch.
- **New achievements**: dungeon, duel streak, top duelist, honorable kills and duel wins, shown in the addon, in Discord and on the website.
- **Duel leaderboard.** Win duels against guildmates and climb the ladder: see it in the
  addon's Duels tab, in Discord and on the website.
- **Guild message assistant.** WoW does not let addons set the guild message of the day, so the
  assistant gives you a reminder and a copy box. Copy the message and paste it into the game
  yourself (the `/gmotd` chat command). It is opt-in for officers.
- **Fixes.** Availability and scrolling in the guild window are fixed, an
  Announcements page keeps these settings in one place, and a debug scroll command helps us
  track down any remaining scroll problem.

**Updating**
1. Update the Guilded addon (CurseForge, or the zip for your edition from GitHub Releases).
   Update the Guilded Companion if you have it (the new achievements need the new build), or
   install it from the Microsoft Store.
2. Open the companion and choose **Sign in with Discord**. If a character is missing, run
   `/character claim` in Discord. No Windows PC? Use `/guilded verify` in the game.
3. Officers: your Discord bot is updated by the host; no action for guild members.

Duels and announcements were checked on one account in game; the first real two-player guild
test is still to come, so tell us if anything looks off with `/report bug`.

## En français (Québec Gold)

- **Annonces d'étapes dans le chat de guilde**, activées par défaut. Tapez `/guilded announce off`
  pour les désactiver pour vous.
- **Nouveaux succès** et **classement des duels** (onglet Duels, Discord et site web).
- **Assistant de message de guilde** : WoW ne permet pas aux addons de définir le message de
  guilde, alors l'assistant propose un texte et une boîte à copier. Copiez-le et collez-le
  vous-même dans la fenêtre d'information de guilde.
- **Corrections** : ligne du dimanche de la carte de disponibilité et défilement dans la fenêtre de guilde.
- **Mise à jour** : mettez à jour l'addon et le Guilded Companion, puis « Se connecter avec Discord ».
  Si un personnage manque, utilisez `/character claim`. Sans PC Windows : `/guilded verify` en jeu.

Status is tracked in [the acceptance checklist](V8_4_5_RELEASE_ACCEPTANCE.md).
