# Guilded Dungeons

A small dungeon addon for WoW Forever: it times your 5-player dungeon runs, counts bosses and
deaths, and keeps your personal records. No guild needed.

- `/gdungeons` (or `/gdg`) `status | results | start | complete | abandon | check | score | companion | lang en|fr|auto`
- Runs start on the first observed combat in a dungeon and finish on the detected last boss.
- Send your runs to Discord in 3 steps (`/gdungeons companion` shows them in game):
  1. Download the free Guilded Companion (Windows only): search "Guild Sync Companion" in the Microsoft Store, or
     https://guilded.kcaron.top/companion/
  2. Run the installer. It finds WoW and your guild's Discord server by itself.
  3. Keep it open (it starts with Windows). `/reload` or log out and your runs are sent. Signing in with Discord is optional.
- Optional: public leaderboards at https://guilded.kcaron.top/leaderboards/ with the Guilded
  Windows companion (free, Microsoft Store; download page https://guilded.kcaron.top/companion/):
  1. In the companion, Connection & setup: **Sign in with Discord**, then choose
     **Public dungeon leaderboards only**. Nothing to type.
  2. In step 2, choose your `WTF\Account\<account>\SavedVariables` folder (or
     `GuildedDungeons.lua` in it).
  3. After a dungeon, `/reload`. The Windows companion sends your finished runs by itself.
  4. Choose **Refresh public scores**; the companion writes `Accepted.lua` into the GuildedDungeons addon folder.
     `/reload` again to load the response, then `/gdungeons score` opens the score panel.
     Overall/Tank/Healer/DPS totals, exact improvement scenarios and previous seasons use
     the public season rules. Scores are per character and realm; guild scores can differ.
     The standalone panel never claims a guild or global rank from a personal snapshot.
     With an older server, tracking still works and scores remain unavailable until sync
     support is deployed. Missing historical roles are never guessed.

If the full **Guilded** addon is installed too, Guilded records the run and this addon stays quiet,
so a run is never counted twice. The companion reads both `GuildedDungeons.lua` and `Guilded.lua`,
so your runs reach the leaderboards either way.

The tracking code is the same as Guilded's (copied by `scripts/build-dungeons-addon.mjs`).

Francais : chronometre de donjon et records personnels, sans guilde. Classements publics
facultatifs avec le compagnon Guilded.
