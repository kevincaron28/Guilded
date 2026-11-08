# Guilded 9.0.5 — release notes (8 November 2026)

9.0.5 fixes the "blocked action" popup officers saw at login on WoW Forever. Protocol 2, WoW Forever only.
The bot side is already live. The companion is unchanged since 9.0.4 apart from its version number.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addon)

- **No more "Guilded has been blocked" at login.** WoW Forever refuses addon edits of guild notes, even from a
  click (checked in game on 8 November). The officer auto job "Professions in public notes" tried every few
  seconds, so the popup kept coming back. Guilded no longer writes guild notes on Forever, and any other guild
  action the game refuses is remembered for that client build and not tried again. (#618)

## Discord bot (already live)

- The dungeon run card shows the run's dungeon score next to the time. (#611)
- One group finder for dungeons and PvP: the button asks Dungeon, Battleground, Arena or World PvP first, and every
  group lands in the finder channel. Officers switch it off with `/bg group-finder`. (#619)
- Readable routine notices in the server journal. (#620)

## Still owed

Promotion (Initiate to Member) from an officer client has not been checked on Forever; if the game refuses it too,
9.0.5 shows the popup once and then stops trying.
