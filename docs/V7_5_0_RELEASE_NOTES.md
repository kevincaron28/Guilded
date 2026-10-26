# Guilded 7.5.0 release candidate

This candidate combines the release-gap work and Claude's merged PRs #226–#230,
including raid and community tools. Public downloads and production remain 7.4.0 until release gates
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
- Raid signup deadlines and a Late button help leaders plan attendance. Voice-channel
  attendance inserts only missing records and preserves concurrent officer corrections.
  Character selection on signup is configurable; team pages show attendance credit.
- Classic Era/Forever guilds can announce upcoming world-buff drops. Loot bidders
  receive optional outbid DMs. World-buff and voice replies stay within Discord limits.
- Public profile previews include scores, and Retail group browsing supports a
  key-level filter. Trial tracking includes end dates, sponsors and officer reminders.
- Officers gain a do-not-invite list, an optional starboard and an optional message
  edit/delete log. Lottery entry uses the post button; the redundant slash join
  command is removed and ticket wording is consistent.
- In game, officers get an Officer tools page: a guild event log kept past the
  game's window, guild bank snapshots, a prospect list with one welcome whisper per
  new member, softres.it and That's My BiS imports and a pug gear check. Members can
  show mains' names in chat and record slow moments. Officer ledger sync sends a day
  of entries as one compressed batch where the client supports it, and group EP
  awards can apply an optional consumable penalty. All are optional parts; the new
  personal switches start off. See the [launch tools checklist](V7_5_0_LAUNCH_TOOLS_CHECKLIST.md).
- Microsoft Store MSIX packaging uses the reserved product identity, Store
  updates, Windows startup settings and protected credentials in a separate
  profile folder. Store approval is a separate track, not a published claim.
- A bilingual privacy notice describes data use, retention and private Discord
  support for access/deletion requests. The existing license is unchanged.

The standard Windows installer remains unsigned. Choose the addon ZIP matching
Forever, Classic Era, TBC, Mists or Retail; unsuffixed ZIPs target Forever.
Game/two-PC acceptance, Forever custom spell confirmation and benchmark calibration
remain pending. See [acceptance](V7_5_0_GAME_CHECKLIST.md).

Deploy the four additive migrations in order: `20261125160000_web_availability`,
`20261125170000_event_editions`, `20261125180000_raid_signup_extras`, then
`20261125190000_officer_tools`. Refresh the changed `/raid`, `/lead`, `/config`,
`/mod` and `/community` command definitions. Coordinate the single Oracle restart
with Kevin and Claude so the live Discord walkthrough can follow immediately.
