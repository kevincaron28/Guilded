# Google Play store listing — Guilded

The text to paste into Play Console. Its home in Play Console is **Grow users → Store presence → Main store listing**.
Character counts were checked against Play's limits (see the table at the end). The step-by-step guide is
[docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md). The data-safety answers are in
[play-data-safety.md](play-data-safety.md), and the content-rating answers are in [play-content-rating.md](play-content-rating.md).

This listing describes the five-tab app without Guilded Clash (the card game is on hold and is not in the Play build).
The texts below are the search-friendly rewrite of 27 November 2026 (Testers Community ASO report, score 56/100 for
the earlier text). **Send them for review together with the 0.7.0 build, not before:** two lines describe things that
are in the code but not in the 0.6.0 build testers have (asking for a soft reserve from the phone, and cancelling a
craft request). Screenshot sizes and what each one must show: [play-screenshots.md](play-screenshots.md). The Play
Console steps for the closed test: [play-console-checklist.md](play-console-checklist.md).

## The name

| Language | App name (30 max) |
| --- | --- |
| English (en-CA) | `Guild Sync Companion for WoW` |
| French (fr-CA) | `Guild Sync Companion pour WoW` |

The label under the phone icon stays `Guilded` (from `name` in `mobile/app.json`; owner decision), and the package id
stays `top.kcaron.guilded`.

- **Changed on 27 November 2026.** The owner asked for the search words "WoW guild companion" in the title. "for WoW"
  says the app works with the game without presenting itself as the game's own app. "Guild Sync: WoW Guild Companion"
  would hold the exact phrase but is 31 characters.
- **This replaces the 15 November rule** that kept "WoW" out of the title. The risk behind that rule is unchanged: Play
  can refuse a title that uses another company's trademark. If it does, go back to `Guild Sync Companion` (both
  languages) and keep the rest of the text; the description may name the game, with the disclaimer. Keep "World of
  Warcraft" and "WoW" out of the icon and the artwork.
- **Not allowed:** `Guilded Companion` (the Microsoft Store refused it on 3 November 2026, naming rule 10.1.1.1) and
  plain `Guilded` (another app of that name is on Play).
- The Windows companion keeps its Microsoft Store name, `Guild Sync Companion`.

## App details

| Field | Value |
| --- | --- |
| Default language | English (Canada) – en-CA (what the existing Play app was created with; the English text below goes there) |
| Translation | French (Canada) – fr-CA (text below) |
| App or game | App |
| Free or paid | Free |
| Category | **Entertainment**. Not Social: on 15 November 2026 choosing Social made Play ask for a "Child safety standards" declaration ("Apps within the dating and social categories must meet these requirements"). The app has no chat, no posting between users and no feed of user content, so that declaration does not describe it; with Entertainment Play does not ask for it. |
| Tags (pick up to 5 in Console) | none chosen yet; pick only from the tags Console offers for Entertainment that fit a guild companion |
| Contains ads | No |
| In-app purchases | None |
| Contact email | `support@guildedwow.com` (Cloudflare Email Routing to the owner; Play shows it publicly) |
| Website | https://guildedwow.com |
| Privacy policy | https://guildedwow.com/docs/PRIVACY (live, HTTP 200 on 8 Nov 2026; `/privacy` is a 404, so do not use it) |
| Account deletion URL | https://guildedwow.com/delete-my-data/ (public page: the Discord command and the support community, readable without signing in; in the app the button is under Me → Settings → Delete my data). The website is retiring its account pages: if its public deletion page gets its own address, use that one. |

## English (en-CA in Play Console)

**Short description** (80 max):

```
Follow raids, crafting, maps and rankings with your WoW guild companion app.
```

**Full description** (4,000 max):

```
Guild Sync Companion is a WoW guild companion for guilds that use the Guilded Discord bot. Stay organized and close to your guild when you are away from your computer: answer raid signups, find a crafter, see where guildmates were last seen and follow the leaderboards from your phone.

WHY USE IT
• Save time: check the next raid and answer it in a few taps.
• Stay on schedule: get reminders before raid night.
• Help each other: know when a guildmate calls for help in game.
• Find a crafter: search an item and ask someone in your guild to make it.
• Check it without a signal: your last guild screens and leaderboards stay on the phone.

RAIDS AND LOOT
• Next raid: the time, who signed up and the raids coming in the next weeks.
• Sign up with I'm in, Maybe or Can't come and your role. The rules of your Discord signup apply, including role limits, the waiting list and the deadline.
• EP/GP standings, with your own characters shown first.
• Soft reserves: see the list and ask for an item while the loot keeper's list is open.
• Wishlist: save the items you want, in order of priority.

GUILD LIFE
• Roster: your characters with class, level, guild rank and raid core.
• Activity: the last 14 days, with joins and departures, rank changes, guild bank gifts and raid boss kills.
• Crafting: see who can make an item, set a quantity, add a note, then follow or cancel your open requests.
• Guild map: where guildmates were last seen outdoors, a heat map of where your guild plays, and recent calls for help with the time and the attackers. Only signed-in members of your guild see it. You can stop sharing your position at any time, which deletes it.

YOUR CHARACTERS
• A page for each character: dungeon ranks, recent runs and duel record.
• Choose your main character.
• See what you still need for a promotion, where your server uses promotion rules.
• Badge album: one card for each achievement you earned. No packs and no luck involved.

LEADERBOARDS AND NEWS, NO SIGN-IN NEEDED
• This week's rated dungeon runs and the best runs.
• Public dungeon leaderboards for characters and guilds, by season.
• The duel ladder and raid progress.
• World of Warcraft headlines with links to the publisher's site and to Blizzard news.

ALERTS YOU CONTROL
• Switch on raid reminders: 24 hours, 2 hours and 1 hour before. None for a raid you can't attend.
• Optional push alerts for raid changes, calls for help and a raid spot that opens for you from the waiting list.

HOW TO START
1. Your guild uses the Guilded bot on its Discord server.
2. Sign in with the Discord account you use with your guild.
3. Choose your server on the Guilded page and type the code your phone shows.
Not in a Guilded guild yet? Open the sample guild and explore with made-up names.

Game information comes from your guild's Guilded addon and Windows companion uploads, so it is as recent as the latest upload. Item prices and roster edits stay in Discord and on the Windows companion.

Available in English and French. No ads and nothing to buy. Positions and calls for help are shown only to your guild and kept for a limited time. "Delete my data" in the app removes your data (backups and Discord messages already posted are not changed).

Guilded is a fan-made tool. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc.
```

## Français (fr-CA)

**Description courte** (80 max) :

```
Suis tes raids, la carte et les classements avec ton compagnon de guilde WoW.
```

**Description complète** (4 000 max) :

```
Guild Sync Companion est un compagnon de guilde WoW pour les guildes qui utilisent le bot Discord Guilded. Reste organisé et près de ta guilde loin de ton ordinateur : réponds aux raids, trouve un artisan, vois où les membres ont été vus et suis les classements sur ton mobile.

POURQUOI L'UTILISER
• Gagne du temps : vois le prochain raid et réponds en quelques touches.
• Sois à l'heure : reçois des rappels avant la soirée de raid.
• Entraidez-vous : sache quand un membre appelle à l'aide en jeu.
• Trouve un artisan : cherche un objet et demande-le à quelqu'un de ta guilde.
• Consulte sans réseau : tes derniers écrans de guilde et les classements restent sur le mobile.

RAIDS ET BUTIN
• Prochain raid : l'heure, les inscrits et les raids des prochaines semaines.
• Inscris-toi avec J'y vais, Peut-être ou Je ne peux pas, avec ton rôle. Les règles de l'inscription Discord s'appliquent : limites par rôle, liste d'attente et échéance.
• Classement EP/GP, avec tes personnages en premier.
• Soft reserves : vois la liste et demande un objet tant que la liste du responsable du butin est ouverte.
• Liste de souhaits : garde les objets voulus, par priorité.

LA VIE DE GUILDE
• Membres : tes personnages avec classe, niveau, rang de guilde et core de raid.
• Activité : les 14 derniers jours, avec les arrivées et les départs, les rangs, les dons à la banque et les boss de raid vaincus.
• Artisanat : vois qui peut fabriquer un objet, choisis la quantité, ajoute une note, puis suis ou annule tes demandes.
• Carte de guilde : où les membres ont été vus dehors, une carte de chaleur des endroits où joue ta guilde et les appels à l'aide récents avec l'heure et les attaquants. Seuls les membres connectés de ta guilde la voient. Tu peux arrêter de partager ta position à tout moment, ce qui l'efface.

TES PERSONNAGES
• Une page par personnage : rangs en donjon, donjons récents et duels.
• Choisis ton personnage principal.
• Vois ce qui te manque pour une promotion, si ton serveur a des règles de promotion.
• Album de badges : une carte par succès obtenu. Pas de paquets ni de hasard.

CLASSEMENTS ET NOUVELLES, SANS CONNEXION
• Les donjons cotés de la semaine et les meilleurs.
• Les classements publics des donjons, personnages et guildes, par saison.
• Le classement des duels et la progression des raids.
• Les manchettes de World of Warcraft, avec des liens vers le site de l'éditeur et les nouvelles de Blizzard.

DES ALERTES À TON CHOIX
• Active les rappels de raid : 24 heures, 2 heures et 1 heure avant. Aucun pour un raid où tu ne peux pas aller.
• Alertes push facultatives : changements de raid, appels à l'aide et place de raid qui se libère pour toi.

POUR COMMENCER
1. Ta guilde utilise le bot Guilded sur son serveur Discord.
2. Connecte-toi avec le compte Discord que tu utilises avec ta guilde.
3. Choisis ton serveur sur la page Guilded et tape le code affiché sur ton mobile.
Pas encore de guilde Guilded ? Ouvre la guilde d'exemple, avec des noms inventés.

L'information du jeu vient des envois de l'addon Guilded et du compagnon Windows de ta guilde : elle date du dernier envoi. Les prix des objets et les changements de roster restent dans Discord et sur le compagnon Windows.

Offerte en français et en anglais. Sans publicité et rien à acheter. Les positions et les appels à l'aide sont montrés seulement à ta guilde et gardés pour une durée limitée. « Supprimer mes données » dans l'appli efface tes données (les sauvegardes et les messages Discord déjà publiés ne changent pas).

Guilded est un outil créé par des fans. Il n'est ni affilié à Blizzard Entertainment ni approuvé par elle. World of Warcraft est une marque de commerce de Blizzard Entertainment, Inc.
```

## When 0.7.0 is final

The phone app 0.7.0 is being built (help, sharing, rating, an in-app privacy page, a walkthrough, Back to leave, a
keyboard fix and a feedback button were requested). None of them is in the texts above. After it is uploaded, check
what shipped and add one short section only for what is really there, inside the 4,000-character limit.

## Graphics

| Asset | Play requirement | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG, 32-bit | [`icon-512.png`](icon-512.png) (exported from `mobile/assets/icon.png`) |
| Feature graphic | 1024 × 500 PNG or JPG, no transparency | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) (source: [`feature-graphic.html`](feature-graphic.html)) |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side | [`screenshots/`](screenshots/): eight English and, in `fr-CA/`, eight French, 1080 × 1920 |

Screenshots, in upload order (the same file names in `screenshots/` and `screenshots/fr-CA/`):

1. `01-guild-activity.png`: Guild, activity
2. `02-guild-raids.png`: Guild, raids with the member's answer
3. `03-crafting.png`: Guild, crafting
4. `04-character.png`: Me, one character's page
5. `05-guild-map.png`: Guild, map with heat map and a help pin
6. `06-alerts.png`: Alerts
7. `07-stats.png`: Stats, this week's summary
8. `08-guild-roster.png`: Guild, roster

All of them come from the Expo web export of the app, signed in to a local mock server that answers with **made-up
data** only. They hold no real names and no personal data, and nothing is requested from the live service while
capturing. To regenerate them, see [`capture-screenshots.mjs`](capture-screenshots.mjs).
No Blizzard art is used. The feature graphic says "Your guild" rather than "WoW", to keep trademarks out of the artwork.

## Length check (27 Nov 2026)

| Text | Characters | Limit |
| --- | --- | --- |
| EN name | 28 | 30 |
| FR name | 29 | 30 |
| EN short | 76 | 80 |
| FR short | 77 | 80 |
| EN full | 3,379 | 4,000 |
| FR full | 3,702 | 4,000 |
