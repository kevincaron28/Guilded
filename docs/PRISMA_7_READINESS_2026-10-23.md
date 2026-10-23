# Prisma 7 deployment readiness — 23 October 2026

**Decision: HOLD deployment.** The available evidence clears source/fixture CI, not
production acceptance. No bot deployment, restart, production migration, release or
Discord message was performed during this review. The running Oracle commit, live
database version and current production memory were not accessible.

## Scope and current evidence

Reviewed `main` at **473e710dd6a57cc44af95064c132c06c8a56d60f**, including merged
[#188](https://github.com/kevincaron28/Guilded/pull/188) (`a60f939`) and subsequent
public-score changes. The only open PR when checked was the unrelated release-guide
draft #189; no readiness fix was already in progress there.

| Check | Evidence | Result |
| --- | --- | --- |
| Latest main quality CI | [39871479299](https://github.com/kevincaron28/Guilded/actions/runs/39871479299) | Both `checks` and `windows-package` succeeded |
| Prisma merge quality CI | [39869169043](https://github.com/kevincaron28/Guilded/actions/runs/39869169043) | Succeeded |
| Main fixture database | Latest checks job: PostgreSQL 16, 89 migrations, concurrent imports and custom-format dump/restore | Passed; not production data or Aiven TLS |
| Main unit suite in CI | 257 files / 2,177 tests | Passed |
| Latest observed uptime | [39914202870](https://github.com/kevincaron28/Guilded/actions/runs/39914202870) | Succeeded; this does not identify the deployed ORM/commit |
| Local readiness fixes | Clean `npm ci` generated Prisma 7.10.1; 258 files / 2,182 tests, TypeScript, ESLint, both addon validators, shell syntax and whitespace checks | Passed |
| Aiven/Oracle access | Connected PC `DESKTOP-QLI338Q` was offline; no production environment or SSH identity available in this checkout | Blocked |
| Local full database rerun | Native PostgreSQL tools unavailable; attempted PGlite 17.5 socket rehearsal could not connect (`P1001`) in this execution environment | Not completed; do not substitute for CI or production acceptance |

The earlier red run on `4d52cdb` is historical. The current schema has no datasource
URL declaration; `prisma.config.ts` supplies the CLI URL and generated-client installation
works. There is no current failing main quality job in the reviewed results.

## Reproducible defects and corrections

1. **The documented rollback does not restore Prisma 6.** In an isolated worktree,
   `git revert --no-commit -m 1 a60f939` produced four conflicts. Resolving those while
   preserving current functionality still left `prisma` and `@prisma/client` at 7.10.1:
   #201/#202 had already changed those packages in its first parent. Generation then
   failed with `P1012` on the restored schema URL. Also reverting #202 and #201 restores
   6.19.3 and permits generation and type checking. See the corrected, pinned procedure
   in [PRISMA_7_UPGRADE.md](PRISMA_7_UPGRADE.md#rollback). This local candidate is not a
   production-tested or approved rollback release.
2. **The copy instructions targeted the wrong PostgreSQL major.** The Aiven migration
   record says PostgreSQL 18.6, whereas the upgrade instructions said to restore into 16.
   PostgreSQL documents that an older `pg_dump` cannot dump a newer server and older-major
   restore targets are not guaranteed. Use matching PostgreSQL 18 server/tools after
   confirming the live major. PostgreSQL 16 CI remains useful independent fixture coverage.
3. **The snapshot acceptance check could falsely pass.** Comparing `{Guild: []}` with
   `{Guild: [], Member: []}` printed “Identical” and exited 0. It now detects missing tables,
   rejects empty/malformed snapshots, compares nested object keys independently of order,
   preserves array order/row multiplicity/type differences, and reports no row values.
   Reusing a snapshot directory now exits nonzero instead of appearing to capture fresh data.
4. **The updater printed an unusable recovery command.** Its suggested detached checkout
   would be refused by its own main-only guard (and the normal updater fetches main).
   The failure message now points to a reviewed revert or saved-application recovery.
5. **The pool-capacity comment overstated its allowance.** Two full default pools use 16
   of the recorded 17 usable slots, leaving one maintenance connection, not both a dump
   and another CLI. The comment is corrected; configured pool sizes are unchanged.

Three initial local setup-preflight tests failed because `tsx` CLI tried to open a
blocked Unix pipe before the setup script ran. The test harness now launches its existing
script through Node's `--import` loader using a Windows-compatible file URL. All three
pass; this was not a Prisma connectivity failure.

## Connection pooling and TLS

The reviewed factory uses `@prisma/adapter-pg` 7.10.1 and locked `pg` 8.23.1. Each
`createPrismaClient()` can own a separate pool. The exported singleton is reused by the
bot; standalone scripts create their own clients. The adapter calls `pool.end()` on
disconnect, and the bot's shutdown calls `$disconnect()` with a ten-second overall exit
deadline. This is source inspection, not proof of behavior under production load.

The factory translates `connection_limit` (default 8), the larger of connect/pool timeouts
(default 30 seconds), and a 300-second idle timeout. The recorded production URL sets 5;
actual configuration must be inspected without printing it. A zero timeout can mean no
timeout and differing connect/pool values cannot retain separate semantics with this
single `pg` setting. Existing unit tests cover the documented production 5/30/30 settings.

For the recorded Aiven URL, `sslcert` becomes the CA, `sslaccept=strict` enables certificate
verification, and SSL URL parameters are removed before `pg` can override those options.
The unit test uses placeholder PEM text: it does **not** establish that the real CA parses,
is readable by the service user, or validates Aiven's chain and hostname. `sslmode=prefer`
or a missing mode means plaintext here; do not substitute either for the strict Aiven URL.

Required evidence still missing:

- Strict-CA read-only `release:ledger-check` from a candidate checkout on the PC and Oracle,
  using their existing environment and CA paths. Confirm strict verification remains enabled;
  never use `rejectUnauthorized: false` or an insecure URL to obtain a pass.
- Maximum connections observed under representative concurrent imports + backup + scheduled
  work on the copy; bounded waits under saturation, recovery after an idle connection drops,
  and zero connections remaining after client disconnect. Count every process and maintenance
  tool against the actual Aiven connection allowance.
- No second live Discord bot. The rehearsal must invoke database services/test harnesses only.

## Backups, data and migration scope

The daily JSON backup still uses a Repeatable Read transaction and serializes BigInt as
strings; model enumeration now uses `Prisma.ModelName`. There are 94 models at the reviewed
commit. Existing integration checks verify selected backup rows; the production gate must
also verify all expected tables, row counts and content across both ORM versions. A JSON
snapshot is not a substitute for a tested custom-format PostgreSQL restore.

#188 itself adds no database migration. **Current main adds migration 89**,
`20261124090000_public_score_evidence`, through a later PR: fields on PublicRun,
PublicRunPlayer, PublicRunUpload, DungeonRun and OfficialSeason. Those changes are additive
but still require separate acceptance. The live applied migration count is unknown.
Do not run `db:update` or the normal updater on production as part of this review.

Take a fresh restricted backup using matching-major tools, verify archive listing and SHA-256,
then restore into an empty, isolated matching-major database. Compare both versions against
the same approved schema on that copy, in UTC and America/Toronto, before and after the
rehearsal as appropriate. Fail on table omissions, count/type/value differences or drift.
Keep dumps and snapshots private and outside Git; publish only sanitized evidence.

## Memory and deploy/rollback acceptance

`deploy/guilded.service` sets `MemoryMax=700M` on the recorded 1 GB host. The historical
single-query Windows delta of 50–90 MB is not an Oracle load measurement. The backup holds
all table rows, a JSON string and compressed output in memory, and can overlap other work.
Measure the whole service cgroup, startup/generation and backup/load peaks, host available
RAM and restart/OOM counters. Retain explicit operating headroom; merely staying below
700 MB for one query is insufficient.

The updater installs dependencies into the active application directory before restarting.
Preserving `src/generated` through rsync does not make the whole update atomic: npm ci
replaces dependencies while the old process can still be running. Before release, rehearse
this transition and a saved-application recovery on a disposable host; retain a verified
application backup as well as the database dump. Do not improvise a live test.

The fallback recipe was locally generated and type-checked with Prisma 6.19.3 while retaining
the current schema and later features. With the same setup-test launcher repair, its full
test run passed **257 files / 2,174 tests**. It still needs final-commit CI,
production-copy reads/backup comparison, and a restore/startup rehearsal without Discord.

Deployment may be reconsidered only after the exact candidate and fallback are reviewed,
CI is green, both strict TLS checks pass, the fresh production-data copy is consistent,
backup restore works on the correct major, and pool/memory/recovery evidence is recorded.
WoW Forever's 4 November launch is not a reason to skip these gates.
