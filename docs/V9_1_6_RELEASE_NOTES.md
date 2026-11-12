# Guilded 9.1.6 — release notes (10 November 2026)

**Guild sync and invite fixes.** Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md.

## What changes for members

- **Guild sync works again:** messages no longer exceed the game's 255-byte limit, so standings chunks are no longer silently dropped.
- **`/guilded invite raid`** shows copyable `/invite` lines and no longer calls the invite API (blocked in game).
- **Guild message of the day** is no longer read in combat.
- **"To invite" window:** shows the game's real answer per row (not found, already in a guild, declined, joined), keeps one row per requester, and has a Remove button.

## Technical

- #731.
