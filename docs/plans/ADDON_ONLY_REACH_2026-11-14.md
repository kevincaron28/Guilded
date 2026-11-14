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
- Probe of 14 November 2026 on a real WoW Forever client (one PC): SAY, YELL and EMOTE refuse; zone channels accept the call but the server says the operation is not permitted; a whisper by character name reaches any online player; a temporary custom channel joined with `JoinTemporaryChannel` accepted an addon message and returned it. Not yet proved: a second client hearing it, the join done from addon code at login, cross-faction reach, throttling, and what the join does to the chat frames. Until a two-client test proves them, every item below that needs them must degrade quietly to guild and party relay.
- Budget: `ns.comm.send` (Util.lua) enforces the 255-byte limit, a per-prefix bucket and one shared adaptive budget between both addons, holds guild items inside instances and in combat. Anything new goes through it with a low-value priority.

## 4. Findings

1. **Outside-guild duels of a signed-in member are dropped** unless an officer uploads them: the member snapshot allow-list in `companion-access.ts` has no `externalDuels`, while the apply step reads that snapshot. To confirm with a test and fix first (small, bot only).
2. **The author of a run relayed in a party never learns it landed.** Only the carrier gets the `group:` receipt, so the author keeps offering for 30 days.
3. Every non-dungeon kind is own-companion-only, and the PvP kinds are signed-in only.
4. `docs/ADDON_ONLY_SYNC.md` is out of date (lists the retired availability prefix, predates #880 and the duel ladders).

## 5. Design: one "carry my records" lane

### Addon

- One store, `GuildedCarry.records`, per kind and record key, holding only the player's OWN records (their own characters as author), each small (under a chunk or two), bounded in count and age, pruned by receipt or age. Kinds: dungeon run (the #880 `dungeon.carried` table becomes a kind of it), duel result, outside duel, world PvP weekly counters, battleground report, milestone and achievement entries, character card (level, class, race, professions, attunements).
- Store-and-forward: a record stays until a receipt comes back for its key. It is offered when the addon hears a carrier, again after a long pause, and never in combat or inside an instance.
- Meeting: a carrier is anyone whose companion advertises the feature. Today that is only written to the carrier's own file. Add a one-line announcement `HI|carry|version` that a carrier sends on GUILD, on PARTY or RAID when the group changes, and in the shared meeting channel below. Addon-only players keep a short list of carriers heard (name, when) and never send to a name they have not heard.
- Meeting place for strangers (needs the two-client test): one temporary custom channel per faction and shard, `GldCarry<faction><0-3>` chosen by a hash of the player's name, joined quietly (not added to chat frames, no visible channel number if the game allows), left on logout or when the member switches the feature off. It carries only `HI` announcements and receipts. The records themselves go by WHISPER to a carrier just heard, small messages, paced. If the join is refused, the feature uses GUILD and PARTY only. Member switch: `/guilded carry off` (and `/gdungeons carry off`, which already exists for dungeon runs).
- Visible state, one plain line in the status page and `/guilded carry`: "3 records waiting for a companion", "Uploaded by a companion in your group", "No companion heard yet".
- Diagnostic: `/guilded probe comm` and `/gdungeons probe comm` repeat the channel and whisper checks and write the result to the diagnostics, so the two-client test needs no typed scripts.

### Companion

- Reads `GuildedCarry.records` of the files it already reads, sends them in the existing upload as `carriedRecords` (a list, bounded), and writes receipts back in the file the addon already reads for run receipts, keyed by record. It advertises the `carry` feature next to `group-relay`.

### Bot

- One lane, `carriedRecords`, accepted in a signed or device upload, applied only through each kind's existing applier, never a new write path:
  - the record names its author (a character in the record); only the author's own statement counts, as in #880: the author must be a player of the record (duel winner or loser, run player, the character a counter belongs to);
  - a carried record never replaces first-hand data from the author's own companion and is marked as carried;
  - characters of a guild go to that guild when it is registered (reusing the cross-guild roster lookup of #896); anyone else goes to the public lane only;
  - no Discord id, member id or link crosses from one guild to another; a guild sees the character names, classes, levels and guild names that are already on cards;
  - a carrier has a daily allowance and a ceiling per upload in server configuration (`RUN_INTEGRITY_CONFIG`), and the existing plausibility checks apply to every kind; nothing is said to members about limits or how checks work;
  - receipts: the carrier's receipt lists record keys, and the lane receipts records it dropped, so nobody resends for ever. The receipt to the author arrives when the author's own addon hears a carrier answer, or its own companion's receipt.

### What the bot cannot verify

A counter-style record (world PvP, badge) has one author and no counterparty, so a carrier that edits its own saved file could invent one for another name. The same is true today of any self-report. The bot limits the effect: carried counters are marked, count only for characters it has not seen first-hand from their own companion, are capped by the carrier's allowance, and stay out of ranked boards until a second independent carrier or the author's own companion confirms them.

## 6. Order of work

1. Bot fix for 4.1 (outside duels of a signed member) with a test. Bot only.
2. Author receipt for a #880 relayed run (the carrier's `group:` receipt also reaches the author when it asks). Addon and bot.
3. The generic `carriedRecords` lane on the bot, kind by kind: outside duels, duel results, battleground reports, milestones, then counters and character cards, behind server configuration switches.
4. Addon store, `HI` announcements, whisper transfer, status line and `probe comm`. Companion transport and receipts. Next addon release, separate PR.
5. Two-client real test: a second PC hears the custom channel; the join from addon code at login; whisper to a carrier just heard; chat frame side effects; throttling; cross-faction; a record made while the carrier is offline reaching it later.

## 7. Real-client test between two players must check

- Player A (addon only, no guild) and player B (companion running) in no common group: A's `probe comm` shows the join accepted and B's announcement heard; B's `probe comm` shows A's whisper received.
- A makes a duel and a dungeon run while B is offline; B comes online; A's status line goes from "waiting" to "uploaded by a companion" and B's companion log shows the records sent; the website shows them once.
- The channel produces no chat-frame line and no visible channel slot for either player; `/guilded carry off` leaves the channel.
- Combat and instances: nothing is sent; throttling does not disturb the game's own chat.
- A third player with the addon only cannot make B upload a record for a character that is not the sender.
- Different faction: whether the channel and the whisper reach.

## 8. Decisions for the owner

1. A shared meeting channel for strangers, joined quietly by every addon user, on by default with a member off switch (recommended), or party and guild only.
2. Counters (world PvP, badges) carried by someone else stay hidden from ranked boards until confirmed (recommended), or count at once.
3. Fix the outside-duel drop for signed-in members now (recommended).
