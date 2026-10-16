# Guilded 6.2.0 — Standalone guilds and clearer dungeon progress

Released October 16, 2026 at the owner's direction, before the real-client checks in
[the 6.2 checklist](V6_2_GAME_ACCEPTANCE.md) were run. Those checks continue as
post-release follow-up; report problems and keep SavedVariables backups.
Addon, bot source and Windows companion are aligned at 6.2.0; protocol remains 2.
This release introduces no database migration.

## Addon-only guild management

- In-game-only setup is the default. Connected setup requires positive companion
  evidence; receiving an officer's in-game snapshot does not hide local tools.
- Officers can create local cores, configure loot rules/reserve counts, and
  maintain main/bench rosters from Guild tools > Local guild.
- Local and connected selections stay separate. Local cores share the existing
  guild EP/GP pool; this release does not add independent local point pools.
- Standings identify their source. Backup/restore includes local cores, rosters
  and the accounting baseline, with a preview and undo for officer handover.
  One officer remains the default record keeper. Standalone guilds can separately
  opt into officer ledger exchange; snapshots alone do not merge ledgers.

## Companion and officer sync

- Compatible bots support compressed uploads and omit acknowledged ledger/loot
  rows, while retaining unacknowledged awards and pending reversals for retry.
- Cached standings and long polling reduce repeated downloads and can deliver
  changes sooner. Older bots retain the timed refresh path.
- The desktop companion creates an optional `GuildedData` recovery addon beside
  Guilded, so an addon update need not erase downloaded standings. The main file
  takes precedence when guild timestamps tie, preserving newer personal data.
- Folder watching recovers after errors and checks for missed saves periodically.
- Officer snapshots use a smaller wire format when peers support it. Standalone
  officers may opt into `/guilded ledgersync on`; entry IDs deduplicate exchanges
  and voids propagate. This remains off by default and needs two-client acceptance.
- Dungeon-board requests also coordinate officer replies to reduce duplicate
  broadcasts, retaining the existing board format and one-minute cooldown.
- No beta scores, season rules or archived standings are rewritten by this update.

## Dungeon recording and season views

- Deadmines recognizes the final-boss encounter observed on the owner's Forever
  client, including when the encounter journal is unavailable. Failed attempts,
  other bosses and duplicate events cannot trigger a second completion.
- The floating boss-fight timer is removed. Encounter timing continues in the
  background; optional live text remains inside the opened Run tab.
- Seasonal breakdowns support the optional Best 8 model, including uncounted
  routes, separate character scores and independent boss records. Older seasons
  retain their frozen results and original rules.
- Discord's `/dungeon rules` explains the active model. Quebec Gold's current
  beta uses eight best scores from eleven provisional level-30 routes, capped
  at 3,200; participation remains separate and account-based. Other guilds do
  not automatically adopt that preset when installing the addon.

## Optional Guilded Games

Party games are a separate addon. Guilded keeps its own soft-reserve roll-offs,
SR+ bonuses, tied-player rerolls and manual award controls. Guilded Games is
not bundled or required; its Alpha status and acceptance are independent.

## Upgrade and known limits

Install the complete Guilded folder from the tested package. Preserve
SavedVariables, personal pairing and companion configuration. The optional
Windows installer is unsigned. Use the same candidate on both PCs for acceptance.

Verified online ratings need the optional connected service. Installing 6.2.0
does not rotate seasons, recalculate earned points or change archived results.
Quebec Gold's targets remain provisional: current telemetry does not reliably
prove automatic timer starts or a universal all-boss route. The November 4
official season is a separate launch decision, not an automatic addon update.

Local-to-connected core migration is not automatic. Coordinate record-keeper
handover and compare totals before the new officer records awards. No new game
client compatibility is claimed from interface numbers alone.
