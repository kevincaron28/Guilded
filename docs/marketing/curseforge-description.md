# CurseForge description: "Sync with Discord in 2 minutes"

For the **Guilded** project (1712677) and the **Guilded Dungeons** project (1754138). Paste the
section you want into the project description (CurseForge, project page > **Edit Project** >
**Description**; the editor takes Markdown, or use "Source" for HTML). Put it near the top, right
after the one-paragraph summary.

**This cannot be automated.** `scripts/curseforge-upload.mjs` only calls the file-upload endpoint
(`POST /projects/{id}/upload-file`). CurseForge's upload API has no call to change a project
description, so the coordinator pastes this text by hand. Keep it in step with the addon's
`Util.lua` `companionSteps()` and the website page `site/pages/companion.md`.

Facts used below (9.1.0, zero-setup companion): Windows only; free; Microsoft Store listing
"Guilded Companion" (app id 9N680XX3QFL9); direct installer
`https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe`; page
`https://guilded.kcaron.top/companion/`. It finds WoW, picks the Discord server from the in-game
guild, starts with Windows. Signing in with Discord is optional (it only confirms characters).

---

## English: Guilded (project 1712677)

### Sync with Discord in 2 minutes

The addon works on its own in game. To send your data to your guild's Discord and the website, add
the free **Guilded Companion** (Windows only):

1. **Download it.** Search **Guilded Companion** in the Microsoft Store, or get the installer from
   https://guilded.kcaron.top/companion/
2. **Run the installer.** It finds World of Warcraft and your guild's Discord server by itself.
   There is nothing to choose.
3. **Keep it open.** It starts with Windows and sits in the tray. Type `/reload` in game (or log
   out) and your data syncs.

Signing in with Discord is **optional**: it only confirms your characters and unlocks your personal
page and Discord messages. In game, `/guilded companion` shows these steps and a link you can copy,
and Guilded > Home has a **Get the companion** button.

## English: Guilded Dungeons (project 1754138)

### Sync with Discord in 2 minutes

Guilded Dungeons records your dungeon runs in game. To send them to Discord and the public
leaderboards, add the free **Guilded Companion** (Windows only):

1. **Download it.** Search **Guilded Companion** in the Microsoft Store, or get the installer from
   https://guilded.kcaron.top/companion/
2. **Run the installer.** It finds World of Warcraft and your guild's Discord server by itself.
3. **Keep it open.** It starts with Windows. Your runs are sent when you `/reload` or log out.

Signing in with Discord is **optional**: it only confirms your characters. In game,
`/gdungeons companion` shows these steps and the link.

---

## Français : Guilded (projet 1712677)

### Synchronisez avec Discord en 2 minutes

L'addon fonctionne seul en jeu. Pour envoyer vos données au Discord de votre guilde et au site,
ajoutez le **Guilded Companion** gratuit (Windows seulement) :

1. **Téléchargez-le.** Cherchez **Guilded Companion** dans le Microsoft Store, ou prenez
   l'installateur sur https://guilded.kcaron.top/companion/?lang=fr
2. **Lancez l'installateur.** Il trouve World of Warcraft et le serveur Discord de votre guilde
   tout seul. Il n'y a rien à choisir.
3. **Laissez-le ouvert.** Il démarre avec Windows et reste dans la zone de notification. Tapez
   `/reload` en jeu (ou déconnectez-vous) et vos données se synchronisent.

La connexion avec Discord est **facultative** : elle sert seulement à confirmer vos personnages et à
débloquer votre page personnelle et les messages Discord. En jeu, `/guilded companion` affiche ces
étapes et un lien à copier, et Guilded > Accueil a un bouton **Obtenir le compagnon**.

## Français : Guilded Dungeons (projet 1754138)

### Synchronisez avec Discord en 2 minutes

Guilded Dungeons enregistre vos donjons en jeu. Pour les envoyer à Discord et aux classements
publics, ajoutez le **Guilded Companion** gratuit (Windows seulement) :

1. **Téléchargez-le.** Cherchez **Guilded Companion** dans le Microsoft Store, ou prenez
   l'installateur sur https://guilded.kcaron.top/companion/?lang=fr
2. **Lancez l'installateur.** Il trouve World of Warcraft et le serveur Discord de votre guilde
   tout seul.
3. **Laissez-le ouvert.** Il démarre avec Windows. Vos donjons partent quand vous faites `/reload`
   ou vous déconnectez.

La connexion avec Discord est **facultative** : elle sert seulement à confirmer vos personnages. En
jeu, `/gdungeons companion` affiche ces étapes et le lien.
