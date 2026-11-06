# Guilded 8.4.7 — dungeon runs count on Forever, and the companion updates itself

Everything below is new since 8.4.6. Protocol stays 2, so older addons and companions keep
working with the bot.

**What is new**
- **Dungeon runs now complete and count on Forever.** The addon only knew the final bosses of
  Deadmines and Hall of Thanes, so other Forever dungeon runs ended as "abandoned" and did not
  count for Season 1. It now recognises the Forever final bosses. **Runs you already did that
  hold a final-boss kill are recovered at your next login after updating**, and the bot upgrades
  them for you.
- **The companion updates itself** (direct-download version). It checks GitHub in the
  background, verifies the download, and installs quietly when you close the companion, with no
  window to click through. The Microsoft Store version is still updated by the Store. Settings has
  "Install updates automatically" if you prefer to turn it off.
- **A stable download link** for the Windows companion that always points at the newest release:
  https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe
  A new two-choice companion page on the website explains Store versus direct download.

**Updating**
1. Update the Guilded addon (and Guilded Dungeons) from CurseForge (Forever) or the Forever zips
   on GitHub Releases, then log in once so your earlier runs are recovered.
2. Companion: Store users get the update from the Store. If you installed the companion directly,
   this is the **one last time you update by hand** (press "Update now" in the companion or use the
   link above); from this version on it updates itself.
3. Open the companion and choose **Sign in with Discord** if you have not yet. If a character is
   missing, run `/character claim` in Discord. No Windows PC? Use `/guilded verify` in the game.

## En français (Québec Gold)

- **Les donjons comptent maintenant sur Forever.** L'addon reconnaît les derniers boss des
  donjons Forever (avant, seuls Deadmines et Hall of Thanes étaient connus, donc les parties
  finissaient « abandonnées »). **Les parties déjà jouées avec un dernier boss tué sont
  récupérées à votre prochaine connexion après la mise à jour.**
- **Le Companion (téléchargement direct) se met à jour tout seul**, en silence, à la fermeture. La
  version Microsoft Store est mise à jour par le Store. Si vous l'avez installé directement, c'est la
  dernière mise à jour manuelle (« Mettre à jour maintenant » ou le lien ci-dessus).
- **Lien de téléchargement stable** vers la dernière version du Companion.
- **Mise à jour** : mettez à jour l'addon, ouvrez le jeu une fois, puis « Se connecter avec Discord » si besoin.
  Si un personnage manque, utilisez `/character claim`. Sans PC Windows : `/guilded verify` en jeu.

Status is tracked in [the acceptance checklist](V8_4_7_RELEASE_ACCEPTANCE.md).
