# Guilded Dungeons

A small dungeon addon for WoW Forever: it times your 5-player dungeon runs, counts bosses and
deaths, and keeps your personal records. No guild needed.

- `/gdungeons` (or `/gdg`) `status | results | start | complete | abandon | check | score | lang en|fr|auto`
- Runs start by themselves when you enter a dungeon and finish on the last boss.
- Optional: sign in at https://guilded.kcaron.top/me/ with Discord, get a personal companion code,
  and the Guilded companion sends your finished runs to the public leaderboards at
  https://guilded.kcaron.top/leaderboards/.

If the full **Guilded** addon is installed too, Guilded records the run and this addon stays quiet,
so a run is never counted twice.

The tracking code is the same as Guilded's (copied by `scripts/build-dungeons-addon.mjs`).

Francais : chronometre de donjon et records personnels, sans guilde. Classements publics
facultatifs avec le compagnon Guilded.
