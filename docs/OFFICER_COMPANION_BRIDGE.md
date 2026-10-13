# Officer-assisted WoW synchronization

The bridge shipped in the owner's 13 October 6.0.0 CurseForge update for
two-player testing. Acceptance remains incomplete. The owner then requested
default-on officer sharing after the member reported waiting for an officer.

Members use the addon and Discord. An officer uses either the online companion
or the optional desktop companion to bring Discord guild data into WoW, then
shares it with online guildmates. The desktop app remains optional for officers
too: it adds automatic/background file synchronization.

## Private patch test

1. Install the current addon on both PCs and reload. The default-on follow-up
   changes the officer sender; the existing member receiver remains compatible.
2. Use an officer and member in the same in-game guild and realm. Highpriest,
   previously tested outside the guild, cannot receive this guild broadcast.
3. On the officer PC, connect the companion to the corresponding Discord guild,
   sync and save standings to that WoW installation, then log in or `/reload`.
4. Sharing starts automatically for a recognized officer with loaded companion
   data. Check that the companion's Discord guild matches the current WoW guild.
   An explicit `/guilded bridge off` persists; `/guilded bridge on` re-enables it.
   The companion source binding survives switching the addon's guild data. After
   intentionally changing the companion guild, save new standings and reload,
   then use `/guilded bridge on` to rebind. Legacy standings do not contain a WoW
   guild identifier, so the initial binding uses the officer's current guild.
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
- [ ] Officer sharing starts by default with the correct companion guild mapping.
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
On 13 October the owner confirmed both PCs updated/connected, but the member's
status remained waiting for an online officer. Reception is not yet a pass.
Automated Lua tests cover parsing, authorization, caching, cancellation and
privacy boundaries; they do not replace this two-client check.

Local validation on 5 October 2026: TypeScript, ESLint and addon static checks
passed; the full suite passed 154 files / 1,245 tests. All eight bridge tests
also passed after extending the private-calendar test to the next-raid field.
