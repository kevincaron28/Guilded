# Shared dungeon scoring lock

Owner decision, 24 October 2026: **lock dungeon scoring settings for all guilds**.
Implemented in candidate source; no production deployment or public release is
implied. Public release remains on hold for game, French-client and two-PC acceptance.

- `/officer dungeon config` is read-only. Rule points, repeat shares and Dungeon
  Master thresholds cannot be edited. The target command is removed; calibration
  evidence remains available without a write option. Cached old commands are
  rejected privately, without log-channel posts or leaderboard updates.
- The service setters and recalibration writer are removed. Old guild JSON
  overrides remain stored for history but no longer affect new participation
  awards or the displayed current participation policy.
- New official guild seasons use `OfficialSeason.rules`, the same frozen snapshot
  used publicly. They do not inherit a guild's old targets or recalibrations.
  Late-joining guilds use that same snapshot and official start time. A missing or
  unreadable official snapshot blocks creation/rotation instead of falling back
  to potentially different defaults.
- The existing additive route policy remains: newly verified routes can be added
  centrally without changing existing targets, bands, penalties or best-N.
  Existing guild seasons receive those additions after a backup, so joining later
  does not provide access to a different set of routes.
- Existing runs, point transactions, season standings and historical rating rules
  are preserved. Legacy beta seasons keep their historical scoring until the
  official rotation. No live database migration, reset or target rewrite is needed.
- Officers retain audited invalidation and manual **guild participation** point
  corrections. These do not change scoring settings or public competitive scores.
- Shared rule changes require a reviewed product change and a future season.
  Read-only calibration evidence is a research aid, never an in-season override.

Regression coverage includes cached command rejection, differing stored guild
overrides yielding identical new awards, historical transactions staying intact,
shared official rotation, late joins, missing snapshots and additive routes.
English/French help and both addons describe the lock.

Local validation: 267 files / 2,244 tests, TypeScript, ESLint, both addon validators
and `git diff --check` passed. Final-head CI and live candidate command acceptance
remain separate gates. See [Claude's session handoff](AI_HANDOFF_2026-10-24.md).
