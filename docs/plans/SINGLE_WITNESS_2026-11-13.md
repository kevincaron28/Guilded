# One witness is enough (13 November 2026)

Owner, 13 November: "maybe encode the stats so that only one witness is good; same with dungeon runs or other information: only one
witness should be okay." He also decided that other players' information (name, guild) may be shown publicly.

This replaces the second-statement rules of [RUN_TRUST_2026-11-10.md](RUN_TRUST_2026-11-10.md) (sections 3 and 4, and the Season 1
exception in section 10). The ledger, fingerprints, vouchers and copy matching of that document are unchanged.

## What cannot be promised

Nothing here makes a run cheat-proof. The addon runs on the player's PC, so a modified addon, or an edited saved file made by someone
who reads the source, can produce any run a real one can. A second witness never fixed that either: two keys on one PC were always
possible. What this design does is make forgery tedious and visible, and keep honest runs flowing without waiting for a stranger.
Docs, UI text and replies must not claim more.

## One switch

`SINGLE_WITNESS` in `src/services/run-trust.ts` (currently `true`). Setting it to `false` brings back the second-statement behaviour
(anchored or second device from Season 2, pending, expiry, public boards without device runs from Season 2). The plausibility flags,
witness count and exclusion stay either way (they never hold a run).

## Rules removed or relaxed

| Rule | Before | Now |
| --- | --- | --- |
| Season 2 switch (`countsDeviceOnlyRuns`) | device-only runs counted only until an official season 2 started | always on |
| Anchor (party member in the roster or linked) | needed from Season 2 | not needed; the voucher still must be a party character of the device, or a reporter the addon heard |
| Pending, "Waiting for a second player's addon" | held, up to 30 days | no new pending rows. A row that already waits is stored at that device's next upload (the companion resends waiting runs) |
| Expiry, "Not confirmed by a second player" | after 30 days | only "Too old to count (over 30 days)" for a run that old when it arrives |
| Daily limit, 20 single-statement runs per PC | beyond it the run waited for a second statement | beyond it the run waits until the next day |
| Public boards from Season 2 (`publishGuildRuns`) | skipped `device` and `witnessed` runs | publishes every stored run; the evidence rules (#203, current-v2 integrity, presence, final boss) still apply on top |

## What stays, because it protects against mistakes

Voucher standing; recorder in the run; same id and fingerprint copy matching (a device never edits, merges into or adds players to a stored
run); the 30-day age limit; season window; final boss and route evidence; presence of 80 percent; minimum and maximum duration; the
20-a-day limit; and the #844 peer-vouched hold. That hold covers a recorder whose own addon never saw the final boss: the completion rests
on hearsay, which is missing evidence, not a missing second witness. The guildmate's own copy counts as the one witness, so it stays.

## What replaces the second witness

1. **Seal (spec only in this release).** `integrity.seal` on each run: a keyed checksum with a per-install secret and a sequence number.
   It exposes a saved file edited by hand, an old record played back and one install copied to two PCs. It is a speed bump: the secret sits
   in the same file. See [SINGLE_WITNESS_ADDON_SEAL.md](SINGLE_WITNESS_ADDON_SEAL.md). The existing `integrity` data (schema v2) is
   observation provenance (start trigger, observer, presence intervals), validated by the server; it has no checksum, and the seal extends
   that object instead of adding a second scheme. `src/services/run-seal.ts` verifies a seal; the server only checks one once a secret is
   registered for the device, which ships with the addon release.
2. **Plausibility flags** (`src/services/run-plausibility.ts`), raised when the run is stored, never a refusal: a boss kill outside the run,
   kills out of time order, less than 30 seconds per boss, a clear under half the fastest known one (five or more known clears), a level above 60,
   a character in two runs at once or starting a clear less than a minute after leaving another dungeon, one PC sending overlapping runs.
   Group size is not flagged: the existing validity check already limits a run to 1-40 participants and raids are legitimately large.
3. **Per-PC limits and exclusion.** 20 single-statement runs a day per PC (unchanged). The device key is the unit of exclusion:
   `CompanionDevice.excludedAt`; an excluded PC's runs are refused with "This PC was excluded by an officer".
4. **Anomaly report.** `/officer dungeon flagged` lists flagged runs with the flags, the PC code and the witness count; `pc:<code>`
   excludes the PC (`exclude:false` restores it). Flagged runs still count: nothing is held in silence. Runs a PC already sent stay until an
   officer invalidates them with `/officer dungeon invalidate`.
5. **Confirmed by N players**, information only: `DungeonRun.witnessCount` (default 1), raised when independent statements agree. It changes
   no rank and no point.

Migration `20270217000000_single_witness`: `DungeonRun.anomalies`, `DungeonRun.witnessCount`, `CompanionDevice.excludedAt`, `CompanionDevice.excludedReason`.

## Season 1, public boards, records

- **Season 1 too (owner, 13 November: "apply to season 1").** This is an explicit owner override of the frozen-season-rules principle for
  this one point, dated `SINGLE_WITNESS_SINCE` = 2026-11-13: from 13 November 2026 one witness is enough. The hashed season rules snapshot
  (`OfficialSeason.rules`) is not edited: the second-statement rules lived in the ledger and publishing code, not in the snapshot, so the
  public page and docs state the date instead.
- **Pending Season 1 runs become eligible.** Season 1 already stored device-only runs (#725/#726), so a run can only be pending if it
  arrived before that exception, or waited on the daily limit. Nothing was read from production for this change, so the count is unknown;
  it is at most the pending rows (`DungeonRunWitness.status = 'pending'`), and the companion resends them on every upload. The next
  upload from that PC stores each one under the new rule, with the plausibility flags. A PC that never uploads again leaves its rows
  pending; a server sweep was considered and left out because the stored payload lacks the device's character list and guild context
  that the import needs, so it would duplicate the upload path for a few rows. Owner check: count pending rows before and after deploy.
- **Nothing that already counted is re-scored or reordered.** Only held runs are added, so a rank can change only through an added run.
  When a second independent statement arrives for a run already stored, its trust goes from `device` to `witnessed` and
  `witnessCount` rises (information only: no score or rank change).
- **Expired pending runs (over 30 days) stay expired** unless an officer decides a specific one matters: no expired rows exist yet (30 days
  from 10 November is in December), and an old run is the least checkable. If one is wanted, restore its payload by hand; do not add a
  bulk "unexpire".
- Records: a `device` run can hold a record, as in Season 1. The flags are the safeguard; an officer who finds a forged record invalidates the run.

## Other single-witness data

Nothing else waits for corroboration today:

- duels are handled in another change;
- battleground reports show "corroborated" as information only;
- world PvP kills and deaths, achievements, professions, loot and levels are self-reported already;
- "at least two crafters" for rare recipes and "at least two members" for cooperative runs are definitions of the feature, not witness rules;
- confirmed against reported characters is identity (who owns a character), a different question.

## Not covered, needs a real environment

The migration on production data; `/officer dungeon flagged` in Discord; a real second PC (witness count); the seal in a real client.
