# Run seal: spec for the addon and companion (release after 9.3.0)

Part of [SINGLE_WITNESS_2026-11-13.md](SINGLE_WITNESS_2026-11-13.md). The bot side (`src/services/run-seal.ts`, tested) is ready; the addon
and companion write and register the seal in the release after 9.3.0. Nothing here is built in the addon yet.

## Purpose and honesty

The seal makes a dungeon run record tamper-evident: a saved file edited by hand without knowing this scheme, an old record played back, and one
install file copied to two PCs all show up as flags for officers. It is a **speed bump**. The secret lives in the same SavedVariables file and
the scheme is open source, so a modified addon, or someone who reads this document, can seal anything. A bad seal never refuses a run; a
missing seal (older addon) is normal. Docs and UI must not call a sealed run "verified".

## What exists already

`integrity` on a run (`dungeonIntegritySchema`, version 2, `src/services/dungeon-integrity.ts`) records observation provenance: start witness
and trigger, observer, first-combat time, continuity, and per-player presence intervals. It has no checksum, and the server validates its shape
and meaning on import. The seal is one more optional key in that object. No second scheme.

## Fields

```
integrity.seal = { install = "<hex 8-64>", seq = <integer >= 1>, mac = "<64 hex>" }
```

- `install`: a random id made once per addon install (account-wide SavedVariables), 16 hex characters.
- `seq`: this install's run counter, starting at 1, +1 for each run sealed, never reused, kept in SavedVariables.
- `mac`: lowercase hex of HMAC-SHA256(secret, canonical text) with the install's 32-byte random secret (stored as 64 hex characters).

## Canonical text (byte for byte, as `canonicalText` in `run-seal.ts`)

Lines joined with `\n`, no trailing newline:

1. `guilded-run-seal-1`
2. `install`
3. `seq` as a decimal integer
4. run `id`
5. `instanceId` (whole number)
6. `difficultyId`
7. `startedAt` (seconds)
8. `endedAt`
9. `state`
10. `completedBy` (empty when absent)
11. players: for each player `character:level:deaths:presentSec` (missing numbers as empty), list sorted by plain byte order, joined with `,`
12. kills: for each successful encounter with a numeric id, in recorded order, `id@at` (empty `at` when absent), joined with `,`

Numbers are whole decimal integers (no decimals, no exponent): the addon truncates; Lua doubles are fine below 2^53. The kill list keeps the
recorded order on purpose: a reordered record changes the mac.

## When the addon seals

At the moment a run reaches a terminal state (COMPLETED, ABANDONED, INVALID) and again whenever the addon legitimately changes the fields
above (a peer-recovered completion, a merged copy): it increments `seq` only for a run it has not sealed before; a re-seal of the same run keeps
its `seq`. A relayed guildmate run keeps the seal it arrived with (the relayer cannot reseal it).

HMAC-SHA256 in Lua: WoW has no built-in. Implement SHA-256 with the 32-bit helpers (`bit` library; the fengari test harness has 32-bit
integers, which is enough for SHA-256 but not for sums above 2^31, so mask every addition with `% 4294967296`). Keep it out of combat and
out of the login path: seal lazily at run end and on a timer, a few runs at a time.

## Registering the secret

The server can only verify a mac when it holds the secret. The companion reads `install` and `secret` from the saved file and registers them
with the device key on the next device upload (`/api/v1/device/...`, new optional field `seal: { install, secret }`); the server stores them on
the device (new column, added with that release). Until a secret is registered the server only records that a seal exists. A different secret
for an install already registered is itself an anomaly ("install file copied").

## What the server does with it (already built, not wired)

- `verifySeal(run, secret)`: valid, invalid or absent.
- `sealReplay(seal, runRef, seen)`: one sequence number on two different runs of one install (a copied install file).
- Both only raise anomaly flags (`seal-invalid`, `seal-replay`) shown by `/officer dungeon flagged`; they never refuse a run.

## Tests the addon release needs

A Lua test with fixed vectors: the canonical text and mac for a sample run equal the values `run-seal.ts` produces (generate the vector in a
vitest test and paste it into the Lua test); an edited field changes the mac; players in any order give the same mac; seq never repeats.
Real client: the cost of SHA-256 for a run in game (a run is about 2 KB; budget under 5 ms).
