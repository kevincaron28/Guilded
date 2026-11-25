# Guilded 9.5.7 release notes

Prepared 25 November 2026. Protocol 2, WoW Forever only. Companion change; the addon only changes its version number.

Real-client checks: docs/V9_5_7_RELEASE_ACCEPTANCE.md.

## Companion

- The live standings poll backs off while nothing changes: 15 s, then 30 s, up to 5 minutes; a change, a save or an upload ends the wait (#1300). About 280 requests a day per quiet connection instead of about 7,000, so the website Worker stays under its free daily limit once members update. Details: docs/WORKER_REQUEST_BUDGET_2026-11-25.md.

## Website and bot (already live)

- consent.js is a static file and robots.txt has a 10-second crawl delay (#1300).
- New Discord cards (community badge, shelf, season, final top, bank week), card paintings, a raids header and badge emblems (#1293, #1295).
- Server routes for phone app 0.6.0: push alerts, guild activity feed, crafting, character page (#1296-#1299). The phone app keeps its own version.

## Addon

- Version 9.5.7, no functional change.
