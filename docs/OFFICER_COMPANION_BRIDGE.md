# Officer-assisted WoW synchronization

Prepared for the next update (6.1); public 6.0 stays unchanged until the
two-player checks below pass. This is a private development patch.

Members use the addon and Discord. An officer uses either the online companion
or the optional desktop companion to bring Discord guild data into WoW, then
shares it with online guildmates. The desktop app remains optional for officers
too: it adds automatic/background file synchronization.

## Private patch test

1. Close WoW on both test PCs. Overlay `Guilded-officer-bridge-test.zip` onto
   the existing 6.0 addon in `Interface/AddOns`. The archive contains only changed
   addon code; it excludes Standings.lua and SavedVariables.
2. Use an officer and member in the same in-game guild and realm. Highpriest,
   previously tested outside the guild, cannot receive this guild broadcast.
3. On the officer PC, connect the companion to the corresponding Discord guild,
   sync and save standings to that WoW installation, then log in or `/reload`.
4. The officer runs `/guilded bridge on`. This permission is bound to the current
   in-game guild. Run it only after checking the companion's Discord guild matches.
5. The member runs `/guilded bridge refresh`, then `/guilded bridge status`.
   Check standings, core rules/pools/rosters and upcoming Guilded raids without
   opening a browser companion or desktop app on the member PC.

The officer can run `/guilded bridge off` to stop the new core/calendar relay.
Existing standings sharing remains available. Changes from Discord require the
officer to save a fresh companion snapshot and `/reload` again.

## What the bridge shares

Existing addon messages share standings and other guild activity. The new relay
adds core loot rules, pools, core rosters and upcoming Guilded raids. Receivers
accept this data only from recognized in-game officers over the guild channel,
for their own guild. A bounded, versioned parser handles chunked data without
executing received Lua. Cached data survives reload; late arrivals request it.

The relay excludes Discord account owner IDs and native Discord scheduled
events, whose visibility may be restricted to the paired officer. It never
shares pairing credentials or grants members ledger-write authority.

## Limits

- Fresh data needs an online officer with a recent companion snapshot. Offline
  members keep their last received cache, which can become stale.
- Members' personal exports are not magically collected when no officer was
  online to receive their addon broadcasts. Personal sync remains available.
- Unguilded characters, private Discord calendar events and personal PoE data
  still need their own companion connection when those features are wanted.
- Large snapshots can take several minutes through the paced addon queue.
  Oversized snapshots report a personal browser sync fallback.
- This patch does not make WoW communicate directly with Discord or update
  files while WoW is running.

## Real-client acceptance

- [ ] Officer and ordinary member have the patch in the same WoW guild.
- [ ] Officer explicitly enables the bridge after checking Discord guild mapping.
- [ ] Member receives current standings without a personal companion connection.
- [ ] Core selection, loot method, GP prices and core roster match Discord.
- [ ] Upcoming Guilded raid details match Discord.
- [ ] Native Discord private events remain on the officer's own PC.
- [ ] Member logs in later and can request the officer's snapshot.
- [ ] Member reload preserves received core/calendar data.
- [ ] A fresh officer snapshot updates changed rules and cancelled raids.
- [ ] Disabling the bridge stops new core/calendar relay.
- [ ] A non-officer cannot enable it or inject accepted snapshots.
- [ ] Changing/leaving guild does not display the previous guild's raid cache.

Record results in [the player test checklist](V6_0_PLAYER_TEST_CHECKLIST.md).
Automated Lua tests cover parsing, authorization, caching, cancellation and
privacy boundaries; they do not replace this two-client check.

Local validation on 5 October 2026: TypeScript, ESLint and addon static checks
passed; the full suite passed 154 files / 1,245 tests. All eight bridge tests
also passed after extending the private-calendar test to the next-raid field.
