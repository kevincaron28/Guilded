# Guilded 8.1.0 Candidate

Prepared on 29 October for the 4 November 2026 launch. Protocol remains 2. This is an unpublished candidate; public GitHub, CurseForge and Microsoft Store downloads remain 8.0.2.

## New and improved

- Optional December fixed-price EPGP preset with editable slot prices and item/level exceptions. New cores use separate empty pools, 100 attendance EP, 100 base GP, 10% weekly decay and 50% off-spec. Existing pools are preserved; enabling the preset is explicit.
- Companion **Raid prices** and **Leaderboards** pages show rule summaries, a priority calculator, member EP/GP/PR, tied ranks and guild dungeon seasons/brackets. Leaders can save pricing changes; members have read access.
- Preset raids pin their pricing revision across refresh/reload, keep quote audit snapshots and resolve exact PR ties with a visible roll before officer confirmation. Unknown items require a provisional quote. See [raid pricing](RAID-PRICING.md) for token exceptions, edition limits and the real-client rehearsal.

- Import RCLootCouncil CSV/JSON or Gargul JSON/TMB CSV through the desktop companion or offline CLI. Review guild, realm, edition and character mappings, then paste the GLH1 archive into `/guilded import history` and type `IMPORT` in the confirmation step.
- Imported records persist locally in a separate per-character, guild/realm/edition-scoped archive. Filter history, skip matching stable IDs, reject conflicts atomically, and undo the last added batch. Importing does not award loot, change EP/GP, or upload the history to Discord.
- Raid signup posts use an event-card layout with clearer roles, player details, attendance states and overflow summaries.
- Public website/companion reliability uses a stable authenticated origin, bounded retries and an unavailable page. The origin correction is already deployed; the candidate carries the reviewed source.
- The private bug inbox keeps player reports visible during automatic-error floods and warns when bounded results are incomplete.
- French companion strings and French/German/Spanish addon import messages are included.
- Connect multiple named companion devices without disconnecting the others. Manage and revoke connections from your account page.
- Enabled Windows connection profiles keep syncing in the background, recover after sleep or an unavailable folder, and share addon output safely. The selected connection has write priority; other connections continue uploading.
- Optionally connect Battle.net to discover and privately select verified characters and an account main. Discord still controls guild access. This does not change guild mains, publish alts or replace addon sync. The server owner must first [register and configure a Blizzard application](BATTLENET_SETUP.md); Forever API discovery remains disabled pending verification.

## Updating and limits

Keep existing SavedVariables and companion profiles. The importer retains source timestamps without inventing a timezone or score. Missing stable IDs require acknowledgement; overlapping files without IDs cannot be reconciled automatically. Gargul JSON preserves more detail than TMB CSV. See the [import guide](LOOT_HISTORY_IMPORT.md).

The imported archive is in the character's GuildedRosterToolsDB, outside the existing GuildedDB backup command. Back up the character's SavedVariables/Guilded.lua after a clean logout. Historical records are not synchronized between officers.

The automatic-sync feature adds migration `20261127000000_companion_devices_battlenet`: device labels and private Battle.net identities/character selections. Apply backend migrations and routes before distributing the updated companion. Existing companion links remain valid; other devices are no longer revoked when pairing. Unselected legacy desktop profiles stay off until selected or enabled. WoW still saves on `/reload` or logout and loads downloaded standings on `/reload`. Battle.net discovery refresh requires reconnecting; its access tokens are not retained.

No dungeon scoring-policy or license change is introduced. Optional GitHub installers remain unsigned. The existing free Store route supplies signing only after certification. See the [sync handoff](AUTOMATIC_SYNC_HANDOFF_2026-10-29.md) for validation and the remaining live-provider checks.

Validation, provider gates and remaining real-client checks: [November 4 release candidate](NOV4_RELEASE_CANDIDATE.md). Actual WoW gameplay and representative player export acceptance remain unperformed; the owner's earlier waiver remains a waiver.

The December pricing feature adds migration `20261128000000_raid_pricing_policy`: opt-in core policies/revisions, per-core automatic-decay cursors and immutable loot quote snapshots. Apply the backend migration before distributing matching clients. Existing cores and point balances are not reset or automatically opted in.
