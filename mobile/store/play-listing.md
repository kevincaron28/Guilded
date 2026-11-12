# Google Play store listing — Guilded

The text to paste into Play Console. Its home in Play Console is **Grow users → Store presence → Main store listing**.
Character counts were checked against Play's limits (see the table at the end). The step-by-step guide is
[docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md). The data-safety answers are in
[play-data-safety.md](play-data-safety.md), and the content-rating answers are in [play-content-rating.md](play-content-rating.md).

This listing describes the five-tab app (redesign slice 3, PR #615). Ship it with a build that contains #615 and #345.

## App details

| Field | Value |
| --- | --- |
| App name (30 max) | `Guilded` |
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
| Account deletion URL | https://guildedwow.com/me/data (the **Delete my data** button) |

## English (en-US)

**Short description** (80 max):

```
Your guild's roster, map, raids, badges and leaderboards, right on your phone.
```

**Full description** (4,000 max):

```
Guilded keeps your World of Warcraft guild with you when you are away from the game.

Guilded is the companion app for guilds that use the Guilded Discord bot. Sign in with the same Discord account you use with your guild, and the app shows what your guild already shares with you.

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

Free, no ads, nothing to buy. Positions and calls for help are kept only for your guild, for a limited time, and "Delete my data" on the website removes your data.

Guilded is a fan-made tool. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc.
```

## Français (fr-CA)

**Description courte** (80 max) :

```
Membres, carte, raids, badges et classements de votre guilde, sur votre mobile.
```

**Description complète** (4 000 max) :

```
Guilded garde votre guilde World of Warcraft avec vous quand vous êtes loin du jeu.

Guilded est l'appli compagnon des guildes qui utilisent le bot Discord Guilded. Connectez-vous avec le même compte Discord que dans votre guilde : l'appli affiche ce que votre guilde partage déjà avec vous.

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

Gratuit, sans publicité, rien à acheter. Les positions et les appels à l'aide sont gardés seulement pour votre guilde, pour une durée limitée, et « Supprimer mes données » sur le site efface vos données.

Guilded est un outil créé par des fans. Il n'est ni affilié à Blizzard Entertainment ni approuvé par elle. World of Warcraft est une marque de commerce de Blizzard Entertainment, Inc.
```

## Graphics

| Asset | Play requirement | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG, 32-bit | Export `mobile/assets/icon.png` from PR #345 at 512 × 512 (not in this PR). |
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

## Length check (8 Nov 2026)

| Text | Characters | Limit |
| --- | --- | --- |
| EN short | 78 | 80 |
| FR short | 79 | 80 |
| EN full | 1,691 | 4,000 |
| FR full | 1,951 | 4,000 |
