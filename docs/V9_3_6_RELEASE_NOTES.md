# Guilded 9.3.6 — release notes (16 November 2026)

**Season 2 is ready, secret and gold achievements, and safer linking.** Published 16 November 2026. Protocol 2, WoW Forever only. Bot migrations: public profile hidden, raid season link, member trend, device claim offers, client probes.

Real-client checks: docs/V9_3_6_RELEASE_ACCEPTANCE.md. 9.3.6 is not yet confirmed on real clients.

## What changes for members

- **Season 2 starts 9 December** with the raid launch. Dungeons, duels, battlegrounds, World PvP, Guilded Clash and raid attendance all switch to "Season 2" together. Every known level 45-60 dungeon has a route, with Lower and Upper Blackrock Spire, the Dire Maul wings and both Stratholme gates as separate routes.
- **Achievements:** secret achievements that stay hidden until you earn them (the first one involves a certain worgen in Silverpine), gold tiers from Pocket Change to Gold Goblin, and auction house achievements for sales and profit. Only the tier is ever shared, never your gold.
- **Hide my profile:** `/character privacy hide` (or the switch on My Guilded) hides your characters from the public website. Your guild's Discord is not affected.
- **Linking:** the companion only offers Discord servers that know your guild, and one click links the characters it already saw. Alts listed in your saved file show as "reported" until you play them once.
- **French dungeon names** match the French WoW Forever client (Bas du pic Rochenoire, Donjon d'Ombrecroc…).
- **Officers:** promotions follow the bot rule (days and level) with a one-click "Promote next"; Alt ranks are never promoted; promotions are noted in the officer log. A member-count graph (`/officer stats trend`) and a weekly trend post in the officer log. Race to 60 shows only current guild members.
- **Website:** dungeon paintings on the leaderboards, painted headers and podiums, and a real "page not found".

## In short (English)

Guilded 9.3.6: Season 2 on 9 December with every season system linked and the endgame dungeons ready, secret, gold and auction house achievements, a hide-my-profile option, one-click linking, French dungeon names, a promotions rework for officers and a polished website.

## En bref (français)

Guilded 9.3.6 : la saison 2 commence le 9 décembre avec tous les classements liés et les donjons de fin de jeu prêts, des succès secrets, d'or et d'hôtel des ventes, une option pour masquer son profil, la liaison en un clic, les noms de donjons du client français, des promotions revues pour les officiers et un site plus soigné.

## Technical

- #1015 to #1034 since 9.3.5 (see CHANGELOG.md). Compatibility policy: docs/COMPAT_POLICY.md. The bot is deployed after the GitHub release is published; set `GUILDED_ORIGIN_TOKEN` on the bot and copy the new Caddyfile.
