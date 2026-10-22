# Standings views and standalone follow-up — 14 October 2026

The Standings page previously read the entire guild standings map, regardless
of the selected loot core. This explains why linked characters outside a core
appeared in the screenshot; their appearance did not establish membership.

The view button now cycles between guild-wide standings and each exported
core. Core views include only roster characters, including backups, bench and
trial entries, and use that core's separate pool or its shared guild pool as
configured. Local pending entries use the existing effectiveStanding logic.
Viewing a different core does not change the active loot/award core. The initial
view prefers the active loot core or the player's unique roster membership.
Empty rosters remain empty; a selected outsider is labelled as outside the core.

Read-only live inspection found two exported cores, both with empty rosters.
No members were added, removed or guessed. Core roster setup is therefore needed
before these views contain players. Guild-wide standings remain selectable.

Standalone product direction proposed to the owner:
- First-run In-game only setup, with Discord/companion connection optional.
- Explicit local core creation, primary/backup roster editing and loot rules,
  without requiring Discord signups. Restrict shared authoritative roster and
  standings changes to the designated guild officer; preserve local backups.
- Keep local scores/history available and label self-reported peer data versus
  verified online seasonal data. Do not present unsynced local state as a server
  ranking or silently merge conflicting officer ledgers.
- A later connection should preview imported rosters and balances, require an
  explicit source choice and preserve a recovery snapshot; never overwrite a
  local guild setup silently.

This turn implements only the core standings view. The standalone setup/roster
editor is a proposed next feature, not implemented here. See the existing
STANDALONE_ADDON_ROADMAP.md for current capabilities and trust boundaries.
A separate owner-requested website chat is handling recruitment and web design.

Validation: all 174 files / 1,445 tests, TypeScript, ESLint and addon validator passed. Addon ZIP rebuilt. Minimap.lua and Locale.lua installed locally with matching SHA256 hashes; prior files backed up under C:\Users\Kev\Desktop\Quebec Gold Bot\backups\core-standings-20261014-060418. SavedVariables, standings and pairing untouched. Visual acceptance requires /reload. No server deployment needed for this addon-only change.
