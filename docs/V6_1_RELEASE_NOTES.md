# Guilded 6.1.1 — In-game setup and character standings

14 October 2026. Patch release preparation; publication is subject to final
CI, package verification and the real-client setup check.

- New first-run choice: In-game only or Optional Discord connection. Reopen
  it with `/guilded setup`, Home > Guilded setup, or the addon options page.
- In-game-only setup explains local gear checks, dungeon recording, raid
  attendance and loot tools without Discord signups. Save prompts point to
  `/reload` or logout and explain SavedVariables backups.
- Existing connected installations keep their setup. Changing the preference
  preserves points, guild permissions, pairing and rosters; it does not stop
  a running companion. Manual local core editing is not part of this patch.
- Verified seasonal dungeon ratings are per character, including best runs,
  boss records and import gains. Archived season results remain unchanged.
  Online seasonal scores require the optional connection; local run recording
  does not create a verified seasonal ranking.
- Dungeon finder scores gain a visible side tab, level ordering and subtle
  dungeon artwork, with dark overlays for readable text.
- Standings can be viewed guild-wide or per core roster. Core views use the
  configured shared or separate pool and do not change the active loot core.
  An empty core roster stays empty instead of showing unrelated characters.
- English/French setup and standings labels. No database migration; protocol 2.

Addon, bot and companion versions are aligned at 6.1.1. SavedVariables and
personal pairing must be preserved during updates. The Windows installer is
unsigned. Prior unverified gameplay/second-PC acceptance remains follow-up;
passing automated tests does not prove rendered in-game behavior.
