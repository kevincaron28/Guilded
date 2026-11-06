# Next-version development: addon-only guilds and party games

14 October 2026. Owner approved implementation and explicitly requested closing
standalone guild gaps. Guilded source stays 6.1.2 / protocol 2 until intentional
release preparation. Guilded Games has its own preview version, 0.1.0.

## Implemented candidate

- Optional `GuildedGames` addon, `/ggames`: high roll, elimination deathroll,
  alternating duel, closest-target rounds, individual/team trivia, host window,
  missing-roll status, explicit tie roll-offs, removal/cancel/rematch and bounded
  local match history. Only the host installs it. English/French starter packs.
- Guilded's Games page/module is removed. `/guilded games` opens the optional
  addon when installed, otherwise explains how to get it. Old settings and
  SavedVariables remain. Prior Games.lua source is archived, not packaged.
- Guilded's soft-reserve roll-offs have their own always-loaded LootRoll module:
  SR+ bonuses, tied-player re-rolls and manual award. No games addon required.
- Officer **Local guild** page in Guild tools: create/select cores, set loot
  mode/reserve count, add/update main or bench characters and remove a roster
  member with confirmation. All local cores share the existing guild point
  pool. Existing prices can be edited through `/guilded price`.
- Local cores live in separate SavedVariables, are included in backup/restore,
  and do not replace companion/bridge core data. Local/connected core selections
  are remembered separately. Local mode ignores the connected next-raid core.
- Standings and officer accounting identify the data source. Standalone help
  no longer sends a new unlinked character to Discord to see local records.
- Fresh installations default to addon-only setup. First-run detection requires
  positive companion evidence before selecting Connected; receiving an in-game
  officer snapshot does not hide the local core tools. Existing mode choices
  are retained, and `/guilded setup` can change them.
- Standalone backup codes include the accounting snapshot paired with their
  ledger. Restore previews local core/roster counts, replaces that baseline
  rather than combining it with the receiving PC's old snapshot, and supports undo.

## Addon-only guild walkthrough

1. Install the full Guilded addon, preserving SavedVariables. Choose **In-game
   only** in `/guilded setup`. Pause any previously configured companion
   separately; this preference does not stop an external process.
2. An actual guild officer opens Guild tools > Local guild. Create a core,
   choose its loot mode and reserve count, then **Save loot rules**. Add real
   character names, roles and main/bench placement; no roster is invented.
3. `/guilded core <name>` selects the core. `/guilded core roster` compares
   its roster with the current group. Local core configuration cannot be
   changed during an active recorded raid.
4. Use Raid to record the night, attendance and manual boss marks; use the
   existing loot workflows and Administration for EP/GP. Save/reload or log
   out to write the records to disk. Discord signups are not required.
5. Review local standings. The record keeper can **Publish standings** to
   online Guilded members. The sender and snapshot time are shown. This is
   an officer snapshot, not a central database or multi-writer merge.
6. For handover, finish the raid and settle outstanding awards. Back up on
   the record keeper's PC, copy the code securely to the next officer, inspect
   Restore's preview on their PC and confirm. Compare totals before recording
   new awards; only the new record keeper should continue. Restore undo remains
   available. Use the same preview/newer version on both PCs for the new
   standalone accounting snapshot metadata; older readers do not apply it.

Commands: `/guilded localcore create <name>`, `rules EPGP|COUNCIL|RESERVE|PRIORITY
[1-10]`, `add <character> TANK|HEALER|DPS main|bench`, `remove <character> confirm`.
The latter three act on the selected core. `/guilded lootroll [cancel]` shows
pending rolls or cancels a roll-off without awarding an item.

## Deliberate boundaries

Local core rosters are character-based; no Discord account or alt identity is
inferred. This phase uses shared guild EP/GP, not independent local pools.
Core configuration is on the record keeper's PC; backup transfer is a snapshot,
not automatic peer roster synchronization. Map/recipe/interactive loot features
still need participating addon users; supported whisper/roll paths do not.
Verified online seasonal ratings, Discord signups and external reports remain
optional connected features. Local dungeon recording continues without them.

Connecting a previously standalone guild does not automatically create matching
Discord cores or map historical local core IDs. Plan that migration separately;
do not turn on a companion and assume historical raids will match online cores.

## Build and verification

`node scripts/build-addon-zip.mjs --preview` writes
`dist/preview/Guilded-next-preview.zip` without replacing the published ZIP.
`node scripts/build-games-addon.mjs` validates Lua 5.1 syntax and writes
`dist/preview/GuildedGames-v0.1.0-preview.zip` with no Guilded dependency.

Required offline checks: TypeScript, full Vitest suite, ESLint, Guilded addon
validator, Games syntax/package validation. Focused Lua tests cover games,
localized rolls, SR+ independence, local configuration/permission checks,
connected/local selection isolation, source labels and backup accounting.

Still required before release: fresh addon-only guild walkthrough, real raid
totals, two-PC officer handover and undo, member permissions, both addons loaded,
all games with non-addon participants, French UI/roll parsing, group changes,
combat/reload, Windows/PostgreSQL final-commit CI and normal publication gates.
No live game acceptance, deployment or publication is claimed by this document.

## Offline evidence - 14 October 2026

- Full Vitest run: 176 files / 1,459 tests passed using the documented Windows
  thread pool with two workers. After the final host-window/game polish, the
  affected game, window, local-guild and backup suites passed again: 43 tests.
- TypeScript, ESLint, Guilded static/Lua validation and both preview ZIP builds
  passed. Games packaging also parses every shipped Lua file as Lua 5.1.
- Preview instructions and SHA-256 sums are in `dist/preview`. No installed
  game files, production service, published release or shared version changed.
- Existing unrelated website/recruitment edits were preserved.
