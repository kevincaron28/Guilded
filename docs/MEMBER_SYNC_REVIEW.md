# Member sync review

Review this working copy before committing. In an in-game-only guild, any member can enable ledger sync on their PC with `/guilded ledgersync on`. In either mode, `/guilded sync peers` asks online guildmates for current standings, missing item insights and the dungeon board. It also requests the ledger when enabled, or the configured guild bridge in connected mode. Repeat commands within 30 seconds are coalesced.

## How an award reaches an offline officer's guildmates

1. When an officer serves a compressed day or a single-entry day, the officer announces the SHA-256 fingerprint over guild chat. The original bytes go to the requester by whisper.
2. Opted-in recipients retain up to 16 receipts or batches in the guild's saved data. A member missing an announced batch asks who has it. The recipient selects one responder and requests the bytes by whisper.
3. A recipient checks the full digest against the directly received receipt before applying the original entry and reversal rules. Repeating the exchange leaves balances unchanged. Guild membership and role checks use the full character address and are repeated before a queued send.

A member who missed the original receipt still needs an officer to supply the data or announce it again. Evicted batches use the ordinary ledger comparison. A client without the required bit operations uses direct officer sync. A client without the compression API can receive individual entries directly. Previously released clients continue using their existing protocol and permission checks. These limits matter when scheduling a rollout.

## Why this design

- AceComm splits transfers and uses traffic priorities. Guilded already has a paced queue, so the relay uses its bulk queue and lockdown retries. [AceComm API](https://www.wowace.com/projects/ace3/pages/api/ace-comm-3-0)
- WeakAuras selects a transmission format and routes cross-realm transfers explicitly. Guilded keeps its existing compression negotiation and verifies the exact roster address for ledger traffic. [WeakAuras transmission source](https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAuras/Transmission.lua)
- Gargul reports reducing the data sent for awards, wishlists and bids. Guilded asks for missing data, selects one bulk sender and repairs item data independently when the standings are already current. [Gargul release history](https://github.com/papa-smurf/Gargul/releases)
- TradeSkillMaster distributes data from the desktop to a helper add-on, and documents the reload needed to see fresh data. Guilded retains its authenticated companion for the boundary between the game and Discord. Addon-to-addon updates can happen while logged in. A peer refresh does not flush SavedVariables or perform an external upload. [TSM AppHelper](https://support.tradeskillmaster.com/en_US/addon/how-do-i-fix-an-error-about-appdatalua-being-empty) · [TSM refresh behavior](https://support.tradeskillmaster.com/why-does-my-addon-keep-telling-me-no-recent-auctiondb-scan-data-found)

## Live acceptance for Claude

Local verification: all 827 Lua tests passed across 68 files; the 22 ledger tests also passed after adding the guild-switch check. Both add-ons passed static validation, and all ten edition packages built and verified. This worktree is based on `bcaa68db`; review against the current release before integrating.

Use three opted-in clients with the same review build in a test guild. Have two ordinary members hear an officer's announcement, and let one obtain the batch. Take the officer offline before the other receives the payload, then run `/guilded sync peers` on that member. Compare the entry IDs, balances and a reversal across the clients. Repeat after a reload and a messaging lockdown. Record time from request to last chunk and how many peers sent payloads. Simulated-client checks cover integrity and convergence; live timing is still open.


## Claude review (integration onto origin/main 7826e4ff, 5 Nov 2026)

Reviewed by reading every changed file and tracing the paths below. Nothing here has been run in a real client; see "Unverified live".

### What changed in the integration (beyond Codex's patch)

1. `LedgerDigest.lua` no longer needs `bit.ror`. WoW's `bit` table is not guaranteed to have a rotate (the test harness defined one, which hid this), so the relay would have been silently off in game. The rotate is now built from `rshift`/`lshift`/`bor` when `ror`/`rrotate` is missing, and the module stays off if even those are missing.
2. `LedgerDigest.lua` hashes `"abc"` when it loads and compares with the standard SHA-256 vector. If this client's bit library gives a different answer, `ns.ledgerDigest` is cleared (relay off, officer-direct sync unchanged) and a diagnostic is logged. This also makes the in-game check trivial: if the relay is on, the hash is right.
3. `LedgerRelay.lua`: a holder whose bytes fail the digest is ignored for 10 minutes, and one that was chosen and then went quiet for 5 minutes, so a single bad peer cannot keep winning the "first HAVE" race and starve a receiver. Bounded (64 entries, in memory, cleared on a guild change).
4. Tests: the harness `bit` mock now matches WoW (no `ror`), plus a native-rotate vector test, a no-bit-library test, and a refused-sender check in the altered-award test.

### 1. Trace: officer -> member A -> member B, officer offline for the last hop

| Hop | Code | Checks |
|---|---|---|
| Officer serves a day to A (A sent SUM/AUTH/DAYS) | `LedgerSync.lua` `sendDay` -> `sendBatch` / `sendEntry` | `ns.isOfficer()`; a member target is rate-limited per day hash (`memberTransfers`); the target role comes from `ns.ledgerPeerRole` (full address). |
| Officer announces | `relay.remember(wire, self, true)` -> `SEAL\|1\|<sha256>` on GUILD, at most once per 300 s per digest | wire <= 12002 bytes; the officer keeps the bytes under that digest. |
| A receives the bytes by whisper | `onMessage`: `active()`; channel is WHISPER; `ledgerPeerRole(rawSender)` is `officer` (live roster, full address, rank in `officerRanks`, or a configured name that is unique in the roster); then `applyWire` -> `receiveEntry` (id format, integer EP/GP, +/-100000, not from the future, void flag 0/1, dedupe by id) | `kind == E or Z` from a non-officer is dropped before anything is parsed (`LedgerSync.lua:489`). |
| A remembers | `relay.remember(wire, officerName, false)` | stored in `DB.ledgerRelay` (guild key, 16 records, FIFO). |
| B hears the announcement | `relay.handle`: kind `SEAL`, channel GUILD, role `officer` | only then is the digest recorded, with the announcing officer's address. Anyone else's `SEAL` is ignored. |
| B asks | 15-20 s later `relay.request` -> `SEEK` on GUILD for one missing digest | only digests already recorded from an officer; one outstanding request; 15 s between requests. |
| A offers | `HAVE` by whisper to the asker, once per 5 s per digest, only if A has the bytes and its queue is short | role of the asker is a roster member (checked before `relay.handle`). |
| B picks one | first `HAVE` wins (`incoming.sender`); later offers are ignored; `FETCH` is whispered to that one holder | skips holders that recently failed or stalled. |
| A sends | `FETCH` accepted only from the peer it offered to, within 120 s, with one transfer at a time (5 s gap, queue under 8); then `PART` x n (160 bytes each) | all through `ns.comm.send` with a guard. |
| B assembles | `PART` accepted only from the chosen sender, count and length checks, 120 s of inactivity | at the last part: `ns.ledgerDigest(wire) == digest announced by the officer` -> `applyWire` (same entry rules as a direct officer message) -> stored -> `onDelivery`. |

The officer can be offline for the last three rows: B needs only the officer's earlier `SEAL` (kept in saved data across a reload) and any holder.

### 2. Altered award rejected; where authority comes from

- The authority is the digest in a `SEAL` that the game delivered on the GUILD channel from a sender whose full address is an officer on the live roster. `HAVE`, `PART`, `FETCH` and `SEEK` never create or change a digest; they only reference one already recorded from an officer.
- B applies relayed bytes in exactly one place (`LedgerRelay.lua`, end of `PART`), after `ns.ledgerDigest(wire) == digest`. A holder that alters one byte, adds an entry or swaps an amount produces a different hash and the transfer is dropped (the holder is then skipped for 10 minutes).
- Retained receipts: `records[digest]` is created only by (a) an officer `SEAL`, or (b) bytes received directly from an officer whisper. The persisted `wire` is re-served as-is, and the receiver checks it against its own officer-recorded digest, so a tampered saved-variables file cannot reach another player.
- Fallbacks: E and Z messages from a non-officer are dropped before parsing (`LedgerSync.lua:489`). The older SUM/AUTH/DAYS/GET exchange never pulls from members (`GET` and the empty-days request require the sender to be an officer), and members never serve (`sendDay` requires `ns.isOfficer()`).
- Two caveats: (a) a name listed in `settings.officers` counts as an officer when it is unique in the roster. That is the same local trust the rest of the addon uses, but it means "officer" is as strong as that local list; (b) officer status is checked when the `SEAL` is heard, not when the bytes arrive, so an officer demoted in between still vouches for what they announced earlier.

### 3. A duplicate never changes a balance twice

`receiveEntry` looks the id up in `index().byId` (rebuilt from `DB.epgp[*].ledger`, so it survives a reload). A known id can only be changed by a void, and a void is applied once (`not entry.voided`). A relayed copy, a direct copy and a comparison copy of the same entry therefore converge to one entry. An unvoided copy arriving after the void is a no-op (void wins). Covered by the existing relay test (reversal, repeated exchange, summaries equal).

### 4. Changing guilds

`active()` requires the current guild key to equal the saved key, and resets partners, assemblies, answers and capabilities when the key changes. `cache()` in the relay resets the saved receipts and the in-flight transfer when `DB.ledgerRelay.guild` differs, and ignores everything while `active()` is false. Every send carries a guard that re-checks the guild, officer status and the target's role before each attempt, including lockdown retries (`Util.lua` rechecks the guard on every pump). The roster cache is cleared on `PLAYER_GUILD_UPDATE` and `GUILD_ROSTER_UPDATE`, and a cached row is re-verified by name. The relay test switches guild and sees no response.

### 5. Only one peer sends each requested batch

One request outstanding per receiver; the first `HAVE` is the only one answered with `FETCH`; a holder serves only the peer it offered to (`offerTo`), one transfer at a time with a 5 s gap, and not when its own queue is longer than 8. A second asker simply overwrites `offerTo` for that digest; the first asker's `FETCH` is then ignored and it times out after 120 s and retries (self-healing, slow). Timeouts: 15 s without any offer, 120 s without progress. Every holder that has the bytes sends one short `HAVE` whisper, so a large guild produces a burst of small whispers (bounded by the guild's holders and the 8-message queue test); only one sender sends data.

### 6. Missing item data without re-downloading standings

`ns.requestGuildSnapshots` sends `STANDREQ` with the member's own stamp (a responder answers only when its stamp is newer) and, when the standings are current but the item list is not, a separate `ITEMREQ|<stamp>`. A responder answers only when its items are at exactly that stamp, with a 60 s cooldown, jitter, and suppression if someone else's `ITEM` chunks were just heard. `shareItems` refuses to send items that belong to different standings. An empty item list is sent as one empty chunk so "none" is also recoverable.

### 7. Missed announcement

A member who was offline for the officer's announcement and has no holder is not helped by the relay. The next time an officer is online and that member's ledger summary differs, the ordinary comparison makes the officer send the day again, which announces it again (every 300 s at most). I think this is acceptable for this release: the relay is an optimisation for the case where no officer is online, the fall-back is the existing officer exchange that already ships, and the alternative (accepting a digest from a non-officer, or from an unannounced holder) would remove the property that only officers authorize awards. Limit to tell guilds: a member who misses an announcement and logs in when no officer is online has to wait for an officer.

### 8. Sharp edges

- Bit operations: the algorithm was also run in Node with doubles and signed 32-bit results (the way LuaBitOp-style libraries behave) and a shift-built rotate: it matches `crypto` for sizes 0 to 12002. Under fengari it matches `crypto` at the padding boundaries (tests). What can still differ in game is the exact behaviour of WoW's `bit` on values above 2^32, which is why the load-time self-test exists.
- Lockdown (#365): all relay sends use `ns.comm.send(..., guard, "retry-lockdown")`, so a lockdown keeps the ordered packets and the guard is re-evaluated before each retry. Nothing calls `SendAddonMessage` directly (the validator checks this).
- Size: the longest message is `PART` at 238 bytes (limit 255); `SEAL` is 71. Tests assert every pumped message is at most 255 bytes.
- Throttle: one prefix bucket (burst 8, 1 per second). A 12 KB wire is 76 parts, about 70 s. A transfer is abandoned after 120 s without progress.
- Memory: 16 receipts of at most 12002 bytes saved per guild; one transfer in memory; the refused-sender table is capped at 64; `totalReceived` caps entries per session at 20000.
- A chunk boundary can split a multi-byte character in an `E` wire (the reason is truncated safely, but a player name is not). The reassembled bytes are identical; the risk is only that the game's addon-message layer rejects a part that is not valid UTF-8. Unverified in game.

### Unverified live (do not mark as passed)

The three-client test below needs an officer and two ordinary members on real WoW Forever clients.

1. All three: `/guilded ledgersync on` (members need In-game only mode). Confirm `/guilded ledgersync status` shows no error and a diagnostic line about SHA-256 is absent.
2. Officer: make one award to a character, then a day of five. Note the entry ids (saved variables after a `/reload`, or `/guilded ledgersync status` for counts).
3. Member A: `/guilded sync peers`. A should receive the entries. Member B stays online but does not run anything. Within about 25 s B should ask and receive the same entries from A. Record who sent the payload (one peer only) and the time from request to last part.
4. Officer: log out before B finishes (or before step 3 for B). B: `/guilded sync peers`. B must still obtain the entries from A. Compare balances and entry ids on all three.
5. Officer: void one award, log out. A and B: `/guilded sync peers`. The balance must drop by that amount exactly once on both, and not change again after repeating the command.
6. `/reload` A and B and repeat the sync: nothing changes.
7. Provoke a messaging lockdown (a boss pull in a dungeon or raid) while a transfer is running; after it ends, confirm the transfer completes and no balance is applied twice.
8. Join a different guild or leave the guild on one member: confirm no ledger traffic is answered and no old standings appear.
9. With a modified build only: a holder that edits one amount must be rejected (covered in simulation, not live).
10. Whisper rejection of non-UTF-8 parts (see the sharp edge above), and the SHA-256 self-test on both a Retail-family and a Classic-family client.

### Results on the integrated tree

- `node addon/Guilded/validate-addon.mjs`: both add-ons pass.
- `npx vitest run tests/lua` (with the placeholder environment from CLAUDE.md): 830 passed in 69 files (Codex reported 827 in 68; the difference is the three tests I added and one file that needs the environment). Without the placeholder environment, `character-names` and `share` fail to load on `src/config.ts`, as documented.
- `npx tsc --noEmit -p .` and `npx eslint .`: clean.
- `npm run addon:editions`: built and verified 10 edition packages; client acceptance remains pending.
