# Guilded 6.2.0 — Prepared CurseForge upload text

**Approved for upload by the owner on October 16, 2026**, before the
[real-client checks](../V6_2_GAME_ACCEPTANCE.md) were run; they continue as follow-up.
Upload exactly the `Guilded-v6.2.0.zip` whose SHA-256 is in the release's
`SHA256SUMS-v6.2.0.txt`.

File: `Guilded-v6.2.0.zip` from the approved artifact manifest. Its only root
folder is `Guilded`. Do not upload the companion installer or the whole dist folder.
Display name: **Guilded 6.2.0**. Release type: **Release**.
Keep the existing license. Select the same verified client version as 6.1.2 (WoW Forever);
do not add client versions nobody has played the addon on.

## Changelog to paste

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
