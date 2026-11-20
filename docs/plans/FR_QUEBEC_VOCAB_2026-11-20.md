# Québécois vocabulary pass, 20 November 2026

Owner request: the bot's French should read like natural Québec French. The register stays "vous".
The existing text was already close (clavardage, bogue, gang, MP, raideur, jumelage, « en tout temps »,
spacing before `?`), so this pass is a set of targeted swaps, not a rewrite. No keys, placeholders,
command names, dungeon names or markdown changed.

| Before | After | Where | Why |
| --- | --- | --- | --- |
| chat (de guilde, WoW, communautaire) | clavardage | onboarding panel and guide (`src/i18n.ts`), setup summary (`src/i18n-fr.ts`), community channel topic (`src/setup-names.ts`), website features and Québec Gold pages, addon `Locale.lua` (quiet login, chat-line texts, main-name display) | OQLF term; the website and achievements already use it |
| postez / posté (in-game mail, chat line) | envoyez par courrier / publié | addon `Locale.lua` (crafting orders, call-for-help texts) | "poster" is the European sense |
| appli | application | onboarding link steps, mobile map notice | register and OQLF |
| Pas de souci | Pas de problème | link DM | European idiom |
| envoi(s) (companion uploads) | téléversement(s) | auto-apply labels, roster freshness lines (`src/i18n-fr.ts`) | OQLF term for "upload" |
| gear / leveling (channel topics) | équipement / montée de niveau | `src/setup-names.ts` | the rest of the text already says équipement and montée de niveau |
| La semaine prochaine est à vous ! | La semaine prochaine, c’est votre tour, la gang ! | weekly honors (celebration line) | light line only |
| Bienvenue sur {guild} | Bienvenue dans la gang de {guild} | welcome message (celebration line) | light line only |
| tu forms (badge DM, polish-community topics) | vous | `community-badge-delivery.ts`, `scripts/polish-community.ts` | owner's vous decision |

Searched and found nothing to change: courriel/e-mail, week-end/fin de semaine, magasiner, balado,
infolettre, mot de passe, "20 novembre" style dates. "Courrier" stays for the in-game mail (it is
the WoW French term). "Pseudo" stays: it is Discord's own French word (« Gérer les pseudos »).

Left on purpose, for the owner to decide:
- The channel name `chat-communauté` (renaming creates a duplicate on servers that already have it).
- "companion" kept in English inside some addon French lines.
