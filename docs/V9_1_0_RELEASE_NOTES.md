# Guilded 9.1.0 — release notes (9 November 2026)

**The companion no longer needs any setup: install it and it syncs.** Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md.

## What changes for members

- **Install and play.** The Windows companion finds your WoW folder, and Guilded picks the Discord server from your
  character's in-game guild. No Discord sign-in, no pairing code, no server to choose. If it cannot tell which
  folder or which server, it asks once.
- **Signing in with Discord is optional.** It adds the personal things: Discord messages, your page on the website,
  and confirmed characters. Until you sign in, your characters show to officers as *reported* (in `/roster gaps`);
  signing in confirms them and the next sync sends everything as before.
- **What an unsigned companion sends:** only your in-game guild and up to 12 characters on this PC (name, realm,
  class, race, level). Nothing else leaves your PC until you sign in.
- **Already signed in?** Nothing changes for you.
- If your guild is not set up on Discord yet, the companion says so and your data waits.

## For officers

- Characters reported by companions without a sign-in appear in `/roster gaps` until a member confirms them.

## Technical

- Bot: `POST /api/v1/device/register`, `/device/uploads`, `/device/claim` (rate-limited), migration
  `20270129000000_companion_devices`. The website Worker allow-lists these routes. (#684)

## Still owed

Fresh-PC test of the zero-setup flow (docs/ZERO_SETUP_COMPANION.md, "What the owner should test").
