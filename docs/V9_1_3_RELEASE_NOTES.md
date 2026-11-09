# Guilded 9.1.3 — release notes (9 November 2026)

**Plug-and-play fixes from the two-PC fresh-install test of 9.1.2.** Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md.

## What changes for members

- **Addons update by themselves** (Guilded and GuildedDungeons) with the companion; the zero-setup companion home is clearer.
- **Dungeon runs no longer wait forever** for an unsigned companion: the bot's receipts reach the addon, and the stale "linked as" line is cleared.
- **French** texts fixed (including the `/gdungeons` string); `/guilded dungeon` is never silent; Envoyé/Reçu times; the panel drag fix.
- **Repair** shows Discord sign-in as optional. The uninstaller keeps your data and removes the startup entry. A website install imports the Store settings.
- The website Start page matches the new-member test.

## Technical

- #705 fresh-install fixes, #706 Start page, #707 Repair / uninstaller / Store settings import, #708 unsigned run receipts.
