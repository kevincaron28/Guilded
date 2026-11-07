# Guilded 9.0.2 — release notes (7 November 2026)

9.0.2 brings the addon and companion work merged since 9.0.1, together with the bot updates
that went live during the day. Protocol 2, Forever only. The server side is already live;
members get the addon and companion parts by updating.

## In game (addon)

- **Dungeon stats**: click a dungeon card for your best and average time, deaths per run, your
  rank against the guild and boss splits against the guild's fastest run. The guild board shows
  one bar per member. (#553)
- **Crafting orders**: an Orders page lists the guild's Discord craft requests you can make, with
  reagents and bag counts. Claiming or finishing one updates the Discord post. (#554)
- **World PvP stats**: kills, deaths, defends and calls for help, weekly and in total, with
  `/guilded worldpvp`. (#549)
- **Traced dungeon maps**: inside a dungeon the addon notes which map cells you walk through
  (no times, nothing sent to your group). Members' runs build an anonymous outline of each floor
  under the death heat map. Turn it off with `/guilded maptrace off`. (#559)
- **Call for help**: the "Under attack?" offer only appears for a real attack by an enemy
  player (two hits within 10 seconds, not in a duel or instance, not by a guildmate, party
  member or friend), and the guild line says where and how many. (#541)
- Profession milestones, the guild overview panel and in-game guild board, a clearer dungeon
  window and the window-close fix. (#555, #501, #508, #520, #514)

## Companion

- Redesigned: a Settings page, plain words throughout, an officers-only Server page, and the
  pages the website already covers removed. (#525, #529, #530)
- Sets itself up on first start: finds WoW, installs the addon, then asks for the Discord
  sign-in. (#560)
- The installer replaces a Microsoft Store install and keeps its settings, and the Update now
  button installs the next version. (#546, #511)

## Discord bot (already live)

- Guild activity ladder (dungeons, duels and battlegrounds in one board) (#543), Top crafters
  and craft history (#561), craft order channels with opt-in crafter pings (#548).
- Duel ladder scored by level difference (#545), PvP finder card (#552), since-yesterday rank
  arrows on ladder cards (#532).
- Read-only board channels in `/setup` (#550), rookie of the week (#556), profession badges
  (#555), invite-channel pre-linking and a WoW chat help button (#544), countdowns removed (#558).
- Fixes: names on the dungeon score card (#538), standings timeouts (#527), quiet honors-role
  warnings (#526), public dungeon run upload timeouts (#563), and low-priority deploys (#562).

## Still owed

Real-client checks of the new addon pages and the companion's first-start setup, and a live
look at the new ladders in a test server. Season 2 scoring (#542) is built but off.
