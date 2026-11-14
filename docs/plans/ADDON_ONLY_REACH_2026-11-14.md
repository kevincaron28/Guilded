# Every addon user reaches a companion (14 November 2026)

Owner request: anyone with the addon's data can reach someone with a companion to have their stats updated, for all their stats, not only dungeon runs. Checkout audited: main 51da9af3 with #880 (relay through a party), plus #896 (cross-guild run sharing).

## 1. How each kind of data reaches the bot today

"Own companion" is the player's PC. "Guildmate" is the GUILD addon channel. "Party" is the #880 relay. Provenance: what the bot keeps about who reported the record.

| Data | Own companion | Guildmate relay | Party relay | Receipt back to the sender |
|---|---|---|---|---|
| Dungeon runs, guild party | Signed: yes. Unsigned: runs a PC character played | Yes (`GuildedDgn` SUM/OFR/WNT/ACK, catch-up). Carrier must be signed, or an unsigned device that was in the run | see next row | Bot receipt to the uploader; heard copies are acknowledged on GUILD |
| Dungeon runs, mixed or guildless party (#880) | n/a | n/a | Yes, PARTY of 5 or fewer only, carrier needs a fresh `group-relay` marker; public boards, then guilds with a member (#896) | The carrier gets `group:<id>`; **the author gets none** |
| Duels in the guild | Signed member: yes (only duels they fought). Unsigned: no | Heard (`GuildedDuel`) but a third party never uploads them | never | none, re-sent every upload |
| Duels outside the guild | Signed member: **dropped for non-officers** (see 4.1). Officers: yes | never (by design) | never | none |
| World PvP kills, deaths | Signed member only | never | never | none, weekly counters |
| Battleground reports | Signed member only | never | never | none, last 100 kept |
| Milestones, achievements, badges | Signed member only | only a chat line | never | none |
| Level, class, race | Own, or any companion's roster read | Yes (`READINESS` digest), signed carrier, linked characters only | digests accepted only from guild members | none |
| Professions, recipes, cooldowns, attunements | Own | Yes (digest, `GuildedRcp`, attunement lines), signed carrier, linked characters only | never | none |
| Gear, readiness, consumables | Own readiness; officer for the rest | Digests reach an officer's addon only | ready-check answers reach only the requester | none |
| Roster, MOTD, bank | any signed companion | not needed (read from the game) | n/a | n/a |
| Ledger, loot, raids, reserves | officer | officer authority | raid-night only | digest |

## 2. Where a player is stuck ("never" marked X)

| Data | No guild | Guild with no companion | Solo, never groups | Guilded Dungeons alone | Companion offline when made |
|---|---|---|---|---|---|
| Dungeon runs | Own companion, or a party carrier; otherwise X | Kept and replayed 30 days, then X | Own companion or a guild carrier | Same engine; forwards no guildmate runs | Kept and re-offered until receipt, 30 days |
| Duels (both) | X | X | n/a | X (no module) | Kept, re-sent next upload |
| World PvP | X | X | own signed companion only | X (no module) | Only this and last week survive |
| Battleground | X | X | own signed companion only | X | Last 100 kept |
| Milestones, badges | X | X | own signed companion only | X | Whole log kept |
| Level, class, professions, recipes | X | X (peers keep digests 45 days) | own companion only | sends none | re-sent at login |
| Gear, readiness | X | X unless an officer has a companion | X | X | re-sent |

Only dungeon runs can travel through other people outside a guild. Everything else needs the player's own companion or a signed guildmate of the same guild.

## 3. What the game allows (from code, a real-client probe and the owner's test)

- Used today: GUILD (almost all), PARTY or RAID via `util.groupChannel()`, WHISPER for call-for-help replies and bids. INSTANCE_CHAT is only received, never sent, so a party made by the group finder cannot carry.
- Probe of 14 November 2026 on real WoW Forever clients: SAY, YELL and EMOTE refuse; zone channels accept the call but the server says the operation is not permitted. **Proved with two PCs, two Horde characters in no common group and not using guild chat:** both joined a temporary custom channel (its number differs per client, so the name is what counts); an addon message on the channel arrived on the other client in both directions, with the sender's full name; an addon whisper to the full character name ("First Last") arrived in both directions; every send returned 0 and no system line appeared. So the meeting channel plus whisper transfer is workable. **Still unproved:** joining from addon code at login (both joins were typed), cross-faction reach, throttling, and the effect on the player's channel list. Until proved, a refused join falls back quietly to guild and party relay.
- Budget: `ns.comm.send` (Util.lua) enforces the 255-byte limit, a per-prefix bucket and one shared adaptive budget between both addons, holds guild items inside instances and in combat. Anything new goes through it with a low-value priority.

## 4. Findings

1. **Outside-guild duels of a signed-in member are dropped** unless an officer uploads them: the member snapshot allow-list in `companion-access.ts` has no `externalDuels`, while the apply step reads that snapshot. To confirm with a test and fix first (small, bot only).
2. **The author of a run relayed in a party never learns it landed.** Only the carrier gets the `group:` receipt, so the author keeps offering for 30 days.
3. Every non-dungeon kind is own-companion-only, and the PvP kinds are signed-in only.
4. `docs/ADDON_ONLY_SYNC.md` is out of date (lists the retired availability prefix, predates #880 and the duel ladders).

## 5. Design: one "carry my records" lane

### Addon

- **One store**, `GuildedCarry.records`, per kind and record key, holding only the player's OWN records (their own characters as author). Kinds: dungeon run (the #880 `dungeon.carried` table becomes one kind of it), duel result, outside duel, world PvP weekly counters, battleground report, milestone and achievement entries, character card (level, class, race, professions, attunements).
- **Bounds.** At most 200 records and 64 KB in the store, each record at most 2 KB, oldest records dropped first; a record is dropped when its receipt arrives or after 30 days. These are storage limits, not server checks.
- **Store and forward.** A record stays until a receipt comes back for its key. It is offered when the addon hears a carrier, and again after a long pause. Nothing is sent in combat or inside an instance.
- **Pacing.** Everything goes through `ns.comm.send` (255-byte messages, the shared adaptive budget, low-value priority, held in instances and combat). At most one whisper transfer in flight per carrier, at most 8 records per carrier per login session before a pause of 10 minutes, and a record bigger than one message is cut into chunks of 200 bytes (at most 10 per record).
- **Who is a carrier.** Anyone whose companion advertises it. Today the marker is only written to the carrier's own file; add a short announcement `HI|carry|version` sent on GUILD, on PARTY or RAID when the group changes, and in the meeting channel. An addon keeps a short list of carriers heard (name, last heard) and never sends to a name it has not heard.
- **Meeting place for strangers** (channel and whisper proved on two clients on 14 November; the join from addon code, channel-list effects and throttling still to prove):
  - One temporary custom channel per faction. Every carrier joins all shards of its faction; an addon-only player picks a shard by hash of its own name. The starting point is a single channel per faction, moving to shards only when a real client shows one channel is too busy or full. A player in any shard therefore always meets every carrier.
  - It carries only `HI` announcements. Records and receipts go by whisper, never in the channel.
  - Joined last at login (after the player's own channels), never reordered, left on logout or when the member switches the feature off. Whether the join takes a visible channel number, shifts the player's `/1` to `/10` channels or macros, or prints a "Joined channel" line is something to prove on a real client, not assumed. If it does, the feature uses guild and party only on that client.
  - If the join is refused or the channel is full, the feature falls back quietly to GUILD and PARTY relay.
  - Member switch: `/guilded carry off` (and `/gdungeons carry off`, which already exists for dungeon runs). On by default for every addon user (owner decision).
- **Receipts** are accepted only by whisper from a carrier the addon heard and sent to, or from the companion's own file. Nothing read from the shared channel can delete a record.
- **Stale carriers.** A carrier is forgotten after 20 minutes without a new announcement; a whisper that gets the game's "No player named ... is currently playing" answer counts as a failure, and after 2 failures the carrier is dropped for the session. The system line for our own whispers is hidden from the chat frames only if the game allows it without tainting; otherwise it stays.
- **Visible state**, one plain line in the status page and `/guilded carry`: "3 records waiting for a companion", "Uploaded by a companion in your group", "No companion heard yet".
- **Diagnostic.** `/guilded probe comm` and `/gdungeons probe comm` repeat the channel and whisper checks and write the result to the diagnostics, so the two-client test needs no typed scripts.

### Companion

Reads `GuildedCarry.records` of the files it already reads, sends them in the existing upload as `carriedRecords` (a bounded list), and writes receipts back in the file the addon already reads for run receipts, keyed by record. It advertises the `carry` feature next to `group-relay`.

### Bot

- One lane, `carriedRecords`, accepted in a signed or device upload and applied only through each kind's existing applier, never a new write path. Carried records are validated on the server.
- A record names its author, who must be a player of that record. Characters of a registered guild go to that guild (reusing the cross-guild lookup of #896); anyone else goes to the public lane only. No Discord id, member id or link crosses from one guild to another.
- Receipts list the record keys the lane has dealt with, so nobody resends for ever.

### Privacy

Outside-guild duels store the opponent's class, level, guild text and zone as the reporter's client saw them, and show them on the public duel pages. The privacy text for members says so plainly (the member-facing privacy page and the addon's first-run notice, to update with the addon release).

## 6. Order of work

1. Bot fix for 4.1 (outside duels of a signed member). Done in this PR.
2. Author receipt for a #880 relayed run (the carrier's `group:` receipt also reaches the author when it asks). Addon and bot.
3. The generic `carriedRecords` lane on the bot, kind by kind: outside duels, duel results, battleground reports, milestones, then counters and character cards.
4. Addon store, `HI` announcements, whisper transfer, status line and `probe comm`. Companion transport and receipts. Next addon release, separate PR.
5. Two-client real test (section 7).
6. Member-facing privacy text for outside-guild duels.

## 7. Real-client test between two players must check

- Player A (addon only, no guild) and player B (companion running) in no common group: A's `probe comm` shows the join accepted and B's announcement heard; B's `probe comm` shows A's whisper received.
- A makes a duel and a dungeon run while B is offline; B comes online; A's status line goes from "waiting" to "uploaded by a companion" and B's companion log shows the records sent; the website shows them once.
- The channel produces no chat-frame line, no shifted channel numbers and no changed macros for either player; `/guilded carry off` leaves the channel.
- A player in another shard still meets the carrier.
- Combat and instances: nothing is sent; the game's own chat is not throttled by it.
- A third player with the addon only cannot make B upload a record for a character that is not the sender, and cannot delete A's records with a forged receipt in the channel.
- A stale carrier (B logs out) produces no visible "No player named" line, or at most one.
- Different faction: whether the channel and the whisper reach.

## 8. Decisions (owner, 14 November 2026)

1. Every addon user joins the shared meeting channel by default, with a member off switch: the missing piece for a fully functional standalone addon.
2. All PvP data is public and a single report is trusted: carried world PvP and badge counters count straight away, under the same server checks as every other record.
3. The outside-guild duel fix goes in (this PR).

## 9. Built for the next addon release (9.3.2 work, three PRs)

What exists now, and where it differs from the design above.

- **Bot (#910).** `carriedRecords` in the signed upload (the addon snapshot) and in the device upload; answered with `carriedReceipts` (refs `carry:<kind>:<key>`). Kinds handled: outside duel (global duel lane, only as the reporting side's own statement), guild duel and milestone (only for a registered guild's linked character with that exact name, through the kind's existing applier). A record about the carrier's own character is answered without being applied. Table `CarriedRecord` dedupes by (kind, key) and counts per carrier; the per-carrier daily allowance is `carriedRecordsPerDay` in RUN_INTEGRITY_CONFIG. An unknown kind gets no receipt, so a newer addon keeps the record. Announced to companions as feature `carry-records`.
- **Companion.** Reads `<DB>.carry.records` from the saved files, sends `carriedRecords` only to a bot that announced `carry-records` (never in a runs-only upload), writes the bot's receipts to `Carry.lua` beside each installed addon (a file only the carry code writes), and adds `["carry-records"] = true` to `GuildedCompanionFeatures`.
- **Addon.** `Modules/Carry.lua`, shared with Guilded Dungeons by `npm run dungeons:sync`. The store is `GuildedDB.carry` / `GuildedDungeonsDB.carry` (not a separate saved variable): `records` holds what this PC carries for others, `done` the ids already acknowledged, `off` the member's switch. A player's OWN records are not copied into the store: they are collected on demand from the data the addon already keeps (today: its outside duels in `duels.external`, stripped of the check-chain fields), so the saved file does not grow.
- **Frames.** Prefix `GuildedCry`. `HI|1` (a carrier's announcement: guild, group, shared channel). `R|<kind>|<key>|<i>/<n>|<chunk>` (whisper only; 150 bytes of a flat `key=Tvalue&...` record per chunk, at most 14 chunks). `K|<kind>:<key>` (whisper only: a carrier tells the author the bot holds it). The author of a stored record is the whisper sender, never a name the message claims.
- **Pacing.** Everything goes through `ns.comm.send` with the `hold-in-instance` priority and a guard that refuses in combat, so nothing is sent in combat or inside an instance. At most 8 records per carrier per session, then a pause of 10 minutes. A receiver keeps at most 20 records per sender per hour, 20 half-assembled records at once, 200 records in all, for 30 days.
- **Meeting channel.** One temporary channel per faction (`GuildedCarryA`, `GuildedCarryH`), joined 25 seconds after login (after the player's own channels), only `HI` on it. The game's "joined" notice for it is hidden from the chat frames; the "no player named" answer to one of our own whispers is hidden and counted against that carrier (2 failures and the carrier is dropped; a carrier is also forgotten after 20 minutes without an announcement). If the join does not give a channel number, the feature uses guild and group only. Not yet decided by a real client: cross-faction, a busy channel, and the effect on the player's channel list.
- **Switch.** `/guilded carry [on|off]`. The existing `/guilded dungeon carry off` and `/gdungeons carry off` also stop all carrying (one switch for the member).
- **Not carried yet.** Battleground reports, world PvP counters, badge counters, character cards (the bot side has no applier for them yet). Dungeon runs keep their own #880 lane. Member-facing privacy text for outside-guild duels is still to write with the release.
- **Probe.** `/guilded probe comm` now whispers the bare name and, separately, "Name-Realm". The first probe sent only the second form and heard nothing back while a typed whisper to the bare name came back, so the realm suffix is the likely cause of the missing echo (the window was not too short; it is now 8 seconds anyway).

### Two-player real-client check (9.3.2)

1. Player A: addon only (Guilded or Guilded Dungeons), no companion. Player B: the companion running, no common guild or group. Both in the open world, same faction.
2. B: `/reload`, wait a minute: `/guilded carry` says the companion carries records. A: `/guilded carry` shows a carrier heard within a few minutes ("one is in range").
3. A makes a duel with a third player (outside any registered guild). A's `/guilded carry` shows a record waiting; within a minute of B's announcement it says it was offered. B's `/guilded carry` shows it received; B's companion log shows the upload; the website shows the duel once.
4. B `/reload`s once more after the upload: the record is removed from B and A hears the receipt (A's waiting count goes to 0 after A's next `/reload` or the whisper).
5. Chat: neither player sees a joined-channel line, a changed channel number or a "no player named" line (at most one for a stale carrier). `/guilded carry off` leaves the channel and silences both.
6. A third addon-only player C whispering a forged record can only create a record under C's own name; a forged receipt in the channel changes nothing on A.
7. Combat and instances: nothing sent; the game's own chat is not throttled.
8. Cross-faction: whether the channel and the whisper reach (it is not assumed).
