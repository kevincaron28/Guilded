# Guilded 6.1.2 — Clearer menus and native guild tabs

14 October 2026. Patch update; protocol 2, no database migration.

- Guilds & Communities gains a Guilded tab for Standings, Crafting and officer Administration (EPGP). It uses the native side-tab border and marble background. Pages scroll inside the window and preserve guild permissions.
- Dungeon finder has one Guilded location with Run and Season views. Season switches between My progress and Guild rankings, including past seasons. Recent runs belong to the current character; saved history is preserved.
- Home links to these locations instead of duplicating their pages. The main menu keeps My character, raid/group actions, Games and Settings. Setup lives in Settings and remains available through `/guilded setup`.
- Calendar administration is beside the native calendar, with a standalone fallback where that client UI is unavailable. Member calendar shortcuts open the native calendar without exposing officer controls.
- A shared save/sync button replaces the duplicate Home action. Its tooltip explains local saving or optional connected synchronization.
- Native guild and dungeon tabs keep their original handlers. Closing Guilded restores the normal interface and the main menu's saved position and scale.
- Includes 6.1.1's optional in-game-only setup, per-character seasonal scores, per-core standings, dungeon artwork and Guilded logo.

Addon, bot and companion versions are aligned at 6.1.2. Install the complete addon folder and preserve SavedVariables and personal companion pairing. Verified online season ratings require the optional connection; local dungeon recording works without it. The Windows installer is unsigned. Prior unverified gameplay and second-PC checks remain follow-up, not automated-test passes.
