# Prisma PostgreSQL session timezone

The application pool forces `TimeZone=UTC` in PostgreSQL startup options on every
connection. This is required with adapter-pg 7.10.1: its timestamptz decoder replaces
the returned offset with UTC without converting the wall-clock time. A Toronto
session can therefore read an instant four or five hours early. Changing Node's
`TZ` alone does not fix it.

URL `options` take precedence over `PGOPTIONS`, as in node-postgres. Other options
are preserved and UTC is appended last; the original URL option is removed so it
cannot override the pool setting. No database defaults or stored timestamps change.
Application SQL must not use `SET TIME ZONE` or `set_config('TimeZone', ...)` to
override this invariant. Format dates in the presentation layer instead.

Run the read-only regression with `TEST_DATABASE_URL` pointing to an existing local
`guilded_release_test` database:

```
node --import tsx scripts/verify-timezone-postgres.ts
```

It checks summer/winter instants against PostgreSQL epoch values, timestamp arrays,
plain timestamps, non-UTC URL/environment options, multiple connections and fresh
pools. It runs no migrations. For release review, also compare read-only snapshots
against Prisma 6 under non-UTC database defaults. Production deployment remains a
separate operation; this fix does not require a migration or a change to stored data.
