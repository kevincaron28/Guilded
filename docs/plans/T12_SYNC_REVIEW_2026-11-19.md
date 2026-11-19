# T12: review of LedgerSync, LedgerRelay, LedgerDigest and the carry handover (19 November 2026)

Read in full: `addon/Guilded/Modules/LedgerSync.lua`, `LedgerRelay.lua`, `LedgerDigest.lua`, `Carry.lua`
(`addon/GuildedDungeons/Shared/Carry.lua` is its generated copy), and `docs/SYNC_SPEEDUPS_2026-10-15.md`
for context. Checked for lost or duplicated data, integer overflow (32-bit harness, doubles in game),
the 255-byte addon-message limit, `ns.comm.send` pacing, protected calls and combat-unsafe UI.

## Fixed

**A day sent in parts could lose its tail and never complete (LedgerSync).** `ns.comm.send` drops a message
when the prefix queue is full (1024) and returns false; `sendBatch` and the entry-by-entry fallback ignored
that. A big day (up to 60 Z parts, or hundreds of E messages when the peer cannot unpack) queued behind other
traffic lost its last parts, the receiver's assembly never finished, and every later comparison resent the
same first parts, so the officers never converged on that day. Now a day goes only when the queue has room
for all of it (`roomFor`, 900 messages); otherwise nothing is sent and the next SUM/AUTH/DAYS comparison
asks again. The entry fallback also stops when the queue fills. Lua test:
"sends no part of a day when the send queue has no room for all of it, and sends it once there is room".

## Checked and fine

- **Integer range.** `hashText` (`h * 31 + byte`, modulus 16777213) stays under 2^31; the per-entry, per-author
  and per-day sums use `% MODULUS` after every add or subtract, so no value passes 2^31 and the negative case
  (`-h`) stays non-negative in Lua. Carry's 24-bit `hash` (`h * 33`) is also under 2^31. The SHA-256 in
  LedgerDigest only adds a few 32-bit words before `band(..., 0xffffffff)`, which is exact in doubles, and the
  module disables the relay when its self-test fails.
- **Message size.** `entryMessage` truncates the reason to 250 bytes in all (UTF-8 safe via `util.truncate`);
  `sendList` chunks to 250; Z parts are checked (`#head + 6 + 200 <= 255`); relay PART is at most 240;
  Carry's `R|` frame is at most about 240 (kind, 67-byte key, chunk 150). `comm.send` also rejects anything
  over 255 and the receivers drop anything over 255.
- **Pacing and protected calls.** Every send in all four files goes through `ns.comm.send` (the validator
  enforces it); ledger traffic holds in instances; Carry sends only when quiet (no combat, no instance) and
  re-checks with a guard. No protected function and no frame or UI is touched from these modules
  (`JoinTemporaryChannel` and `LeaveChannelByName` run only when quiet, inside `pcall`).
- **Duplicates.** Ids are permanent and `receiveEntry` ignores a known id except to apply a void (voided wins),
  so repeated or crossed batches add nothing; balances are adjusted once. The index counts an id once even if
  two accounts hold it. A relayed day is checked by SHA-256 and then validated exactly like an E message.
- **Carry.** Records are escaped before chunking so a split `%XX` is rejoined before decode; the author is the
  whisper sender; assemblies, per-sender hourly counts and the store are bounded and pruned; receipts and
  "busy" answers only count from the carrier the record was handed to.

## Left alone (not bugs today)

- A DAYS or AUTH list over 60 parts (about 700 distinct days from one author, or about 400 authors) is refused
  by `assemble`. A guild that began on 4 November 2026 will not reach that for a long time.
- `table.sort(lines)` in `sendBatch` uses the client's string collation, so two clients with different locales
  could build different bytes for the same day. The only effect is a different relay receipt (no trust is
  granted), never lost data.
- Carry formats `boss.at` with `%d`; WoW's Lua 5.1 accepts a fractional value, but the 5.3 test harness would
  not. The value is an integer server-time offset in practice.
