# Guilded 9.1.5 — release notes (10 November 2026)

**Run trust and confirmed characters.** Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md.

## What changes for members

- **One companion carries addon-only members' runs:** unsigned companions also send dungeon runs that guildmates' addons relayed.
- **A run counts** with a roster/linked party member or a second PC agreeing. `/guilded dungeon` shows "received by Discord, not counted yet: reason".
- **Season 1 leniency:** runs only anonymous devices vouch for still count, marked as device runs; this turns off when Season 2 starts.
- **"Confirmed" characters** need the member's own companion plus the guild roster or a heard verify code; nicknames follow confirmed mains only.

## Technical

- #724, #725, #726. The bot side of all three is already live.
