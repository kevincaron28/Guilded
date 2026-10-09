# Aiven database migration — 9 October 2026

Guilded's production database now runs on Aiven **guilded-free**, plan
**Free-1-1gb** (PostgreSQL 18.6, 1 CPU, 1 GB RAM, 1 GB storage).
The bot remains on the existing Oracle server. Version 6.0.0 / protocol 2 and
commit `2dce43d163782c51ce356210054cddbf1e08818a` were unchanged.

## Verified cutover

- Stopped the single Oracle `guilded` service at 16:13:07 UTC; Discord login
  succeeded against Aiven at 16:14:56 UTC (12:14:56 America/Toronto).
- Took a PostgreSQL 18 custom-format final Neon dump, verified its archive
  listing, restored it transactionally, and compared row counts plus sorted
  row-content hashes for **all 78 public tables**. No differences remained.
- Both source and destination use PostgreSQL 18.6. The live rehearsal differed
  only in `Guild.updatedAt` while the original bot continued running.
- Prisma connections and ledger preflight passed on Aiven. Startup found
  72 migrations and no pending migration. No application schema changes were
  introduced by this transfer.
- Oracle and local `.env.local` now target Aiven. Stale Neon `DIRECT_URL` entries
  were removed. Prisma uses `connection_limit=5`, `sslaccept=strict`, and the
  Aiven CA certificate. PostgreSQL backup/restore connections used `verify-full`.
- Server certificate path: `/etc/guilded/aiven-ca.pem`. Local certificate path:
  `C:/Users/Kev/.guilded/aiven-ca.pem`. Neither contains a private key.
- Internal and public `/health` returned `ok: true`, version 6.0.0, protocol 2.
  Discord login succeeded, with zero systemd automatic restarts at verification.
  A real Discord command and companion/game round trip remain user acceptance
  checks; do not infer those from health alone.
- TypeScript, ESLint, addon validation, and **165 test files / 1,351 tests** passed.
  Existing commit CI passed both PostgreSQL/checks and Windows packaging:
  https://github.com/kevincaron28/Guilded/actions/runs/37938900526

## Backup and recovery

Server directory: `/home/ubuntu/guilded-aiven-migration-2026-10-09/`.
`final.dump` is the final pre-cutover Neon snapshot; `original.env` is the
restricted original Oracle configuration. Files are mode 600, inside a private
directory. Migration scripts are one-use operational artifacts, not a release
or an instruction to rerun a restore against the live database.

Local directory: `backups/aiven-migration-2026-10-09/` (gitignored, restricted
Windows ACL). Contains `neon-final-copy.dump`, the 78-table comparison report,
and the original local environment. Never commit or publish this directory.

Final dump SHA-256, verified identical on Oracle and Windows:
`d1752abf5c3d7ecf5f23c8413a5c4bb58799a782c78b8e8a99c182c4e4088fad`.

Neon was retained unchanged. **It is now a stale recovery source, not a current
replica.** Returning to Neon after Aiven has accepted writes requires preserving
and transferring the new data. Do not simply replace the connection string or
restore the old snapshot over newer records. Provider-specific Neon restore
retention was not verified; recovery evidence is the verified custom dump and
retained source database.

## Free plan and capacity

Aiven documents that Free services continue after trial expiry and do not
consume trial credits: https://aiven.io/docs/platform/concepts/service-pricing
Free services have no fixed expiry under the current offer, but may be powered
off for inactivity; the plan has no high-availability SLA and allows 20 database
connections: https://aiven.io/docs/products/postgresql/concepts/pg-free-tier

The separate pre-existing `guilded` **Developer-1** service was not used or
deleted. It remains a paid-tier service covered by its trial; the account had
no saved payment cards when inspected. Do not confuse it with `guilded-free`.

At transfer there were **2 guild records and 7 member records**, with about
14–15 MB database size. Aiven's service storage meter includes additional
PostgreSQL overhead and showed approximately 12% during the restore. The bot
server has about 954 MiB RAM, and the bot service used about 252 MiB immediately
after startup. These are a small workload and a momentary measurement, not a
load test or a guild-capacity guarantee.

Use **5–10 active guilds as an initial pilot target**, not an enforced or proven
limit. Reassess sustained CPU, memory, connection use, command latency and
weekly storage growth before expanding. Review paid hosting before storage
stays above 70%, or earlier if response times degrade. Optional donations can
start immediately; this migration does not introduce billing or change access.
