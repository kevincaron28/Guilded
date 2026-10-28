# Aiven memory warning — 28 October 2026

Status: recovered at inspection; cause not confirmed. This remains a launch capacity check.

Evening follow-up at 22:33 UTC after the 8.0.2 deployment: Aiven's one-hour graph
shows approximately 27% memory available and 72–73% used, with a stable trend and
CPU near 20%. A bounded read-only database snapshot found six other idle client
connections, no active/idle-in-transaction clients or lock waiters, zero recorded
deadlocks/temp files and a 19.2 MiB application database. Pool maximum remains five.
The final audit removed a separate unbounded participation-summary transfer to
the bot; it does not establish this alert's cause. No plan, memory setting or data
changed. These current-activity observations do not certify launch-load capacity.
Receipts: `backups/release-8.0.2/`; [release evidence](V8_0_2_RELEASE_EVIDENCE_2026-10-28.md).

The owner reported the alert at 00:08 America/Toronto (04:08 UTC), after evening maintenance.
Read-only inspection around 09:43 UTC confirmed that the configured database is `guilded-free`.
No database settings, plan, records or running sessions were changed.

## Evidence

- Aiven Console: service Running; Free-1-1gb, one CPU, 1 GB RAM, 1 GB storage.
- Overview at inspection: memory used 71% (60-minute view); storage 18.5%.
- The one-day memory graph showed usage above 90% before approximately 04:00 UTC,
  then a sharp recovery and a later stable region around 70–71%. Graph estimates are
  visual, not exact exported samples. The warning time falls in this incident window.
- PostgreSQL started 27 October at 22:54:16 UTC (18:54 Toronto), consistent with the
  reported maintenance. This is correlation, not a demonstrated cause.
- One bounded read-only transaction used one connection, then disconnected.
  Other client backends at that instant: six idle, zero idle-in-transaction or active,
  zero lock waiters. System background workers are separate from client connections.
- Local configured pool maximum is five. Server maximum is 20, with three reserved.
- Application database: 20,149,951 bytes, approximately 19.2 MiB. Database size is not
  service RAM consumption or total service disk consumption.
- Shared buffers: 189 MiB; work_mem: 2 MiB; maintenance_work_mem: 89 MiB;
  autovacuum_max_workers: three. No settings were changed.
- Database statistics at inspection showed zero deadlocks and zero temporary spill files;
  these counters do not prove there were no earlier failures. Recent visible service logs
  contained routine connection/monitor/checkpoint activity; historical incident logs were
  not fully retrieved.
- The separate `guilded` Developer-1 service also has 1 GB RAM. Moving there would not
  increase memory capacity. It has separate storage/other plan differences.

Private diagnostic JSON and the reproducible one-connection script are retained under
`backups/aiven-memory-check-2026-10-28.json` and `backups/aiven-memory-check.mts`.

## Before launch

1. Compare available memory, query latency and connections during ordinary activity and
   a controlled companion/import rehearsal; record before/peak/after values. Offline unit
   tests are not a production load test.
2. Keep one bot instance and bounded database clients. Do not run full application stress
   tests against this free instance or delete guild data to address a RAM warning.
3. If pressure recurs, capture concurrent queries/connections and Aiven event/maintenance
   history during the event. Tune the identified cause; do not attribute it to a memory
   leak, caching, backups or maintenance without evidence.
4. If normal launch traffic repeatedly leaves insufficient available memory, review a
   plan with more RAM and its actual price before changing billing. A storage-only change
   does not solve RAM pressure.

Reference: [Aiven memory metrics](https://aiven.io/docs/products/postgresql/reference/pg-metrics)
distinguish available memory from memory unused by buffers/caches.
[Aiven shared buffers](https://aiven.io/docs/products/postgresql/concepts/pg-shared-buffers)
describes the shared cache and per-operation memory tradeoffs.
