# Guilded 9.3.4 — release notes (15 November 2026)

**Guild-only Discord, a simpler website and Delete my data.** Not yet published. Protocol 2, WoW Forever only. The one bot migration since 9.3.3 (`carried_runs`) was already applied on production on 15 November 2026 with the bot deploy.

Real-client checks: docs/V9_3_4_RELEASE_ACCEPTANCE.md. 9.3.4 is not yet confirmed on real clients.

**Note for members:** guild board votes and news made in game on 9.3.3 no longer reach Discord.

## What changes for members

- **Guild-only Discord:** a guild's Discord shows only the runs and duels that include one of its players.
- **Addon:** the Guild board tab is gone, Layer invite is in the minimap right-click menu, and a few windows are fixed.
- **Records from addon-only players:** the addon asks for a companion player right away and shows a plain waiting line.
- **Companion:** it warns you when its list of waiting uploads is damaged.
- **Discord:** `/delete-my-data` deletes your data, and `/poll board` is removed. `/poll news` works in Discord only.
- **Website:** no account tool pages. There is a small Discord sign-in and one basic My Guilded page, and a public Delete my data page. New painted art.
- **Phone app:** you can delete your data inside the app. The app keeps its own version number.

## In short (English)

Guilded 9.3.4: a guild's Discord shows only runs and duels with one of its players. The Guild board tab is gone from the addon, Layer invite is in the minimap menu, and addon-only records ask for a companion player at once. `/delete-my-data` is new, and the website is simpler. Guild board votes and news made in game on 9.3.3 no longer reach Discord.

## En bref (français)

Guilded 9.3.4 : le Discord d'une guilde ne montre que les donjons et les duels qui comptent un de ses joueurs. L'onglet Tableau de guilde disparaît de l'addon, l'invitation de Layer est dans le menu de la minicarte, et les duels de joueurs sans companion demandent tout de suite un joueur avec companion. `/delete-my-data` est nouveau et le site est plus simple. Les votes et les nouvelles du tableau de guilde faits en jeu avec la 9.3.3 n'arrivent plus sur Discord.

## Technical

- #958, #959, #960, #969, #970, #973, #976 (addon and companion); #948, #950, #953, #961, #963, #964, #965, #967, #968 (bot and website, already live); #962, #966 (phone app) since 9.3.3 (see CHANGELOG.md).
