# Guilded 6.2.0 — Prepared CurseForge upload text

**Hold until [acceptance](V6_2_GAME_ACCEPTANCE.md) is complete.** This is draft
publication copy, not a claim that 6.2.0 is available. Existing 6.1.2 downloads
remain the public release during testing.

File: `Guilded-v6.2.0.zip` from the approved artifact manifest. Its only root
folder is `Guilded`. Do not upload the companion installer or the whole dist folder.
Display name: **Guilded 6.2.0**. Intended type after acceptance: **Release**.
Keep the existing license and select only client versions verified in the test
record. Interface declarations alone are not evidence of compatibility.

## Changelog to paste after acceptance

Guilded 6.2.0 improves addon-only guild management and dungeon progress.

- Officers can manage local cores, loot rules and main/bench rosters without Discord.
- Standings show their source; backup/restore carries local rosters and accounting
  together, with a preview and undo for record-keeper handover.
- Deadmines final-boss detection works with the observed Forever encounter ID
  when the encounter journal is unavailable.
- Boss-fight timing continues in the background without a floating timer popup.
- Seasonal views support Best 8 competitions while preserving older season history.
- The updated companion supports lighter uploads, quicker standings refreshes and
  a separate GuildedData recovery folder that survives addon updates.
- Standalone officers can opt into ledger exchange; duplicate entries count once
  and voids propagate. It stays off unless officers enable it.
- Party games are an optional separate Guilded Games addon. Guilded retains
  independent soft-reserve rolls and SR+ support.

Install the complete addon folder and preserve SavedVariables. Discord and the
companion remain optional. Online seasonal ratings require a connected guild;
installing the addon does not change your guild's season or scoring rules.
Local cores share one guild EP/GP pool. Use one record keeper by default;
optional officer ledger exchange requires coordinated setup and testing.
The separate Guilded Games addon retains its own Alpha status.

## Listing update

State that Guilded 6.2.0 is available only after its release is actually published.
Keep hosted-bot approval requirements, the noncommercial license and optional
support wording. Link the matching published source/tag and installer; keep
the addon-first path prominent. Replace stale 6.0 copy rather than appending
contradictory version claims. Use screenshots of this accepted candidate.
