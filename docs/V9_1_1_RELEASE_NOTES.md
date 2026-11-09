# Guilded 9.1.1 — release notes (9 November 2026)

**The companion now finds your guild's Discord by itself and uploads your dungeon runs without signing in.** Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md.

## What changes for members

- **It finds your server.** The companion matches your in-game guild to its Discord server by name, whatever your realm, and tells you which guild and realm it looked for if it cannot.
- **Dungeon runs upload without signing in.** Runs recorded by Guilded Dungeons now reach the leaderboards from an unsigned companion, scored like any other run.
- **Clearer messages.** "Saved runs ... waiting" is translated, and empty dungeon boards say why they are empty.
- **Phone app:** the Rare card paintings are in.

## Technical

- Companion: guild-to-server match by normalised guild name (#695). Bot: device uploads accept dungeon runs (#694), board empty states (#693). Mobile: Rare art registry (#692).
