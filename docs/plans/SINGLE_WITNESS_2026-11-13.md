# One witness is enough (13 November 2026)

Owner, 13 November: one witness should be enough for dungeon runs and other information; other players' information (name, guild) may be
shown publicly. This replaces the second-statement rules of [RUN_TRUST_2026-11-10.md](RUN_TRUST_2026-11-10.md) (sections 3 and 4, and the
Season 1 exception in section 10). The ledger, fingerprints, vouchers and copy matching of that document are unchanged.

Runs are verified by the server. How, and with which settings, is the owner's private configuration; this document does not list it.

## One switch

`SINGLE_WITNESS` in `src/services/run-trust.ts` (currently `true`). Setting it to `false` brings back the second-statement behaviour
(anchored or second device from Season 2, pending, expiry, public boards without device runs from Season 2). `SINGLE_WITNESS_SINCE` is the
date for the public wording.

## Rules removed or relaxed

| Rule | Before | Now |
| --- | --- | --- |
| Season 2 switch (`countsDeviceOnlyRuns`) | device-only runs counted only until an official season 2 started | always on |
| Anchor (party member in the roster or linked) | needed from Season 2 | not needed |
| Pending, "Waiting for a second player's addon" | held, up to 30 days | no new pending rows. A row that already waits is stored at that device's next upload |
| Expiry, "Not confirmed by a second player" | after 30 days | only "Too old to count (over 30 days)" for a run that old when it arrives |
| Daily limit | beyond it the run waited for a second statement | beyond it the run waits until the next day |
| Public boards from Season 2 (`publishGuildRuns`) | skipped `device` and `witnessed` runs | publishes every stored run |

The existing validity rules (standing, season window, final boss and route evidence, presence, duration, the daily limit, the #844
peer-vouched hold) stay.

## What the server adds

- Server-side checks on every run, with weights and thresholds read from the server's private configuration (`RUN_INTEGRITY_CONFIG`,
  `RUN_CHALLENGE_SECRET`; `src/services/run-integrity-config.ts` holds only safe defaults).
- Runs and PCs that fail several checks are held for the owner's review without telling the member (`DungeonRunWitness.status = 'held'`).
  A single soft result only reports.
- `/officer dungeon flagged` (officers and the owner, ephemeral): the held list, the flagged list, `pc:` to exclude a PC (`exclude:false`
  restores it), `run:` to release a held run (it counts at its PC's next upload).
- "Confirmed by N players" (`DungeonRun.witnessCount`) is information only. It changes no rank and no point.
- The sync answer carries a fresh challenge for the companion; the shared module is `src/services/run-challenge.ts` (also meant for duels).
  The addon and companion rules are in the owner's private notes, not in this repository.

Migration `20270217000000_single_witness`: `DungeonRun.anomalies`, `DungeonRun.witnessCount`, `CompanionDevice.excludedAt`,
`excludedReason`, `chainSeq`, `chainHash`, `DungeonRunWitness.flags`.

## Season 1, public boards, records

- **Season 1 too (owner, 13 November: "apply to season 1").** An explicit owner override of the frozen-season-rules principle for this one
  point, dated `SINGLE_WITNESS_SINCE`: from 13 November 2026 one witness is enough. The hashed season rules snapshot (`OfficialSeason.rules`)
  is not edited: the second-statement rules lived in the ledger and publishing code, not in the snapshot.
- **Pending Season 1 runs become eligible.** Season 1 already stored device-only runs (#725/#726), so a run can only be pending if it arrived
  before that exception or waited on the daily limit. Nothing was read from production, so the count is unknown. The companion resends waiting
  runs on every upload, so each is stored at its PC's next upload under the new rule. A PC that never uploads again leaves its rows pending
  (a server sweep was left out: the stored payload lacks the context the import needs).
- **Nothing that already counted is re-scored or reordered.** Only held runs are added, so a rank can change only through an added run. When
  a second independent statement arrives for a stored run, its trust goes from `device` to `witnessed` and `witnessCount` rises (no score or
  rank change).
- **Expired pending runs (over 30 days) stay expired** unless an officer decides a specific one matters. None exist yet (30 days from
  10 November is in December).
- Records: a `device` run can hold a record, as in Season 1.

## Other single-witness data

Nothing else waits for corroboration today:

- duels are handled in another change;
- battleground reports show "corroborated" as information only;
- world PvP kills and deaths, achievements, professions, loot and levels are self-reported already;
- "at least two crafters" for rare recipes and "at least two members" for cooperative runs are definitions of the feature, not witness rules;
- confirmed against reported characters is identity (who owns a character), a different question.

## Not covered, needs a real environment

The migration on production data; `/officer dungeon flagged` in Discord; a real second PC (witness count); the challenge and chain in a real
client (addon and companion release after 9.3.0).
