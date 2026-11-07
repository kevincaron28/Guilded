# Guilded 9.0.3 — release notes (7 November 2026)

9.0.3 makes Guilded WoW Forever only and ships the fixes made since 9.0.2. Protocol 2. The bot side
is already live; members get the addon and companion parts by updating.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addon)

- **WoW Forever only.** The addons load on WoW Forever (interface 16001) only. Retail Mythic+ and the
  Classic-only paths are gone. Saved data from earlier versions is still read. (#567)
- **World PvP.** The stats from 9.0.2 now feed the world PvP section of the PvP ladder: kills,
  defends and calls answered, weekly from Tuesday. Deaths stay private. (#565)

## Companion

- Syncs WoW Forever only and says so plainly when it finds another version's game folder. (#571)
- The release packages now hold only the Forever zips. (#568)

## Discord bot and website (already live)

- Invite requests: any guild member online in game is tagged (not only officers), and a request is
  marked done by itself when the character shows up in the guild roster; the button stays. (#570, #586)
- Dungeon cards show each member's recorded role (no more two healers or two tanks). (#569)
- Names drawn with decorative Unicode letters now read as plain letters on every card. (#585)
- Commands, rules and the website are WoW Forever only; old addresses redirect. (#573, #577, #578, #581)
- Fixes: two duplicate-record races on simultaneous uploads (#587); deploys reuse dependencies and
  cap memory, so the bot keeps answering during an update (#562, #572).

## Still owed

Real-client checks of 9.0.2's new pages and of the Forever-only addon, and a look at the new invite
tags in a test server.
