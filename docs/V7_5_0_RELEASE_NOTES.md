# Guilded 7.5.0 release candidate

This candidate combines the release-gap work and Claude's merged raid-preset and
test-raid fixes. Public downloads and production remain 7.4.0 until release gates
complete. Protocol remains 2.

- Officers can preview and apply main/alt changes on the web roster with a
  short-lived, user-bound confirmation and an atomic audit record.
- Roster participation uses completed raid and dungeon evidence, with 7/30-day
  filters and exports; absent evidence is distinguished from missing records.
- Members can explicitly post availability for 15, 30 or 60 minutes within their
  selected guild and edition, revoke it, and let it expire automatically.
- Event boards and reminders support separate WoW editions. Discord permission
  and recovery checks run outside the database transaction, with fresh checks
  before delivery and bounded history recovery.
- Classic resistance/totem coverage and Era/Forever world buffs are optional.
  Stored Chronoboon buffs are excluded from active observations.
- Raid preset choices follow the guild's edition. Test-raid start, finish,
  dungeon and cleanup acknowledge Discord before slow work, preventing timeouts.
- Microsoft Store MSIX packaging uses the reserved product identity, Store
  updates, Windows startup settings and protected credentials in a separate
  profile folder. Store approval is a separate track, not a published claim.
- A bilingual privacy notice describes data use, retention and private Discord
  support for access/deletion requests. The existing license is unchanged.

The standard Windows installer remains unsigned. Choose the addon ZIP matching
Forever, Classic Era, TBC, Mists or Retail; unsuffixed ZIPs target Forever.
Game/two-PC acceptance, Forever custom spell confirmation and benchmark calibration
remain pending. See [acceptance](V7_5_0_GAME_CHECKLIST.md).
