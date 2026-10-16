# Officer-assisted WoW synchronization

The bridge shipped in the owner's 13 October 6.0.0 CurseForge update for
two-player testing. Acceptance remains incomplete. The owner then requested
default-on officer sharing after the member reported waiting for an officer.

Members use the addon and Discord. An officer uses either the online companion
or the optional desktop companion to bring Discord guild data into WoW, then
shares it with online guildmates. The desktop app remains optional for officers
too: it adds automatic/background file synchronization.

## Private patch test

1. Install the current addon on both PCs and reload. The server-segment fix
   must reach the receiver as well as the default-on officer sender.
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

Since the 15 October sync work, a newer addon sends `CAP|2` before `REQ|1` and receives the
compact `DATA|2` (about half the messages); older addons keep getting `DATA|1`. Officers wait
a few seconds before answering and stay quiet when another officer is already sending the same
snapshot. See [the sync speed-ups](SYNC_SPEEDUPS_2026-10-15.md).

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

- [x] 13 October: patched Naomine client reports "Guild data from Highpriest" across the two Forever server labels (owner-reported reception; both characters are WoW officers).
- [x] 13 October: owner reports Naomine retains the sender status and core information after reload with Highpriest logged out, following the prescribed test.
- [x] 13 October: owner confirms core names, loot methods and the compared character's EP/GP match between both PCs and Discord. GP item prices and core rosters are not yet verified.
- [ ] Officer and ordinary member have the patch in the same WoW guild.
- [ ] Officer sharing starts by default with the correct companion guild mapping.
- [ ] Member receives current standings without a personal companion connection.
- [ ] Core selection, loot method, GP prices and core roster match Discord.
- [x] 13 October: owner confirmed the requested upcoming Guilded calendar comparison was already completed.
- [ ] Native Discord private events remain on the officer's own PC.
- [ ] Member logs in later and can request the officer's snapshot.
- [ ] Member reload preserves received core/calendar data.
- [ ] A fresh officer snapshot updates changed rules and cancelled raids.
- [ ] Disabling the bridge stops new core/calendar relay.
- [ ] A non-officer cannot enable it or inject accepted snapshots.
- [ ] Changing/leaving guild does not display the previous guild's raid cache.

Record results in [the player test checklist](V6_0_PLAYER_TEST_CHECKLIST.md).
On 13 October the owner confirmed both PCs updated/connected, but the member's
status initially remained waiting for an online officer.
Screenshots then showed the same guild, with the leader on `Classic Beta PvP`
and the receiver on `Classic Beta PvP 2`; the receiver's fourth `GetGuildInfo`
value was `ClassicBetaPvP`. The bridge now compares the reported guild home,
normalizing spaces in the server label, instead of requiring both characters'
local server labels to match. This preserves saved guild keys and still rejects
different guild names or different guild homes. New snapshots include the guild
home; older broadcasts from the home server remain accepted. Both directions
and cached reloads have regression coverage. The receiver needs this update;
the owner subsequently confirmed Naomine reports "Guild data from Highpriest"
after installing the patch and reloading. This proves reception, not current
standings, content correctness, reload persistence, or ordinary-member permissions.
Automated Lua tests cover parsing, authorization, caching, cancellation and
privacy boundaries; they do not replace this two-client check.

## Preventing realm-label regressions

The bridge does not special-case segment 2 or remove trailing numbers. Any local
realm label works when both clients report the same guild name and guild home
through `GetGuildInfo("player")`. Its fourth result is normalized for whitespace;
numbers in the actual guild home remain meaningful. Never treat two realms as
equivalent solely because removing their numeric suffix makes their names match.

Offline regressions cover labels 1, 2, 3, 4, 12 and 100 as both sender and
receiver, numbered-to-numbered transfers, legacy home-server broadcasts and
cached reloads. These are simulated labels, not confirmation those segments
exist. A same-named guild with a different home is rejected even when its local
realm label matches the sender's. If the client has not supplied the guild home,
the bridge falls back to the local realm and cannot yet prove a cross-segment
match; it accepts a fresh broadcast once the home becomes available.

Keep cross-PC guild identity separate from saved-data keys and character realms.
The companion's `wowGuild` upload binding and Discord core/raid realm checks
still compare local/configured labels. Extending the guild-home identity to
those paths needs an explicit compatibility design and regression coverage;
the bridge fix alone does not make those checks segment-aware. Preserve existing
SavedVariables, companion bindings and distinct-realm separation when doing so.

Local validation on 14 October 2026: all 178 test files / 1,503 tests passed,
including 28 officer-bridge cases. TypeScript, ESLint and addon static validation
also passed. Only regression tests and this guide changed for this follow-up;
the existing bridge implementation already handles arbitrary segment labels.
No additional real-client segment, installation or deployment is verified here.

Local validation on 5 October 2026: TypeScript, ESLint and addon static checks
passed; the full suite passed 154 files / 1,245 tests. All eight bridge tests
also passed after extending the private-calendar test to the next-raid field.
