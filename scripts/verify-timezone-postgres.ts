// Read-only regression; no schema, migration or stored-data changes. Run with
// TEST_DATABASE_URL pointing to a disposable local guilded_release_test database.
import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";

const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
const previous = process.env["PGOPTIONS"];
try {
  for (const zone of ["America/Toronto", "Asia/Kolkata", "Pacific/Chatham", "UTC"]) {
    process.env["PGOPTIONS"] = `-c TimeZone=${zone} -c default_transaction_read_only=on`;
    for (const source of ["environment", "url"]) {
      url.searchParams.delete("options");
      if (source === "url") url.searchParams.set("options", process.env["PGOPTIONS"]);
      const database = createPrismaClient(url.toString());
      try {
        // Concurrent queries exercise multiple connections, then a fresh client on the next pass.
        await Promise.all(Array.from({ length: 5 }, () => database.$transaction(async tx => {
          const rows = await tx.$queryRaw<{ zone: string; readonly: string; winter: Date; summer: Date; plain: Date; dates: Date[]; winterEpoch: number; summerEpoch: number }[]>`
            SELECT current_setting('TimeZone') AS zone, current_setting('transaction_read_only') AS readonly,
              '2026-11-04T23:00:00Z'::timestamptz AS winter,
              '2026-07-04T23:00:00Z'::timestamptz AS summer,
              '2026-11-04 23:00:00'::timestamp AS plain,
              ARRAY['2026-11-04T23:00:00Z'::timestamptz, '2026-07-04T23:00:00Z'::timestamptz] AS dates,
              extract(epoch FROM '2026-11-04T23:00:00Z'::timestamptz)::float8 AS "winterEpoch",
              extract(epoch FROM '2026-07-04T23:00:00Z'::timestamptz)::float8 AS "summerEpoch"`;
          const row = rows[0]!;
          assert.equal(row.zone, "UTC");
          assert.equal(row.readonly, "on");
          assert.equal(row.winter.getTime(), row.winterEpoch * 1000);
          assert.equal(row.summer.getTime(), row.summerEpoch * 1000);
          assert.equal(row.plain.toISOString(), "2026-11-04T23:00:00.000Z");
          assert.deepEqual(row.dates.map(date => date.toISOString()), [row.winter.toISOString(), row.summer.toISOString()]);
        })));
      } finally { await database.$disconnect(); }
    }
  }
  console.log("UTC sessions: winter/summer timestamps, arrays, concurrent pools and reconnects passed.");
} finally {
  if (previous === undefined) delete process.env["PGOPTIONS"]; else process.env["PGOPTIONS"] = previous;
}
