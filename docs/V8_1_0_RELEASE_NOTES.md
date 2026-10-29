# Guilded 8.1.0 Candidate

Prepared on 29 October for the 4 November 2026 launch. Protocol remains 2. This is an unpublished candidate; public GitHub, CurseForge and Microsoft Store downloads remain 8.0.2.

## New and improved

- Import RCLootCouncil CSV/JSON or Gargul JSON/TMB CSV through the desktop companion or offline CLI. Review guild, realm, edition and character mappings, then paste the GLH1 archive into `/guilded import history` and type `IMPORT` in the confirmation step.
- Imported records persist locally in a separate per-character, guild/realm/edition-scoped archive. Filter history, skip matching stable IDs, reject conflicts atomically, and undo the last added batch. Importing does not award loot, change EP/GP, or upload the history to Discord.
- Raid signup posts use an event-card layout with clearer roles, player details, attendance states and overflow summaries.
- Public website/companion reliability uses a stable authenticated origin, bounded retries and an unavailable page. The origin correction is already deployed; the candidate carries the reviewed source.
- The private bug inbox keeps player reports visible during automatic-error floods and warns when bounded results are incomplete.
- French companion strings and French/German/Spanish addon import messages are included.

## Updating and limits

Keep existing SavedVariables and companion profiles. The importer retains source timestamps without inventing a timezone or score. Missing stable IDs require acknowledgement; overlapping files without IDs cannot be reconciled automatically. Gargul JSON preserves more detail than TMB CSV. See the [import guide](LOOT_HISTORY_IMPORT.md).

The imported archive is in the character's GuildedRosterToolsDB, outside the existing GuildedDB backup command. Back up the character's SavedVariables/Guilded.lua after a clean logout. Historical records are not synchronized between officers.

No database migration, scoring-policy change, privacy-default change or license change is introduced by this candidate. Optional GitHub installers remain unsigned. The existing free Store route supplies signing only after certification.

Validation, provider gates and remaining real-client checks: [November 4 release candidate](NOV4_RELEASE_CANDIDATE.md). Actual WoW gameplay and representative player export acceptance remain unperformed; the owner's earlier waiver remains a waiver.
