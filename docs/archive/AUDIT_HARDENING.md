# Audit hardening (2 October 2026)

What the pre-in-game-test audit changed, for whoever picks this up next. Version stays 5.0.0
and sync protocol stays 2. One additive migration: `20261101090000_addon_held_entries`.

## Why

Every companion upload carries the officer's whole ledger and every guildmate's last gear
digest. The import used to be all-or-nothing, so one row the bot refused (a zero amount, an
award with no raid core in a core-only guild, a pug's EP, a peer's malformed digest) blocked
that officer's uploads from then on, and the failure only reached the server log.

## What changed

**Import (bot)**
- `parseAddonSnapshot` checks each row of the ledger, readiness, character, loot, raid, price,
  calendar, recipe and cooldown lists by itself. A bad row is left out and noted in
  `snapshot.rejected`; a file that is not an export at all is still refused.
- `addon-import.ts` holds what it cannot place and imports the rest. Reasons: `UNLINKED`,
  `NO_CORE`, `UNKNOWN_POOL`, `NO_CORE_RAID`. Held rows live in `AddonHeldEntry`, keyed by
  `(guildId, kind, sourceRef)`. Each later upload retries them; a row leaves the table when it
  imports. A dismissed row is never imported.
- `/import held` lists them with what to do; `dismiss:<code>` / `restore:<code>`.
- The officer log gets one notice when new rows are held. A failed automatic import is posted
  to the officer log (once an hour per cause) and returned to the companion as `applyError`.
- A price set in game with no core in a core-only guild is skipped, not fatal.
- The same gear check (character, moment, source) is stored once, not once per upload.

**Void**
- `/guilded void [player]` marks the newest entry you made as voided. The ledger is never
  edited. The companion sends `voided: true`; the bot skips an entry it never imported and
  writes one `REVERSAL` (`reversal:<id>`, the same guard `/epgp reverse` uses) for one it had.
- The standings response lists `void:<ref>` for reversed addon entries so the addon stops
  subtracting the entry itself.

**Awards shared between officers**
- An award is sent to the raid or party as `LEDGER|<id>|<player>|<ep>|<gp>|<core id>` (this
  replaces the old informational `EPGP|` line) and a void as `LEDGERVOID|<id>`.
- Only officers keep them (`db.peerLedger`), only from an officer in their group, and only
  under an id that starts with the sender's name. They count in `ns.effectiveStanding` until
  the standings file lists the reference, or 12 hours pass. Standings received by guild chat
  carry no reference list, so awards older than that snapshot are dropped (never counted twice).

**Addon**
- An amount is rounded before it is checked; a core-only guild (`GuildedLoot.coreOnly`, new)
  refuses an award with no core; the chat line shows the pool the award went to.
- Peer digests are validated when received; the companion sanitizes saved data from older addons.
- A character is added to `myCharacters` only once its guild is known and matches the loaded data.
- Bid ties use the running core's pool. A standings broadcast whose sender went quiet for 30
  seconds can be finished by another officer.

**Bot runtime**
- `applyDecay` runs in one transaction behind the per-guild advisory lock. Automatic decay
  passes `decay:<pool>:<week>` so a retry adds nothing, and marks the week only after success.
- An uncaught exception is reported, then the process exits for systemd to restart. SIGTERM and
  SIGINT close the companion API, Discord and the database.
- `services/retention.ts` (every six hours): applied uploads after 30 days, unapplied after 90,
  gear checks after 45 days except the newest per character, error reports after 90 days.
- The standings response lists the requester's own ledger references and everyone's from the
  last 30 days (capped at 5000), not the guild's whole history. The addon keeps only the
  references its own ledger needs.

## Deploy

1. Usual gates (CI including the PostgreSQL job, ledger preflight, backup).
2. Deploy the bot: the service applies the migration at start. Slash commands refresh at login
   (`/import held` is new).
3. Rebuild and install the addon ZIP and the companion: both changed, and they should go out
   together with the bot. An older addon next to a newer one keeps working; it ignores the new
   `LEDGER` messages and never sends `voided`.

## Still to check on a real client

- `/guilded void` after the entry reached Discord: a reversal appears in `/epgp history`, and
  the in-game standing is right before and after the next sync.
- Two officers in one raid: the second sees the first's GP charge in priority within seconds;
  totals do not double after both companions sync.
- A core-only guild: an award with no core is refused with the hint; loot recorded before
  `/guilded start` shows in `/import held` and imports after `/guilded end`.
- `/import held` on Discord, dismiss and restore.

## Not done

- Officer ranks (`/guilded officer rank`) are still a per-client setting and are not shared.
- A ledger entry with no stable reference (hand-made JSON uploads) still uses one reference per
  character and import, so two such entries for one character in one file collapse into one.
- The standings endpoint is still computed on every poll (no per-guild cache).
