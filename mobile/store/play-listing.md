# Google Play store listing — Guilded

The text to paste into Play Console. Its home in Play Console is **Grow users → Store presence → Main store listing**.
Character counts were checked against Play's limits (see the table at the end). The step-by-step guide is
[docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md). The data-safety answers are in
[play-data-safety.md](play-data-safety.md), and the content-rating answers are in [play-content-rating.md](play-content-rating.md).

This listing describes the five-tab app without Guilded Clash (the card game is on hold and is not in the Play build),
version 0.3.0. Screenshot sizes and what each one must show: [play-screenshots.md](play-screenshots.md). The Play
Console steps for the closed test: [play-console-checklist.md](play-console-checklist.md).

**Decided by the owner on 15 November 2026:** the Play name is **`Guild Sync Companion`**, the label under the
phone icon stays `Guilded`, and the first bundle goes out **without push** (profile `production-no-push`).
The options that were weighed:

| Option | For | Against |
| --- | --- | --- |
| 1. `Guild Sync Companion` | The name the Microsoft Store already accepted for the Windows companion: one name on both stores, and no clash with the other "Guilded" on Play. | Members who search "Guilded" will not find it by name; the header inside the app and the website still say Guilded. |
| 2. `Guild Sync` | Same family as the Store name, shorter, and fits a phone app that shows the guild instead of uploading for it. | A new name that is used nowhere else yet; a little generic, so check that Play has no app of that exact name before choosing it. |
| 3. `Guilded: guild companion` | Keeps the name members know and says what the app is. Search still finds "Guilded". | Still starts with the other product's name, so Play can refuse it or act on a complaint later; a forced rename after launch costs a new review. |

Chosen: **1**, because it is already accepted elsewhere and cannot be confused with the other app. Plain
`Guilded` is not proposed: another app of that name is on Play. Whatever is chosen, the package id
(`top.kcaron.guilded`) and the name on the phone's home screen (`Guilded`, from `app.json`) do not change.

Background: The Microsoft Store refused "Guilded Companion" on 3 November 2026
(naming rule 10.1.1.1), and "Guilded" was also the name of a chat app that had a Play listing. Play can refuse a title it
reads as another product's name. The label under the icon comes from `name` in `mobile/app.json` and is `Guilded`
and stays so (owner decision); changing it later is a one-line change and a new build.
Do not put "World of
Warcraft" or "WoW" in the title or the icon: a game's name is allowed in the description, with the disclaimer that is
already there, not in the title.

## App details

| Field | Value |
| --- | --- |
| App name (30 max) | `Guild Sync Companion` |
| Default language | English (United States) – en-US |
| Translation | French (Canada) – fr-CA (text below) |
| App or game | App |
| Free or paid | Free |
| Category | **Social** (alternative: Entertainment) |
| Tags (pick up to 5 in Console) | Social, Community, Games companion |
| Contains ads | No |
| In-app purchases | None |
| Contact email | `support@guildedwow.com` (Cloudflare Email Routing to the owner; Play shows it publicly) |
| Website | https://guildedwow.com |
| Privacy policy | https://guildedwow.com/docs/PRIVACY (live, HTTP 200 on 8 Nov 2026; `/privacy` is a 404, so do not use it) |
| Account deletion URL | https://guildedwow.com/docs/PRIVACY#choices-access-and-deletion (public page with the steps, readable without signing in; in the app the button is under Me → Settings → Delete my data). The website is retiring its account pages: if its public deletion page gets its own address, use that one. |

## English (en-US)

**Short description** (80 max):

```
Your guild's roster, map, raids, badges and leaderboards, right on your phone.
```

**Full description** (4,000 max):

```
Guild Sync Companion is the phone app of Guilded. It keeps your World of Warcraft guild with you when you are away from the game.

It is for guilds that use the Guilded Discord bot. Sign in with the same Discord account you use with your guild, and the app shows what your guild already shares with you.

GUILD
• Roster: your characters, guild ranks, raid cores and soft reserves.
• Guild map: where guildmates were last seen outdoors, a heat map of where the guild plays, and recent calls for help with the time and the attackers. Only signed-in members of your guild see it. It is never public, and you can stop sharing your position at any time, which deletes it.
• Raids: the next raid, who signed up, upcoming raids and EP/GP standings.

STATS
• This week on Guilded: rated dungeon runs and the best runs of the week.
• Public dungeon leaderboards for characters and guilds, the same as the website.

ME
• Your characters and a badge album: one card for every achievement you really earned. No packs, no luck, nothing to buy.
• Your raid wishlist, saved with the guild.

ALERTS
• A reminder on this phone 60 minutes before each raid you can see.

NEWS
• Recent World of Warcraft headlines with a link to read them on the publisher's site, and a link to Blizzard's news page.

Want to look around first? Open the sample guild: every screen works with made-up names, without signing in.

Free, no ads, nothing to buy. Positions and calls for help are kept only for your guild, for a limited time, and "Delete my data" in the app's settings removes your data (backups and Discord messages already posted are not changed).

Guilded is a fan-made tool. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc.
```

## Français (fr-CA)

**Description courte** (80 max) :

```
Membres, carte, raids, badges et classements de votre guilde, sur votre mobile.
```

**Description complète** (4 000 max) :

```
Guild Sync Companion est l'appli mobile de Guilded. Elle garde votre guilde World of Warcraft avec vous quand vous êtes loin du jeu.

Elle s'adresse aux guildes qui utilisent le bot Discord Guilded. Connectez-vous avec le même compte Discord que dans votre guilde : l'appli affiche ce que votre guilde partage déjà avec vous.

GUILDE
• Membres : vos personnages, rangs de guilde, cores de raid et soft reserves.
• Carte de la guilde : où les membres ont été vus dehors pour la dernière fois, une carte de chaleur des endroits où joue la guilde, et les appels à l'aide récents avec l'heure et les attaquants. Seuls les membres connectés de votre guilde la voient. Elle n'est jamais publique, et vous pouvez arrêter de partager votre position à tout moment, ce qui l'efface.
• Raids : le prochain raid, les inscrits, les raids à venir et le classement EP/GP.

STATS
• Cette semaine sur Guilded : les donjons cotés et les meilleurs donjons de la semaine.
• Les classements publics des donjons, personnages et guildes, comme sur le site.

MOI
• Vos personnages et un album de badges : une carte pour chaque succès vraiment obtenu. Pas de paquets, pas de chance, rien à acheter.
• Votre liste de souhaits de raid, gardée avec la guilde.

ALERTES
• Un rappel sur ce téléphone 60 minutes avant chaque raid que vous voyez.

NOUVELLES
• Les manchettes récentes de World of Warcraft, avec un lien pour les lire sur le site de l'éditeur, et un lien vers les nouvelles de Blizzard.

Envie de jeter un œil d'abord ? Ouvrez la guilde d'exemple : chaque écran fonctionne avec des noms inventés, sans connexion.

Gratuit, sans publicité, rien à acheter. Les positions et les appels à l'aide sont gardés seulement pour votre guilde, pour une durée limitée, et « Supprimer mes données » dans les réglages de l'appli efface vos données (les sauvegardes et les messages Discord déjà publiés ne sont pas modifiés).

Guilded est un outil créé par des fans. Il n'est ni affilié à Blizzard Entertainment ni approuvé par elle. World of Warcraft est une marque de commerce de Blizzard Entertainment, Inc.
```

## Graphics

| Asset | Play requirement | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG, 32-bit | [`icon-512.png`](icon-512.png) (exported from `mobile/assets/icon.png`) |
| Feature graphic | 1024 × 500 PNG or JPG, no transparency | [`feature-graphic-1024x500.png`](feature-graphic-1024x500.png) (source: [`feature-graphic.html`](feature-graphic.html)) |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side | [`screenshots/`](screenshots/): seven at 1080 × 1920 |

Screenshots, in upload order:

1. `01-stats.png`: Stats, this week's summary
2. `02-guild-roster.png`: Guild, roster (sample guild)
3. `03-guild-map.png`: Guild, map with heat map and a help pin
4. `04-guild-raids.png`: Guild, raids
5. `05-me-profile.png`: Me, characters
6. `06-me-badges.png`: Me, badge album
7. `07-alerts.png`: Alerts

All of them come from the Expo web export of the five-tab build, with the **sample guild** and made-up leaderboard data.
They hold no real names and no personal data. The public endpoints were answered with fictional data while capturing,
so live player names never appear. To regenerate them, see [`capture-screenshots.mjs`](capture-screenshots.mjs).
No Blizzard art is used. The feature graphic says "Your guild" rather than "WoW", to keep trademarks out of the artwork.

## Length check (15 Nov 2026)

| Text | Characters | Limit |
| --- | --- | --- |
| EN short | 78 | 80 |
| FR short | 79 | 80 |
| EN full | 1,782 | 4,000 |
| FR full | 2,078 | 4,000 |
