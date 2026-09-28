# Standalone Guilded Addon Roadmap

## Purpose

Grow Guilded into a useful in-game toolkit for players and guilds that do not
use the Guilded Discord bot or companion. This roadmap is about the WoW addon:
it does not assume a web service, bot, companion process, or external database.

The addon is already library-free and usable without Discord. It includes raid
tracking, attendance, EPGP actions, loot tools, readiness checks, backups,
recipes, roll games, and other optional modules. The aim here is to make that
standalone use clearer and more complete, not to duplicate the whole bot.

## Current standalone boundaries

- The addon stores its records in local WoW SavedVariables. Each player's
  client has its own copy; addon messages can share information with online
  Guilded users but do not make a central, always-available database.
- Some features work locally; some exchange data only among online addon users;
  some require bot-provided standings or Discord raid data. Make those
  differences clear in setup and in the UI.
- WoW addon restrictions prevent unrestricted file writes and reliable combat
  log-based automation. Boss kills and attendance must remain manual unless a
  supported game API provides the information.
- Do not describe one client's local ledger as authoritative guild-wide state.
  Multi-client ledger synchronization needs an explicit conflict and
  authorization design before implementation.

## Recommended order

### 0. Verify the standalone baseline

Before adding features, validate the existing addon without a bot or companion:

- Install and load the addon with no bot-related configuration.
- Exercise raid start/end, attendance, boss marks, EPGP entries, loot,
  readiness, backups, and module switches.
- Check which pages, messages, commands, or tooltips still imply that Discord
  or the companion is installed.
- Record clearly which functions are local-only, shared with online addon
  users, or unavailable without external data.

**Done when:** a player can install and use the existing in-game features
without a bot setup step, and missing external data is explained accurately.

### 1. Make in-game-only use a first-class setup path

Add a lightweight first-run choice or help path for **In-game only** versus
**Optional Discord connection**. In in-game-only mode:

- Explain where data is stored and that each client has its own saved copy.
- Hide or relabel bot-only status such as "sent to Discord" and bot-provided
  standings when those values are absent.
- Keep Discord-specific features discoverable but clearly marked as optional.
- Avoid treating a missing companion, standings file, or bot response as an
  addon error.
- Keep the default setup short; do not require guild officers to configure an
  online service before using the raid tools.

**Done when:** a new user can identify the standalone path and understand
feature availability without reading external setup docs.

### 2. Improve the local raid-night workflow

Build on the existing raid and attendance commands and officer tools:

- Add raid templates or sensible presets for starting common raid nights.
- Make attendance entry and correction faster for a full group, while keeping
  confirmation for actions that affect many players.
- Make manual boss marking, raid notes, and raid close-out easy to find.
- Add a concise end-of-raid summary from the data already recorded: attendance,
  boss marks, EPGP changes, loot, and any missing/manual entries.
- Keep a clear audit trail in the local journal for corrections and awards.

Do not imply boss kills or attendance were automatically verified. Present
manual marks and player-reported information as such.

**Done when:** an officer can run a typical raid from the in-game window or
commands, review a summary, and recover the record after reload/logout without
using Discord.

### 3. Make local backup, archive, and transfer easier

Build on `/guilded backup`, `/guilded restore`, and restore undo:

- Provide a guided export/archive for the supported local records, with a
  human-readable preview of what is included.
- Make it easy to save a backup code outside the game, or to transfer it
  manually to another officer or replacement machine.
- Preserve guild identity checks, integrity checks, preview-before-restore,
  and undo behavior.
- State explicitly that a manual transfer is a snapshot, not live
  synchronization.
- Consider a compact raid-history report suitable for copying to a guild
  website, forum, or text channel without requiring the Guilded bot.

Do not claim arbitrary file creation is possible from the addon; use supported
SavedVariables and safe copy/paste mechanisms.

**Done when:** an officer can understand, export, move, inspect, and restore a
guild snapshot without confusing it with an automatically shared live database.

### 4. Define an honest local EPGP and roster model

Clarify how a no-bot guild uses its local roster and ledger:

- Label the current character's locally stored ledger separately from
  companion/bot standings.
- Provide local roster and standings views using data actually present on that
  client.
- Explain which data comes from officer-entered records and which comes from
  online peer broadcasts.
- If testing cross-client record sharing, first design a single-writer or
  officer-authority model, stable event IDs, duplicate prevention, stale-data
  handling, and recovery after missed messages.
- Keep multi-writer EPGP synchronization out of scope until there is a tested
  conflict-resolution protocol.

**Done when:** a player can tell whose data they are viewing, how current it is,
and whether it is only local or has been shared.

### 5. Promote useful player-only and online-addon features

Improve standalone discovery and usability of features that do not inherently
need Discord:

- Personal gear, enchant, consumable, and readiness checks.
- Personal and online-guild recipe lookup, materials lists, and profession
  cooldowns.
- Attunement tracking and reminders where the game API permits.
- Soft reserves, in-game bidding, loot council responses, and roll games.
- Module descriptions and setup guidance that say whether information stays
  local, is sent to online Guilded clients, or depends on bot-provided data.

Prioritize a few polished flows over adding many new modules. Keep every optional
module independently switchable and gated according to
`addon/Guilded/Modules/README.md`.

**Done when:** players can find and use the relevant features from the window
and `/guilded help`, with accurate explanations of data sharing and
requirements.

## Design and implementation guardrails

- Keep the addon usable with no bot, companion, or external library installed.
- Reuse the existing Core.lua namespace, module switch conventions, tests, and
  UI patterns before adding new systems.
- New addon-message protocols must follow the compatibility rules in
  `addon/Guilded/Modules/README.md`: own prefix, append optional fields only,
  ignore unknown kinds, and introduce a new message kind for breaking changes.
- Be explicit about data ownership, freshness, and trust. Online self-reports
  are not server-verified facts.
- Preserve confirmation for destructive or whole-group operations.
- Keep privacy and bandwidth modest; share only the fields needed for a
  described feature.
- Check addon API availability on the supported game clients and fail plainly
  when an API is unavailable.
- Update the in-addon help and addon README whenever user-visible standalone
  behavior changes. Test the addon in TOC load order and with at least two
  clients for any peer-message feature.

## Explicit non-goals for this roadmap

- Requiring Discord, a companion, or a hosted service for core addon use.
- Claiming there is a central guild database when the addon only has local
  SavedVariables and opportunistic peer messages.
- Automatically reading the combat log or inferring attendance/boss kills when
  the client does not expose a supported API.
- Building unrestricted file export from inside the addon.
- Implementing multi-writer EPGP/roster synchronization before its conflict
  model is designed and tested.

## Handoff note

Start with roadmap step 0 and inspect the current addon before changing code.
Treat this document as a product direction and acceptance criteria, not as a
request to implement every item at once. Implement one phase at a time, verify
it in-game where necessary, and update this roadmap with completed decisions.
