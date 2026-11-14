# Guilded 9.3.2 — release notes (14 November 2026)

**Duel records, group runs and the PvP map.** Published 14 November 2026. Protocol 2, WoW Forever only. Two bot migrations shipped since 9.3.1 (`world_pvp_events` and `carried_records`); both are already applied on production.

Real-client checks: docs/V9_3_2_RELEASE_ACCEPTANCE.md. Nothing in 9.3.2 is confirmed in a real game client yet.

## What changes for members

- **Carried duel records:** if you only have the addon, a nearby player's companion can carry your duel records to the guild. It is on by default; turn it off for yourself with `/guilded carry off`. Officers have a guild-wide switch.
- **Group runs:** a dungeon run made in a group with players from other guilds reaches each of those guilds.
- **Duels:** every duel ends with a result line in chat, and a duel that ends right after you log in is no longer lost.
- **World PvP:** kill and death positions are saved and sent for the PvP map.
- **Drowned City:** Min'loth the Serpent is the final boss.
- **Guild invites:** online and offline lines are no longer saved as invite problems; the copy box shows one "N invites waiting" line with a Next button.
- **`/gdg`** opens the dungeons window when both addons are installed.
- **Companion:** every update check is logged, and a downloaded update installs when the companion is idle.

## Discord and website (already live)

- One community leaderboard for Discord, dungeons and PvP.
- A PvP tab with the real in-game map and zone names.
- Painted role emblems, a fuller run card and a painted trophy wall on the achievements card.

## In short (English)

Guilded 9.3.2: duel records from players who only have the addon can reach the guild through a nearby player's companion (turn it off with `/guilded carry off`). Dungeon runs made with players from other guilds reach each guild. Every duel ends with a result line. The PvP map shows kill and death positions. Drowned City has its final boss. The invite copy box shows one "N invites waiting" line with a Next button.

## En bref (français)

Guilded 9.3.2 : les duels des joueurs qui n'ont que l'addon peuvent atteindre la guilde grâce au companion d'un joueur à proximité (désactivez avec `/guilded carry off`). Les donjons faits avec des joueurs d'autres guildes parviennent à chaque guilde. Chaque duel se termine par une ligne de résultat. La carte PvP montre les positions des victoires et des morts. Drowned City a maintenant son boss final. La boîte de copie des invitations affiche une seule ligne « N invitations en attente » avec un bouton Suivant.

## Technical

- #880, #893, #895, #896, #898, #899, #901-#904, #909-#911, #913, #915, #916, #918, #919, #921, #923 since 9.3.1 (see CHANGELOG.md).
