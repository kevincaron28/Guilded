# Core loot and WoW weekly reports

Version remains 5.0.0, protocol 2. Apply additive migration
`20261025090000_core_loot_wow_report` after the rolling core schedule migration.

The owner requested that Quebec Gold retire the guild-wide EPGP pool. Its
`GuildSettings.coreLootOnly` is enabled during the authenticated local deployment.
Other guilds retain their existing policy (the new column defaults to false).
Activation pins existing cores' effective loot method and enables their separate
point pools in one transaction. Existing historical ledger entries are retained;
none are reassigned to a core. A ledger preflight and backup precede deployment.

Every newly created core then gets its own pool and an explicit initial loot
method. Choose that core's method in `/core setup` step 3, the **Méthode de butin**
button in `/core edit`, or `/core rules loot_mode:...`. Available choices are GP
bids, loot council, soft reserves, and EPGP priority with fixed prices. Guild
default changes no longer change an existing core's chosen method. Shared pools
and reverting the loot method to the guild default are refused under this policy.

Point awards, decay, auctions, direct awards (including zero-GP council loot),
and addon imports require a valid core pool. Item prices do not fall back to a
guild-wide list. Historical reversals retain the original pool. Previously
imported historical addon entries remain deduplicated. A new addon financial
entry without a core leaves the import pending for officer review; select the
core in game with `/guilded core <name>`. Addon loot must match a Discord core
raid. No addon SavedVariables or pairing credentials are overwritten.

The existing weekly report covers WoW raids, loot and dungeons, with the title
**Guilded — bilan hebdo WoW**. It omits server-wide membership and application
counts. `weeklyReportChannelId` sets its dedicated destination independently
from general bot notifications; an unset destination retains the legacy notify
channel fallback. Quebec Gold explicitly targets its current WoW-only
`guilded-annonces` channel. Guild-wide and PoE 2 reports remain future work.

Weekly reservations and Discord delivery jobs commit atomically under a
PostgreSQL guild lock. Failed deliveries remain retryable, concurrent ticks queue
only one report per reset, and an outbox failure rolls back the reservation.
PostgreSQL CI exercises these behaviors plus rejected unscoped financial imports.

The active **Les Dix-Fonctionelles** schedule is Monday and Thursday at 20:00,
`America/Toronto`, with rolling seven-day signups. Each raid has synchronized
signup messages in both the core and general WoW raid channels. Non-core WoW
members can sign up; core roster priority remains in effect. Client/game checks
are separate from automated and REST verification.
