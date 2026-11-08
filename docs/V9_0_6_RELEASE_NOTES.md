# Guilded 9.0.6 — release notes (8 November 2026)

Companion downloads from the Guilded website, an achievement probe for WoW Forever, and the bot updates live since
9.0.5. Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## Companion

- **Website first.** The companion checks for updates, downloads its installer and installs or repairs the addon from
  guilded.kcaron.top first, with GitHub as the fallback. On 8 November GitHub's downloads timed out for hours; members
  are no longer stuck when that happens. Every file is checked against its SHA-256 before use. (#633)

## In game (addon)

- `/guilded probe achievements` lists which achievement information WoW Forever gives addons, so achievement badges
  can grow past professions. Read-only. (#625)

## Discord bot and phone server (already live)

- Guilded Clash, the card game: collection and packs, 150 cards, AI and PvE matches, guild-only trading, friendly and
  ranked player-vs-player, balanced on thousands of self-play games. The phone screens ship with the next phone app.
  (#626, #631, #636, #638, #639, #642, #644, #647)
- Board channels: plain footers, full names, French labels, clear PvP panels. (#632, #637)
- Standings answers always leave within 17 seconds. (#634)

## Still owed

The achievement probe's results from a real client, and a companion update over a running app on a second PC.
