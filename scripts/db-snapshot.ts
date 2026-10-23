import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { compareSnapshots } from "./compare-db-snapshots.js";

// Read-only check for database-layer upgrades (docs/PRISMA_7_UPGRADE.md): read the same database
// copy with the old and the new code, then compare. Run with scripts/with-env.mjs.
//   tsx scripts/db-snapshot.ts snapshot <empty dir>  every table, in the daily backup's format
//   tsx scripts/db-snapshot.ts compare <a.json.gz> <b.json.gz>
// The comparison names tables and counts only; values (Discord IDs, messages) are never printed.
const [mode, first, second] = process.argv.slice(2);

const load = async (file: string): Promise<unknown> => JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));

if (mode === "snapshot" && first) {
  const { runBackup } = await import("../src/services/backup.js");
  const { disconnectDatabase, prisma } = await import("../src/database.js");
  try {
    const result = await runBackup(prisma, new Date(), first, 1000);
    console.log(result ? `${result.rows} rows written to ${first}/${result.file}` : `${first} already holds today's snapshot: use an empty folder.`);
    if (!result) process.exitCode = 1;
  } finally { await disconnectDatabase(); }
} else if (mode === "compare" && first && second) {
  const [a, b] = [await load(first), await load(second)];
  const differences = compareSnapshots(a, b);
  for (const difference of differences) console.log(difference);
  console.log(differences.length ? `${differences.length} table(s) differ.` : "Identical: every table has the same rows and values.");
  if (differences.length) process.exitCode = 1;
} else {
  console.error("Usage: tsx scripts/db-snapshot.ts snapshot <empty dir> | compare <a.json.gz> <b.json.gz>");
  process.exitCode = 1;
}
