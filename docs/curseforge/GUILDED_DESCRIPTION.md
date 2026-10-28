# Guilded — connected guild tools

Record raid attendance, manage EP/GP and loot, find guild crafters and review your dungeon history. Start with the addon alone. Discord and the companion are optional.

**For WoW Forever, Classic Era / Hardcore, Burning Crusade Classic, Mists of Pandaria Classic and Retail. English, French, German and Spanish included in the addons. The companion, website and bot remain English/French.**

## 8.0.2 launch safety patch

The final audit corrected spreadsheet exports so formula-like text stays literal, and bounded the matching bot's participation summaries. All 8.0 features and existing data are retained.

All 1,052 catalogued addon strings are translated in French, German and Spanish. Includes the 8.0 security, lossless ledger compaction, versioned Retail overtime scoring and privacy improvements. Existing points, rosters, SavedVariables and frozen season rules are preserved.

Choose the matching edition file. One Windows companion supports all editions with separate profiles; one Discord server can host several guilds and editions. Forever characters display their first and last names. Classic and Retail include dungeon routes and provisional benchmarks; Retail includes native Mythic+ evidence and a separate Raider.IO-inspired Guilded rating.

[All edition downloads, Windows companion and release notes](https://github.com/kevincaron28/Guilded/releases/tag/v8.0.2). Real-client and two-PC checks remain pending follow-up. Benchmarks and Guilded ratings are provisional, not official Raider.IO or Blizzard scores. Enable Load out of date AddOns if requested by your client.

## Install and start

1.  Download a Release file from this project's Files tab.
2.  Close WoW and put the **Guilded** folder in your actual client's `Interface/AddOns` folder. Check `Guilded/Guilded.toc` exists without an extra nested folder.
3.  Enable Guilded, log in and click the gold minimap coin, or use `/guilded`.
4.  Stay in **In-game only** mode if you do not want Discord. `/reload` saves your data.

Keep SavedVariables when upgrading. Downloading and using the addon alone does not require joining a Discord server or installing a companion.

[Installation and troubleshooting / Installation en français](https://guilded.kcaron.top/docs/MEMBER_INSTALL)

## A practical raid-night toolkit

*   Record attendance, bench credit, boss kills and raid notes; review your raid summary.
*   Manage EP/GP and loot history. Officers can share local standings with online guildmates.
*   Choose GP bidding, loot council, soft reserves or EPGP priority with configured prices.
*   Review available gear, enchant, durability and consumable information. Shared data depends on participating players and the client's APIs.
*   Share learned recipes, look for guild crafters, track supported profession cooldowns and use the guild map.
*   Record dungeon runs and view available local scores without Discord. Verified online seasonal ratings require optional synchronization.

**New in 7.0 and 7.1:** monthly dungeon seasons starting with the 4 November release, weekly and monthly dungeon leaderboards (a Week / Month switch in the score panel), level brackets (15-29, 30-44, 45-59, 60), and `/guilded sheet` to copy standings, loot, attendance, raids or dungeon scores into Excel or Google Sheets. Public leaderboards and guild recruitment are on [guilded.kcaron.top](https://guilded.kcaron.top/leaderboards/). Players without a guild can use the small standalone **Guilded Dungeons** addon (separate download on GitHub).

[EPGP and loot workflow / Guide EPGP](https://guilded.kcaron.top/docs/EPGP_GUIDE)

## Optional Windows companion

The free [Microsoft Store companion](https://apps.microsoft.com/detail/9N680XX3QFL9) is Store-signed and receives updates through Microsoft Store. The optional standalone GitHub EXE remains separately unsigned. Use one connection profile per guild and edition.

## Optional Discord integration

Use signups, core rosters, shared rules/prices, recruitment listings and reports in your guild's Discord. A server that adds the hosted bot starts on **Guilded Lite** right away (setup, help, FAQ, bug reports, dungeon groups and basic raid signups); KCaron's approval unlocks everything else. Independent hosting is also available.

Run `/setup start`. Use **Sign in with Discord** in the companion and enter its displayed confirmation code on the sign-in page. Each member connects their own account and chooses their server. Private `/character pair` codes remain available for supported fallback setups. The Windows companion can watch saved data and export CSV files; the browser companion supports manual synchronization. Reload WoW before syncing and again after loading returned standings.

[Request pilot access](https://guilded.kcaron.top/docs/HOSTED_PILOT) · [Online companion](https://guilded.kcaron.top/companion/)

## Release and feature boundaries

Current release: **Guilded 8.0.2** (28 October 2026), also on [GitHub](https://github.com/kevincaron28/Guilded/releases). Check the exact file version in its own store. Interface declarations alone do not establish support for every WoW client or every protected-action scenario.

**Party/roll games are in the separate optional Guilded Games Alpha**, not the current Guilded addon. No game awards gold or EP/GP. Raid markers, tank marking and boss plans are outside this Guilded toolkit. Real-client acceptance remains documented per feature, and full real-raid acceptance is not yet proven; an automated pass is not a completed live raid trial.

Screenshots in the gallery have character and guild identifiers redacted. Older interfaces and development previews are illustrations of the labeled state; an idle screen does not prove a raid, bid or sync completed.

## Help & feedback / Aide et retours

[Join K Caron Projects on Discord](https://discord.gg/YjzFwtP64V) for Guilded support, bug reports and feature ideas. English and French welcome; no GitHub account required. Include your addon and game versions, steps to reproduce and redacted errors. Support is public by default; do not post pairing codes, tokens or full private configuration files.

[Rejoignez K Caron Projects sur Discord](https://discord.gg/YjzFwtP64V) pour l’aide, les signalements et les idées. Français et anglais bienvenus, sans compte GitHub. Précisez vos versions, les étapes à reproduire et les erreurs utiles. L’aide est publique par défaut : ne publiez ni code de jumelage, ni jeton, ni fichier privé complet.

## Optional coffee support

Guilded and approved pilot access are free. If the project helps your guild, [Buy me a coffee · CA$3](https://ko-fi.com/wowguilded) supports development, hosting, backups and maintenance. Review the amount, currency and any repeating payment on Ko-fi. Support buys no approval, priority, permissions or guaranteed uptime.

[K Caron Projects](https://kcaron.top/) · [Guilded guides](https://guilded.kcaron.top/docs/QUICK_START) · [GitHub issues (optional)](https://github.com/kevincaron28/Guilded/issues)

## Français

La version 8.0.2 protège les textes ressemblant à des formules dans les exports vers les tableurs et limite les résultats des résumés de participation du bot. Toutes les fonctions 8.0 et les traductions sont conservées. Conservez vos SavedVariables.

Guilded réunit présence aux raids, EP/GP, butin, recettes de guilde et historique de donjons pour **WoW Forever, Classic Era / Hardcore, Burning Crusade Classic, Mists Classic et Retail**, avec interfaces française, anglaise, allemande et espagnole dans les addons. Le compagnon, le site et le bot restent en français et en anglais. Installez le dossier **Guilded** dans `Interface/AddOns`, ouvrez la pièce dorée et faites `/reload`. **L'addon seul ne nécessite ni Discord, ni compagnon.**

Les officiers peuvent publier les classements locaux. Choisissez votre core, vos règles et votre méthode de butin avant les attributions. Le [guide EPGP en français](https://guilded.kcaron.top/docs/EPGP_GUIDE#fr) décrit les vérifications.

Discord est facultatif. Un serveur qui ajoute le bot hébergé démarre en **Guilded Lite** (configuration, aide, FAQ, signalements, groupes de donjon et inscriptions de raid simples); l'approbation de KCaron débloque le reste. Ensuite : /setup start, puis **Connexion avec Discord** dans le compagnon. Chaque membre saisit le code de confirmation affiché et choisit son serveur. Les codes personnels /character pair restent disponibles en solution de repli. Nouveautés 7.x : saisons de donjon mensuelles dès le 4 novembre, classements hebdomadaires et mensuels, recrutement et classements publics sur guilded.kcaron.top, et l'addon autonome Guilded Dungeons.

Les contrôles Retail de chargement et d’interface française sont enregistrés ; les scénarios de jeu et les échanges sur deux PC restent des suivis explicitement dispensés avant publication. Les tests automatisés et une démonstration Discord ne constituent pas un essai complet en raid réel.

Les jeux sont désormais dans **Guilded Games**, un addon Alpha séparé et facultatif. [Offrez-moi un café · 3 $ CA](https://ko-fi.com/wowguilded) est un soutien entièrement facultatif, sans priorité ni accès supplémentaire.

Free for noncommercial use under PolyForm Noncommercial 1.0.0. Independent project; not affiliated with or endorsed by Blizzard Entertainment.
