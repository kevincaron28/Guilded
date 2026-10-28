# Guilded 8.0.0 Release

Launch preparation for WoW Forever, Classic Era/Hardcore, Burning Crusade Classic,
Mists Classic and Retail. Guilded, Guilded Dungeons, the optional companion and
Discord bot share version 8.0.0; addon protocol remains 2.

## What changed

- Safer Discord sign-in with a typed confirmation code, bounded attempts and
  concurrent-approval protection. Windows protects saved connection credentials;
  local-data removal attempts to revoke each saved online connection.
- Shared inbound addon validation, bounded outgoing queues, priority for
  interactive ledger notices and fair background synchronization.
- Bounded SavedVariables parsing and streaming reads, clear oversized-file errors
  and recovery of saved ledger entries after interrupted uploads.
- Lossless ledger storage compaction with a verified recovery copy and concurrent
  write protection. Complete history and void/replay references are retained.
- New Retail season rating snapshots support bounded overtime credit. Existing
  v1 snapshots keep their rules. Each dungeon counts once across affix sets;
  public and guild views explain the applicable policy in English and French.
- Hosted edge throttling, security headers, authenticated origin requests and
  migration from the retired hosted companion address.
- French HTML rendered before JavaScript, translated metadata, language
  alternatives, sitemaps, accessible names and mobile navigation refinements.
- Core presentation helpers extracted for clearer ownership and maintenance.
- Full community leaderboards resolve names consistently. Raid signup without
  a linked character shows useful linking guidance instead of an exception.
- Microsoft Store download links in setup, help, guides and both public sites.

All previously delivered roster, crafting, teams, GRM archive import, optional
buffs, calendars, raid signup/attendance, four loot methods, EPGP, dungeon
observations/badges/privacy, recruitment, community activities, reports and
optional PoE2 mapping remain included. Existing SavedVariables are preserved.

## Downloads and updating

Use the ZIP for your actual client edition. The unsuffixed ZIP is the Forever
build. Install the complete addon folder while WoW is closed; preserve saved
data. With both addons installed, Guilded handles recording.

The optional [Windows companion is on Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9).
Store users update through Microsoft Store; check the offered version because
Microsoft controls certification. The standalone installer is also provided on
this release. Its Authenticode signing status is unsigned; Store signing and
certification are separate. The online companion needs no Windows installation.

Older companions configured with `guildedqc.duckdns.org` must update to 8.0 or
use `https://guilded.kcaron.top/companion/`. Independent guild hosts remain supported.

## Validation and known limits

Retail 12.1.5 build 70575 owner checks passed for load/reload, Home, My character,
Settings, French labels/layout, dungeon diagnostics and the Run/Season views.
The captured saves had no errors during the recorded sequences. These checks
used the review build. The owner explicitly waived remaining hands-on checks and
requested bug-report-driven follow-up after release; Classic and full dungeon,
two-PC, upgrade and signed-in Windows acceptance are not claimed passed.

Automated checks and publication evidence are recorded in
[launch readiness](V8_0_LAUNCH_READINESS.md), with
[engineering details](V8_0_ENGINEERING.md),
[accessibility results and limitations](V8_0_ACCESSIBILITY.md) and
[Retail evidence](RETAIL_ACCEPTANCE_2026-10-28.md).
Dungeon benchmarks and Guilded keystone ratings remain provisional. Unreviewed
routes do not acquire a verified score, and current-v1 evidence policy remains
active. The owner's independent-uploader exception remains in force.

Report problems with `/report bug` (screenshots supported), including your game
edition, Guilded version, steps and error text. Preserve your original saved data.
No release can guarantee that future gameplay reveals no bugs.
