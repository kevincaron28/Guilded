# Prisma 6 fallback for the reviewed final candidate

This is a contingency branch, not a release or deployment instruction. It retains
the complete candidate feature set from PRs #206–#209, including the later public
report race/evidence fixes and standalone addon scoring. It also carries the staged
updater/recovery fix. The corresponding Prisma 7 integration commit is
`645f38020b30001fee3f77df6626c65447493125`.

The database-access differences are limited to pinned `prisma` / `@prisma/client`
6.19.3, the Rust-engine client generator and datasource URL, generated-client import
paths, and the database factory. Prisma 7's adapter package/config are removed.
All application models and migrations are retained unchanged. No migrations are
needed to switch ORM clients against this existing schema.

`createPrismaClient()` remains the only client factory. Prisma 6's native URL
handling retains pool/TLS options, supplies connection defaults, and appends UTC to
URL startup settings. Explicit URL options override PGOPTIONS; other startup
settings are preserved. The shared native timestamp regression verifies this on
multiple connections and fresh pools, with summer/winter dates and arrays.

The database URL unit tests cover the Rust-engine configuration rather than the
removed node-postgres adapter. All scoring, addon, companion and service tests stay
present. Read-only parity is checked against the same restored local data in UTC
and America/Toronto application timezones. Synthetic native regressions use only
the existing disposable schema. Never run the migration-based test launcher under
the no-migrations hold.

Before real recovery, reconcile the branch with the exact approved release commit,
review all differences, require final CI, and confirm current schema compatibility.
Do not revert features, restore a database over later writes, or run a second bot.
The application recovery helper leaves the service stopped; normal service startup
would apply migrations and requires separate authorization.
